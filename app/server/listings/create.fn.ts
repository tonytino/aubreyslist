import { createServerFn } from "@tanstack/react-start";
import { type CreateListingResult, createListingInputSchema } from "~/listings/create-input";

/**
 * Client-callable add-listing server function (issues #26, #25; #141 boundary).
 *
 * The ONLY part of the add-listing write path that client code (the
 * `ManualIntakeForm` / `PlacesIntakeForm` intake forms) imports. Mirroring the
 * lazy-`import()` `*.fn.ts` seam (`app/server/admin/set-intake-mode.fn.ts`,
 * `set-role.fn.ts`), the db-touching implementation lives in `./create` and is
 * referenced ONLY from inside the handler via a dynamic `import()`, so the
 * bundler strips it — and its `getDb` (neon/drizzle) graph — out of the
 * `listings.new` client chunk.
 *
 * The `.validator()` is backed by the client-safe `createListingInputSchema`
 * (from `~/listings/create-input`, which pulls in no `~/db` value import), so the
 * forms reach the create write WITHOUT statically importing `~/server/listings/create`.
 *
 * Auth + rate-limit + dedup are all enforced inside `runCreateListing`'s
 * server-fn (`createListing`): anonymous -> 401, abusive burst -> 429, a blocked
 * manual duplicate -> a `DuplicateListingError` whose existing-listing link the
 * forms recover via `parseDuplicateListingError` (#25). Behaviour is identical to
 * calling the previous `createListing` export directly.
 *
 * Server-only at runtime; safe to import from client modules.
 */
export const submitCreateListing = createServerFn({ method: "POST" })
  .validator(createListingInputSchema)
  .handler(async ({ data }): Promise<CreateListingResult> => {
    // Imported lazily inside the handler so the server-only create logic, auth
    // guard and rate limiter (and their `db`/drizzle/neon deps) stay out of the
    // client bundle (#141). Order matches the previous `createListing` server fn:
    // auth gate (anonymous -> 401) BEFORE the write limit (abusive burst -> 429),
    // then the dedup-aware insert.
    const [{ runCreateListing }, { requireCurrentUser }, { enforceWriteLimit }] = await Promise.all(
      [import("./create"), import("~/server/auth/guards"), import("~/server/rate-limit")]
    );
    const user = await requireCurrentUser();
    await enforceWriteLimit(user.id);
    return runCreateListing(data);
  });
