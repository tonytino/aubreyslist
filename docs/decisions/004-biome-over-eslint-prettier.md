# ADR-004: Biome over ESLint + Prettier

## Status

Accepted

## Context

Linting and formatting are essential for consistent code, especially in an agentic workflow where multiple agents may modify the same files. The traditional ESLint + Prettier setup requires extensive configuration, plugin management, and resolving conflicts between the two tools. This complexity is a liability when agents need to run checks quickly and reliably.

## Decision

We chose Biome because it replaces both ESLint and Prettier with a single binary. Configuration is minimal (one `biome.json` file), execution is fast (written in Rust), and there are no plugin compatibility issues to debug. The tradeoff is a smaller rule set than ESLint's ecosystem, but the rules Biome provides cover the cases that matter for this template.

## Consequences

- Run `pnpm check` before every commit. This runs Biome's lint and format passes with auto-fix enabled.
- Configuration lives in `biome.json` at the repo root. Do not add `.eslintrc`, `.prettierrc`, or related config files.
- Do not install ESLint, Prettier, or their plugins. If you see them in suggestions or tutorials, ignore them.
- Biome handles both linting and formatting in one pass. There is no separate format command to remember.
- If Biome does not have a rule you need, enforce the convention through code review or a comment in the relevant sub-doc rather than adding ESLint alongside Biome.
