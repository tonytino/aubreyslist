# Routing

Framework: TanStack Router (file-based). Routes live in `app/routes/`.

## File Conventions

| Pattern                        | Purpose                        |
| ------------------------------ | ------------------------------ |
| `app/routes/index.tsx`         | Root `/` route                 |
| `app/routes/about.tsx`         | `/about`                       |
| `app/routes/posts/$postId.tsx` | `/posts/:postId` (dynamic)     |
| `app/routes/_layout.tsx`       | Layout wrapper (no URL segment)|
| `app/routes/api.$.ts`          | Catch-all API handoff to Hono  |

## Rules

- Every route file must use `createFileRoute` with the correct path string.
- `app/routeTree.gen.ts` is auto-generated on `pnpm dev` / `pnpm build`. Never edit it.
- Use `Route.useParams()`, `Route.useSearch()` etc. — never `useParams` from React Router.
- Loaders go in the route file via `createFileRoute`'s `loader` option, not in separate files.
- For data that needs to be shared across routes, use TanStack Query — not route context.

## Adding a New Route

1. Create the file in `app/routes/` following the naming convention above.
2. Run `pnpm dev` — the route tree regenerates automatically.
3. Add a Playwright smoke test in `tests/e2e/`.
