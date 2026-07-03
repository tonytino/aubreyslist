import { createFileRoute, redirect } from "@tanstack/react-router";
import { browseSearchSchema } from "~/listings/browse-search";

/**
 * `/listings` → `/` permanent redirect (AUB-116). The Denver directory moved to
 * the home page (`/`); this route is kept only so old/shared `/listings…` links
 * (and the search params they carry) keep working.
 *
 * It validates the incoming search with the SAME `browseSearchSchema` the
 * directory uses, then forwards the canonical, well-formed search to `/` in
 * `beforeLoad` — so `/listings?page=2&sort=trust` lands on `/?page=2&sort=trust`
 * with every param (`?page=`, `?attrs=`, `?sort=`, `?q=`, `?lat=`/`?lng=`,
 * `?radius=`) preserved. Redirecting in `beforeLoad` runs before any loader, so
 * no directory data is fetched twice.
 */
export const Route = createFileRoute("/listings/")({
  validateSearch: browseSearchSchema,
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/", search });
  },
});
