# Writing Standard

> Inspired by ASD-STE100. Governs all repo prose: code comments, agent docs, PR
> bodies and TL;DRs, commit messages, and Claude session replies. User-facing
> copy stays governed by `docs/agents/copy.md`.

## Decision rule

Before you write a sentence, ask: does the reader need it to act correctly
right now? If not, cut it.

## Comments

A comment earns its place only by stating what the code cannot:

- a constraint or invariant the reader must not break
- an external contract (API quirk, browser behavior, tool requirement)
- a non-obvious "why" for the current design
- a genuine gotcha

Delete comments that restate the code, narrate reviews or feedback, describe
another file's behavior, or explain the author's process.

## Current state only

Describe the code as it stands. Never describe previous or future states.

Banned in comments: "previously", "no longer", "used to", "originally",
"formerly", "as of", "now that", "was moved/renamed/retired/split", "instead
of the old", before/after narration, "repo-owner feedback", review-round
references ("review finding #2").

## No ticket archaeology

No ticket or PR IDs in code comments (`AUB-123`, `#150`). Git blame and Linear
hold history. Exception: a doc or ADR reference may stay when it states a live
constraint the reader must honor (e.g. "ADR-007: evidence stays visible, no
hidden scoring"). Keep it terse.

## Style

- Short sentences (aim under 20 words). Active voice. One idea per sentence.
- No all-caps emphasis words.
- Line width 100 or less (biome).

## Always keep (tersened, never deleted)

- `@ts-expect-error` / `@ts-ignore` rationale (Hard Rule in `AGENTS.md`)
- `@knippublic` tags
- biome/vite/triple-slash pragmas, shebangs, license headers
- safety-invariant statements in trust-model code (ADR-007/008): keep the
  invariant, cut the narration
- JSDoc on exported APIs: keep, strip history and cross-file narration

## Docs

Docs are task-oriented. Write for an agent about to do something. Lead with
the decision rule or the most common action, not background.

## PR bodies, commit messages, session replies

TL;DR first: 1-3 short sentences on what changed and why it matters. Add
detail only when the reader asks. Commit subjects state the change in the
imperative; bodies carry only what the diff cannot say.

## Self-check

Grep your prose before you ship:

```bash
grep -rinE "previously|no longer|used to|originally|formerly|now that" <paths>
grep -rnE "AUB-[0-9]+" <paths>   # code comments only; PR bodies may link issues
```

A hit is a prompt to read the line, not an automatic violation.
