# User-Facing Copy

> **If a visitor can read it, it must be brief, plain, and human. When in
> doubt, cut.** This governs all rendered text: headings, body copy, empty
> states, tooltips, toasts, aria-labels, meta titles/descriptions, the
> webmanifest. Agent docs and code comments follow `docs/agents/writing.md`.

## Brevity

People skim, they don't read. Every sentence must help the reader decide or
act. One short sentence beats two. Meta descriptions stay under ~155 chars.

## Banned punctuation in user-visible strings

| Never ship | Use instead |
| --- | --- |
| Em dash (—) | Period, comma, colon, or parentheses |
| En dash (–) as a clause separator | Same as above (ranges like "9–5" are fine) |
| Semicolon (;) | Split into two sentences |

These read as AI tells. Grep for them before shipping.

**Carve-out:** the middle-dot separator (·) in structured metadata is fine,
e.g. "Step 2 of 7 · Fryer" or "8 confirm / 1 dispute · last confirmed 3 weeks
ago". That's UI structure, not prose.

## Banned patterns (AI tells)

- Triadic flourishes: "contributed, attested, and dated"
- Rhetorical questions: "Craving pizza without the worry?"
- "Whether you're X or Y" constructions
- Hedging boilerplate: "It's important to note that..."
- One stock phrase repeated across pages

## Voice

Plain and concrete. Contractions are fine. Write like a knowledgeable friend,
not a brochure.

Keep domain terms exact (see [`domain.md`](./domain.md)): **celiac-safe**,
**gluten-friendly**, **Not yet attested**, **Confirm/Dispute**, **attest**,
**got glutened**.

## Hard constraint: brevity never trumps safety-critical meaning

This is a celiac-safety product. Trim words, never these facts:

- Trust summaries are transparent roll-ups of visible evidence, never hidden
  scores (ADR-007).
- Empty states stay honest: "Not yet attested" means not yet attested.
- A recent "got glutened" report flags a listing regardless of older
  confirmations.
- Safety labels carry their meaning in text, without relying on color.

## Before → after

| Before | After |
| --- | --- |
| "Search a restaurant by name or address — or browse celiac-safe spots verified by the community." | "Search by name or address, or browse celiac-safe spots." |
| "Whether you're newly diagnosed or a celiac veteran, our community-driven platform empowers you to dine with confidence." | "Find restaurants that other celiacs trust." |

## Self-check before shipping copy

1. Grep your strings for `—`, `–`, and `;`.
2. Read each string aloud. Cut anything a friend wouldn't say.
3. Confirm no safety-critical fact got trimmed with the words.
