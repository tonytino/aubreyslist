# TEMPLATE.md

This file is for agents tasked with modifying the template itself — not for agents building projects from it.

---

## What This Is

A single-app frontend template designed for rapid prototyping and solo product development. It is cloned per project, not used as a monorepo. The primary optimization target is **agentic engineering** — all conventions, structure, and documentation are designed to make agent-generated code reliable, consistent, and low-maintenance.

---

## Core Design Principles

These principles drove every decision in this template. Do not make changes that contradict them.

- **Agentic-first.** Conventions over flexibility. Agents perform better with less ambiguity.
- **Minimal dependencies.** Before adding a package, verify the existing stack can't solve the problem. Fewer dependencies means fewer attack surfaces and less agent confusion.
- **Type safety end-to-end.** TypeScript strict mode throughout. Zod for runtime validation. Types flow from DB schema → server → client without duplication.
- **Progressive documentation.** `AGENTS.md` stays lean. Detail lives in focused sub-docs under `docs/agents/`. See the Documentation Philosophy section in `AGENTS.md`.
- **Cost-minimized by default.** Infrastructure choices (Neon, Cloudflare Workers) target near-zero cost at prototype and small-traction scale.
- **The dual-layer backend.** TanStack Start server functions for UI-coupled data, Hono for portable API endpoints. Do not collapse these into one pattern.

---

## What Is Intentionally Absent

Do not add these to the template without strong justification:

- **Auth** — too project-specific, wrong choice poisons the project
- **Component libraries** (shadcn, etc.) — same reason
- **Observability, logging, error tracking** — belongs in project-level sub-docs
- **Monorepo tooling** — template is single-app by design

---

## How to Modify This Template

1. Make your changes to the relevant files.
2. If you change a convention, update the corresponding sub-doc in `docs/agents/`.
3. If you add a new convention that doesn't fit an existing sub-doc, create one following the naming rules in `AGENTS.md`.
4. If you change the stack table or hard rules, update `AGENTS.md`.
5. Keep this file current if the purpose, principles, or intentional absences change.
