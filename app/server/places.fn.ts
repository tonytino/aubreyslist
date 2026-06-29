import { createServerFn } from "@tanstack/react-start";
import {
  type PlacePrediction,
  type PlacesResult,
  autocompleteInputSchema,
} from "~/listings/places-input";

/**
 * Client-callable Google Places autocomplete server function (issue #26; #141
 * boundary).
 *
 * The ONLY part of the Places provider that client code (the `PlacesIntakeForm`
 * search UI) imports. Mirroring the lazy-`import()` `*.fn.ts` seam
 * (`app/server/listings/create.fn.ts`, `app/server/admin/set-intake-mode.fn.ts`),
 * the db-touching implementation lives in `~/server/places` and is referenced
 * ONLY from inside this handler via dynamic `import()`s — so the bundler strips
 * it and its `getDb` (neon/drizzle) graph out of the `listings.new` client chunk.
 *
 * `places.ts` exports a module-level `getIntakeMode()` (a non-handler `getDb()`
 * read) reachable from its `autocompletePlaces` export, so a direct value-import
 * of that from a client component pulls drizzle/neon in even though the handler
 * body is stripped; routing through this lazy seam closes that. (Place-*details*
 * resolution happens server-side inside `runCreateListing` for a chosen place id,
 * so the client never needs a `getPlaceDetails` seam.)
 *
 * The Zod validator is the client-safe `autocompleteInputSchema` (pulls in no
 * `~/db` value import), and the result type is type-only (erased at build), so
 * binding them here stays db-free.
 *
 * Auth + rate-limit are enforced SERVER-SIDE inside the handler below
 * (`requireCurrentUser` -> 401 BEFORE `enforceWriteLimit` -> 429 BEFORE the paid
 * upstream call), identical to the previous `autocompletePlaces` server fn.
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
