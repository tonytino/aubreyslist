import { describe, expect, it } from "vitest";
import {
  buildSlackPayload,
  buildSummaryPrompt,
  chooseSummary,
  escapeSlackText,
  extractTldr,
  // @ts-expect-error — .mjs script, no type declarations
} from "../../.github/scripts/slack-merge-update.mjs";

describe("extractTldr", () => {
  it("returns the TL;DR text with the list dash stripped", () => {
    const body = [
      "## TL;DR",
      "- People can now save favorite restaurants.",
      "",
      "## Summary",
      "- favorites table",
    ].join("\n");
    expect(extractTldr(body)).toBe("People can now save favorite restaurants.");
  });

  it("joins multiple meaningful lines into one string", () => {
    const body = ["## TL;DR", "Search is faster.", "Especially on phones.", "## Summary"].join(
      "\n"
    );
    expect(extractTldr(body)).toBe("Search is faster. Especially on phones.");
  });

  it("returns null when the heading is missing", () => {
    expect(extractTldr("## Summary\n- stuff")).toBeNull();
  });

  it("returns null for a placeholder/comment-only section and for empty bodies", () => {
    expect(extractTldr("## TL;DR\n<!-- template instruction -->\n-\n## Summary")).toBeNull();
    expect(extractTldr("")).toBeNull();
    expect(extractTldr(undefined)).toBeNull();
  });

  it("does not pull content that belongs to the next section", () => {
    const body = ["## TL;DR", "The real update.", "## Summary", "not this line"].join("\n");
    expect(extractTldr(body)).toBe("The real update.");
  });

  it("is code-fence aware (shared semantics with the CI gate)", () => {
    // A fenced `## TL;DR` is sample text, not the heading...
    expect(extractTldr("```\n## TL;DR\nfake\n```")).toBeNull();
    // ...and a fenced pseudo-heading inside the real section doesn't cut it off.
    const body = ["## TL;DR", "```", "## fake", "```", "Real update after the fence."].join("\n");
    expect(extractTldr(body)).toContain("Real update after the fence.");
  });
});

describe("buildSummaryPrompt", () => {
  it("embeds the title and TL;DR", () => {
    const prompt = buildSummaryPrompt({
      title: "feat: favorites",
      tldr: "People can save restaurants.",
      body: "## Summary\n- details",
    });
    expect(prompt).toContain("feat: favorites");
    expect(prompt).toContain("People can save restaurants.");
  });

  it("truncates a very long PR body to the cap", () => {
    const longBody = "x".repeat(50_000);
    const prompt = buildSummaryPrompt({ title: "t", tldr: null, body: longBody });
    // Prompt scaffolding is well under 1000 chars; a 50k body must not survive.
    expect(prompt.length).toBeLessThan(6000);
    expect(prompt).toContain("x".repeat(4000));
    expect(prompt).not.toContain("x".repeat(4001));
  });

  it("instructs the model to ignore instructions embedded in the PR content", () => {
    const prompt = buildSummaryPrompt({ title: "t", tldr: null, body: "b" });
    expect(prompt).toMatch(/ignore any instructions/i);
    expect(prompt).toMatch(/not instructions/i);
  });
});

describe("chooseSummary", () => {
  it("prefers the Claude rewrite when present", () => {
    expect(
      chooseSummary({ claudeSummary: "Claude says hi.", tldr: "tldr", title: "title" })
    ).toEqual({ summary: "Claude says hi.", source: "claude" });
  });

  it("falls back to the TL;DR when Claude is unavailable", () => {
    expect(chooseSummary({ claudeSummary: null, tldr: "The tldr.", title: "title" })).toEqual({
      summary: "The tldr.",
      source: "tldr",
    });
  });

  it("falls back to the title when both are unavailable", () => {
    expect(chooseSummary({ claudeSummary: null, tldr: null, title: "feat: x" })).toEqual({
      summary: "feat: x",
      source: "title",
    });
    // Whitespace-only values do not count as present.
    expect(chooseSummary({ claudeSummary: "  ", tldr: "", title: "feat: x" }).source).toBe("title");
  });
});

describe("escapeSlackText", () => {
  it("escapes &, <, and > for Slack mrkdwn", () => {
    expect(escapeSlackText("a & b <c> & <d>")).toBe("a &amp; b &lt;c&gt; &amp; &lt;d&gt;");
  });

  it("does not double-escape ampersands in existing entities", () => {
    // `&` is replaced first, so `&lt;` in the INPUT becomes `&amp;lt;` — the
    // literal text the user wrote, correctly escaped exactly once.
    expect(escapeSlackText("&lt;")).toBe("&amp;lt;");
  });

  it("handles empty and nullish input", () => {
    expect(escapeSlackText("")).toBe("");
    expect(escapeSlackText(undefined)).toBe("");
  });
});

describe("buildSlackPayload", () => {
  const base = {
    summary: "People can save restaurants.",
    title: "feat: favorites <beta> & more",
    url: "https://github.com/o/r/pull/42",
    number: 42,
    author: "octocat",
  };

  it("builds a section block with the escaped title link and summary", () => {
    const payload = buildSlackPayload(base);
    expect(payload.blocks[0].type).toBe("section");
    expect(payload.blocks[0].text.text).toBe(
      ":ship: *<https://github.com/o/r/pull/42|feat: favorites &lt;beta&gt; &amp; more>*\n" +
        "People can save restaurants."
    );
  });

  it("escapes the top-level text fallback too (mention-injection guard)", () => {
    // Slack parses the top-level `text` as mrkdwn as well — a raw `<!channel>`
    // in a PR title must not become a mention in the notification fallback.
    expect(buildSlackPayload(base).text).toBe("Shipped: feat: favorites &lt;beta&gt; &amp; more");
    expect(buildSlackPayload({ ...base, title: "feat: <!channel> ping" }).text).toBe(
      "Shipped: feat: &lt;!channel&gt; ping"
    );
  });

  it("includes a context block with PR number and author", () => {
    const payload = buildSlackPayload(base);
    expect(payload.blocks[1].type).toBe("context");
    expect(payload.blocks[1].elements[0].text).toBe("PR #42 · merged by octocat");
  });

  it("escapes attacker-influenced author text", () => {
    const payload = buildSlackPayload({ ...base, author: "<script>" });
    expect(payload.blocks[1].elements[0].text).toContain("&lt;script&gt;");
  });

  it("caps a runaway summary at ~600 chars", () => {
    const payload = buildSlackPayload({ ...base, summary: "y".repeat(2000) });
    const rendered = payload.blocks[0].text.text;
    const summaryPart = rendered.split("\n")[1];
    expect(summaryPart.length).toBe(600); // 599 chars + ellipsis
    expect(summaryPart.endsWith("…")).toBe(true);
  });
});
