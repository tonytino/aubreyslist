import { createServerFn } from "@tanstack/react-start";
import {
  autocompleteInputSchema,
  type PlacePrediction,
  type PlacesResult,
} from "~/listings/places-input";

/**
 * Client-callable Google Places autocomplete server function.
 *
 * The only part of the Places provider that client code (the
 * `PlacesIntakeForm` search UI) imports. Per the lazy-`import()` `*.fn.ts`
 * seam, the db-touching implementation lives in `~/server/places` and is
 * referenced only from inside this handler via dynamic `import()`s — so the
 * bundler strips it and its `getDb` (neon/drizzle) graph out of the
 * `listings.new` client chunk.
 *
 * The lazy seam matters here: `places.ts` exports a module-level
 * `getIntakeMode()` (a non-handler `getDb()` read) reachable from its
 * `autocompletePlaces` export, so a direct value-import from a client
 * component would pull drizzle/neon in even with the handler body stripped.
 * Place-details resolution happens server-side inside `runCreateListing` for
 * a chosen place id, so the client never needs a `getPlaceDetails` seam.
 *
 * The Zod validator is the client-safe `autocompleteInputSchema` (no `~/db`
 * value import), and the result type is type-only (erased at build), so
 * binding them here stays db-free.
 *
 * Auth + rate-limit are enforced server-side inside the handler:
 * `requireCurrentUser` (401) before `enforceWriteLimit` (429) before the paid
 * upstream call.
 *
 * Server-only at runtime; safe to import from client modules.
 */
export const autocompletePlaces = createServerFn({ method: "POST" })
  .validator(autocompleteInputSchema)
  .handler(async ({ data }): Promise<PlacesResult<PlacePrediction[]>> => {
    const [{ runAutocomplete }, { requireCurrentUser }, { enforceWriteLimit }] = await Promise.all([
      import("~/server/places"),
      import("~/server/auth/guards"),
      import("~/server/rate-limit"),
    ]);
    const user = await requireCurrentUser();
    await enforceWriteLimit(user.id);
    return runAutocomplete(data);
  });
