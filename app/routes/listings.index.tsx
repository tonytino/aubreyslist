import { createFileRoute, redirect } from "@tanstack/react-router";
import { browseSearchSchema } from "~/listings/browse-search";

/**
 * `/listings` → `/` permanent redirect. The directory lives at the home page
 * (`/`); this route exists only so old/shared `/listings…` links (and the
 * search params they carry) keep working.
 *
 * It validates the incoming search with the same `browseSearchSchema` the
 * directory uses, then forwards the canonical search to `/` in `beforeLoad`
 * — so `/listings?page=2&sort=trust` lands on `/?page=2&sort=trust` with
 * every param preserved. Redirecting in `beforeLoad` runs before any loader,
 * so no directory data is fetched twice.
 */
export const Route = createFileRoute("/listings/")({
  validateSearch: browseSearchSchema,
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/", search });
  },
});
