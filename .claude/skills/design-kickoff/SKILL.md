---
name: design-kickoff
description: Part A of a page redesign — brief Claude Design, generate a first-pass design, and park it as a tracked Linear issue with the artifact attached, then STOP for the human to review and approve. Use when the user asks to start / kick off a design pass or redesign of a page. Does NOT write code; the build happens later via /design-build after the human adds the design:approved label.
---

# Design Kickoff (Part A)

You run the **design half** of a page redesign, then hand off to the human. You do
**not** write implementation code — that's `/design-build`, and only after the
human approves. Read the full playbook in
`docs/agents/design-orchestration.md` (source of truth); this skill routes you.

## Why this stops before coding

Design approval happens in the **Claude Design UI**, which this session can't
observe, and the human can't drive build agents from inside it. So Part A parks
the design as a Linear issue and stops. The human reviews in Claude Design, adds
the **`design:approved`** label, then runs `/design-build`.

## Checklist

1. **Read** `docs/agents/design-orchestration.md`, plus the docs it points to for
   the design pass: `docs/agents/design.md` (direction + non-negotiables),
   `docs/agents/styling.md`, `docs/agents/domain.md` (safety states).
2. **Confirm the target** — the page/route (e.g. `app/routes/listings.index.tsx`)
   and an optional brief. If missing, ask.
3. **Ensure Linear scaffolding** (self-heal, create only what's missing): the
   `Design` initiative, the design project (default: `Core screens & Claude
   Design pilot`, under the initiative), and the `Design` / `design:approved` /
   `safe:human` labels.
4. **Design pass via a subagent.** Dispatch a **Design-analyst subagent** to read
   the current page, brief Claude Design per `docs/agents/design.md`, generate a
   **first-pass** design in the Claude Design project, and return the artifact
   reference + an ordered **change list**.
5. **Park it in Linear (you do the writes).** `save_issue` in the design project:
   title `Redesign: <page>`, description = direction + change list + acceptance
   criteria, labels **`Design` + `safe:human` + type** (NOT `design:approved`),
   an estimate, state **`Backlog`**. Attach the artifact
   (`create_attachment`).
6. **Stop and hand off.** Report the issue key + Claude Design link + the exact
   next step:
   > Review the design in Claude Design. When happy, add the **`design:approved`**
   > label to `AUB-<n>` (and move it to `Todo`), then run **`/design-build`**.

   Do **not** proceed to coding. If the design needs another pass, iterate in
   Claude Design; the issue stays in `Backlog`, unapproved.

## Hard rules

- **The subagent designs; the Orchestrator writes to Linear.** Keeps tracking
  coherent.
- **Never add `design:approved` yourself** — that label is the human's approval
  signal.
- **One coherent page redesign = one issue.** Don't file per micro-tweak (the
  250-issue cap is real). Use sub-issues only for genuinely independent pieces.
