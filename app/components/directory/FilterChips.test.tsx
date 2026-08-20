import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { currentUserQuery } from "~/auth/current-user-query";
import type { SessionUser } from "~/server/auth/current-user.fn";
import { FilterChips } from "./FilterChips";

/**
 * Tests for the directory filter chip row. The quick and taxonomy chips are
 * real <button>s with `aria-pressed`; the component is purely presentational —
 * it renders whichever sets it's handed and reports clicks via
 * `onQuickToggle` / `onToggleAttr` (the quick group-exclusivity rule lives in
 * the parent's `applyQuickToggle` reducer, unit-tested in quick.test.ts; the
 * attrs URL round-trip in browse-params.test.ts). The sort chip is a native
 * labelled <select> (SortSelector) driving the route's `changeSort`. The
 * search leads the row as a {@link SearchChip}. The "Saved" chip is
 * sign-in-gated: it reads {@link currentUserQuery} (seeded into the
 * QueryClient below), so the whole row renders under a provider.
 */

const SIGNED_IN_USER: SessionUser = {
  id: "user-1",
  name: "Test Diner",
  email: "diner@example.com",
  avatarUrl: null,
  role: "user",
};

function renderChips(
  overrides: Partial<Parameters<typeof FilterChips>[0]> = {},
  { signedIn = false }: { signedIn?: boolean } = {}
) {
  const onQuickToggle = vi.fn();
  const onToggleAttr = vi.fn();
  const onSearchChange = vi.fn();
  const onSavedToggle = vi.fn();
  const onBotToggle = vi.fn();
  const onSortChange = vi.fn();
  const onResetAll = vi.fn();

  // Seed the current-user suspense source so `useSuspenseQuery(currentUserQuery)`
  // (inside the Saved chip) resolves synchronously without calling a server fn.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(currentUserQuery.queryKey, signedIn ? SIGNED_IN_USER : null);

  render(
    <QueryClientProvider client={queryClient}>
      <FilterChips
        attrs={[]}
        onToggleAttr={onToggleAttr}
        quick={[]}
        onQuickToggle={onQuickToggle}
        search=""
        onSearchChange={onSearchChange}
        saved={false}
        onSavedToggle={onSavedToggle}
        bot={true}
        onBotToggle={onBotToggle}
        sort="alpha"
        onSortChange={onSortChange}
        isAnyFilterActive={false}
        onResetAll={onResetAll}
        {...overrides}
      />
    </QueryClientProvider>
  );
  return {
    onQuickToggle,
    onToggleAttr,
    onSearchChange,
    onSavedToggle,
    onBotToggle,
    onSortChange,
    onResetAll,
  };
}

describe("FilterChips — quick chips", () => {
  it("renders the three quick chips (no Filters sheet trigger — AUB-198)", () => {
    renderChips();
    expect(screen.getByRole("button", { name: "Celiac-safe" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Gluten-friendly" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recently verified" })).toBeInTheDocument();
    // The taxonomy filter renders as chips; there is no sheet entry point.
    expect(screen.queryByRole("button", { name: "Filters" })).not.toBeInTheDocument();
  });

  it("reflects the active quick set via aria-pressed (state, not colour alone)", () => {
    renderChips({ quick: ["celiac"] });
    expect(screen.getByRole("button", { name: "Celiac-safe" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: "Gluten-friendly" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    expect(screen.getByRole("button", { name: "Recently verified" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });

  it("renders an additive combination (safety + recency) as multiple pressed chips", () => {
    // The faceted model allows a safety choice and recently-verified at once — both
    // read as pressed, while the unselected safety sibling stays off.
    renderChips({ quick: ["celiac", "recent"] });
    expect(screen.getByRole("button", { name: "Celiac-safe" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: "Recently verified" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: "Gluten-friendly" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });

  it("clicking a chip reports its value (the parent reducer computes the next set)", () => {
    const { onQuickToggle } = renderChips({ quick: [] });
    fireEvent.click(screen.getByRole("button", { name: "Gluten-friendly" }));
    expect(onQuickToggle).toHaveBeenCalledWith("friendly");
  });

  it("clicking an already-active chip still reports its value (toggle-off is the parent's job)", () => {
    const { onQuickToggle } = renderChips({ quick: ["recent"] });
    fireEvent.click(screen.getByRole("button", { name: "Recently verified" }));
    expect(onQuickToggle).toHaveBeenCalledWith("recent");
  });
});

describe("FilterChips — taxonomy chips (AUB-198)", () => {
  it("renders the four non-headline taxonomy attributes as toggle chips", () => {
    renderChips();
    expect(screen.getByRole("button", { name: "Dedicated fryer" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dedicated GF menu" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Off-menu GF on request" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "GF substitutes" })).toBeInTheDocument();
  });

  it("excludes the headline celiac attribute by default — one Celiac-safe chip only", () => {
    // The quick `celiac` chip is the single visible "Celiac-safe" control; the
    // near-equivalent (and less strict) headline taxonomy attribute would be an
    // illegible duplicate next to it.
    renderChips();
    expect(screen.getAllByRole("button", { name: "Celiac-safe" })).toHaveLength(1);
  });

  it("reflects the active attrs via aria-pressed (state, not colour alone)", () => {
    renderChips({ attrs: ["dedicated_fryer"] });
    expect(screen.getByRole("button", { name: "Dedicated fryer" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: "GF substitutes" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });

  it("clicking a taxonomy chip reports its attribute (the route navigates ?attrs=)", () => {
    const { onToggleAttr } = renderChips();
    fireEvent.click(screen.getByRole("button", { name: "Dedicated fryer" }));
    expect(onToggleAttr).toHaveBeenCalledWith("dedicated_fryer");
  });

  it("clicking an active taxonomy chip still reports it (toggle-off is the parent's job)", () => {
    const { onToggleAttr } = renderChips({ attrs: ["gf_substitutes"] });
    fireEvent.click(screen.getByRole("button", { name: "GF substitutes" }));
    expect(onToggleAttr).toHaveBeenCalledWith("gf_substitutes");
  });

  it("BACK-COMPAT: a URL carrying the headline attr renders its chip pressed and toggleable", () => {
    // A shared link may carry `?attrs=celiac_safe_vs_gluten_friendly`. The
    // active filter must stay visible (an invisible active filter is dishonest)
    // and removable — so the otherwise-hidden headline chip renders, pressed.
    const { onToggleAttr } = renderChips({ attrs: ["celiac_safe_vs_gluten_friendly"] });
    const celiacChips = screen.getAllByRole("button", { name: "Celiac-safe" });
    expect(celiacChips).toHaveLength(2); // the quick chip + the back-compat attr chip
    const attrChip = celiacChips.find((chip) => chip.getAttribute("aria-pressed") === "true");
    expect(attrChip).toBeDefined();
    if (attrChip) {
      fireEvent.click(attrChip);
    }
    expect(onToggleAttr).toHaveBeenCalledWith("celiac_safe_vs_gluten_friendly");
  });
});

describe("FilterChips — 'Hide bot suggestions' chip (AUB-31 participation)", () => {
  it("is unpressed by default (suggestions participate in filtering)", () => {
    renderChips({ bot: true });
    expect(screen.getByRole("button", { name: "Hide bot suggestions" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });

  it("is pressed when suggestions are excluded (?bot=false), not colour alone", () => {
    renderChips({ bot: false });
    expect(screen.getByRole("button", { name: "Hide bot suggestions" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("clicking it reports the toggle (the route navigates ?bot=)", () => {
    const { onBotToggle } = renderChips();
    fireEvent.click(screen.getByRole("button", { name: "Hide bot suggestions" }));
    expect(onBotToggle).toHaveBeenCalledTimes(1);
  });
});

describe("FilterChips — sort chip (AUB-198)", () => {
  it("renders the labelled sort select reflecting the active sort", () => {
    renderChips({ sort: "trust" });
    expect(screen.getByRole("combobox", { name: "Sort by" })).toHaveValue("trust");
  });

  it("changing the sort reports the chosen value (the route navigates ?sort=)", () => {
    const { onSortChange } = renderChips();
    fireEvent.change(screen.getByRole("combobox", { name: "Sort by" }), {
      target: { value: "recency" },
    });
    expect(onSortChange).toHaveBeenCalledWith("recency");
  });
});

describe("FilterChips — search chip (user feedback #5)", () => {
  it("renders the search chip as the first control in the row", () => {
    renderChips();
    const search = screen.getByRole("button", { name: "Search restaurants" });
    expect(search).toBeInTheDocument();
    // The collapsed search chip leads the row, before the sort chip.
    const sort = screen.getByRole("combobox", { name: "Sort by" });
    expect(search.compareDocumentPosition(sort) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("reflects an applied search value as the active chip", () => {
    renderChips({ search: "rooted" });
    expect(screen.getByRole("button", { name: "Search: rooted" })).toBeInTheDocument();
  });

  it("threads search edits through onSearchChange", () => {
    const { onSearchChange } = renderChips();
    fireEvent.click(screen.getByRole("button", { name: "Search restaurants" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "root" } });
    expect(onSearchChange).toHaveBeenCalledWith("root");
  });
});

describe("FilterChips — Saved chip (AUB-129 / F11)", () => {
  it("ANONYMOUS: clicking Saved opens the sign-in dialog and does NOT navigate", async () => {
    const { onSavedToggle } = renderChips({}, { signedIn: false });

    fireEvent.click(screen.getByRole("button", { name: "Saved" }));

    // A sign-in dialog appears with a Google OAuth link carrying a `?saved=1`
    // returnTo — and crucially the toggle (the server-side navigation) is not
    // fired, so no `savedOnly` request is ever made for an anonymous viewer.
    const signInLink = await screen.findByRole("link", { name: /sign in/i });
    expect(signInLink).toHaveAttribute(
      "href",
      expect.stringContaining("/api/auth/google?returnTo=")
    );
    expect(decodeURIComponent(signInLink.getAttribute("href") ?? "")).toContain("saved=1");
    expect(onSavedToggle).not.toHaveBeenCalled();
  });

  it("SIGNED-IN: clicking Saved toggles the server-side filter (?saved=1) with no dialog", () => {
    const { onSavedToggle } = renderChips({}, { signedIn: true });

    fireEvent.click(screen.getByRole("button", { name: "Saved" }));

    // Signed-in click drives the server mode via onSavedToggle (the route
    // navigates to `?saved=1`), and no sign-in dialog is opened.
    expect(onSavedToggle).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("link", { name: /sign in/i })).not.toBeInTheDocument();
  });

  it("SIGNED-IN + saved: reflects the active state via aria-pressed (not colour alone)", () => {
    renderChips({ saved: true }, { signedIn: true });
    expect(screen.getByRole("button", { name: "Saved" })).toHaveAttribute("aria-pressed", "true");
  });

  it("ANONYMOUS is never pressed even if `saved` is somehow set", () => {
    // An anonymous viewer can't be in the saved mode, so the chip stays unpressed
    // regardless of the URL param.
    renderChips({ saved: true }, { signedIn: false });
    expect(screen.getByRole("button", { name: "Saved" })).toHaveAttribute("aria-pressed", "false");
  });
});

describe("FilterChips — Reset chip (repo-owner mobile feedback)", () => {
  it("is hidden when every browse param is at its default", () => {
    renderChips({ isAnyFilterActive: false });
    expect(screen.queryByRole("button", { name: "Reset" })).not.toBeInTheDocument();
  });

  it("is visible when any browse param is active, as text (never icon-only)", () => {
    renderChips({ isAnyFilterActive: true });
    const reset = screen.getByRole("button", { name: "Reset" });
    expect(reset).toBeInTheDocument();
    expect(reset).toHaveTextContent("Reset");
  });

  it("renders LAST in the chip row, after the taxonomy chips", () => {
    renderChips({ isAnyFilterActive: true });
    const reset = screen.getByRole("button", { name: "Reset" });
    const lastTaxonomyChip = screen.getByRole("button", { name: "GF substitutes" });
    expect(
      reset.compareDocumentPosition(lastTaxonomyChip) & Node.DOCUMENT_POSITION_PRECEDING
    ).toBeTruthy();
  });

  it("clicking Reset calls onResetAll", () => {
    const { onResetAll } = renderChips({ isAnyFilterActive: true });
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(onResetAll).toHaveBeenCalledTimes(1);
  });
});
