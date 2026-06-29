import { createServerFn } from "@tanstack/react-start";
import {
  type PlaceDetails,
  type PlacePrediction,
  type PlacesResult,
  autocompleteInputSchema,
  placeDetailsInputSchema,
} from "~/listings/places-input";

/**
 * Client-callable Google Places server functions (issue #26; #141 boundary).
 *
 * The ONLY part of the Places provider that client code (the `PlacesIntakeForm`
 * search/confirm UI) imports. Mirroring the lazy-`import()` `*.fn.ts` seam
 * (`app/server/listings/create.fn.ts`, `app/server/admin/set-intake-mode.fn.ts`),
 * the db-touching implementation lives in `~/server/places` and is referenced
 * ONLY from inside these handlers via dynamic `import()`s — so the bundler strips
 * it and its `getDb` (neon/drizzle) graph out of the `listings.new` client chunk.
 *
 * `places.ts` exports a module-level `getIntakeMode()` (a non-handler `getDb()`
 * read) reachable from the `autocompletePlaces`/`getPlaceDetails` exports, so a
 * direct value-import of those from a client component pulls drizzle/neon in even
 * though their handler bodies are stripped; routing through this lazy seam closes
 * that.
 *
 * The Zod validators are the client-safe schemas (`autocompleteInputSchema` /
 * `placeDetailsInputSchema` pull in no `~/db` value import), and the result
 * types are type-only (erased at build), so binding them here stays db-free.
 *
 * Auth + rate-limit are enforced SERVER-SIDE inside the lazily-imported runners'
 * callers below (`requireCurrentUser` -> 401, `enforceWriteLimit` -> 429),
 * identical to the previous `autocompletePlaces`/`getPlaceDetails` server fns.
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

export const getPlaceDetails = createServerFn({ method: "POST" })
  .validator(placeDetailsInputSchema)
  .handler(async ({ data }): Promise<PlacesResult<PlaceDetails>> => {
    const [{ runPlaceDetails }, { requireCurrentUser }, { enforceWriteLimit }] = await Promise.all([
      import("~/server/places"),
      import("~/server/auth/guards"),
      import("~/server/rate-limit"),
    ]);
    const user = await requireCurrentUser();
    await enforceWriteLimit(user.id);
    return runPlaceDetails(data);
  });
