import { createServerFn } from "@tanstack/react-start";
import { type CreateListingResult, createListingInputSchema } from "~/listings/create-input";

/**
 * Client-callable add-listing server function — the only part of the write
 * path the add-listing wizard imports. The db-touching implementation lives
 * in `./create` and is referenced only via a dynamic `import()` inside the
 * handler, so the bundler keeps it — and its `getDb` (neon/drizzle) graph —
 * out of the client chunk.
 *
 * The `.validator()` uses the client-safe `createListingInputSchema`
 * (`~/listings/create-input`, no `~/db` value import), so the forms reach the
 * write without statically importing `~/server/listings/create`.
 *
 * Guards: anonymous -> 401, abusive burst -> 429, a blocked manual duplicate
 * -> `DuplicateListingError`, whose existing-listing link the wizard recovers
 * via `parseDuplicateListingError`.
 *
 * Server-only at runtime; safe to import from client modules.
 */
export const submitCreateListing = createServerFn({ method: "POST" })
  .validator(createListingInputSchema)
  .handler(async ({ data }): Promise<CreateListingResult> => {
    // Imported lazily inside the handler so the server-only create logic, auth
    // guard and rate limiter (and their db/drizzle/neon deps) stay out of the
    // client bundle. The auth gate (anonymous -> 401) runs before the write
    // limit (abusive burst -> 429), then the dedup-aware insert.
    const [{ runCreateListing }, { requireCurrentUser }, { enforceWriteLimit }] = await Promise.all(
      [import("./create"), import("~/server/auth/guards"), import("~/server/rate-limit")]
    );
    const user = await requireCurrentUser();
    await enforceWriteLimit(user.id);
    // The user id becomes the `createdBy` provenance for any typed links the
    // intake collected.
    return runCreateListing(data, user.id);
  });
