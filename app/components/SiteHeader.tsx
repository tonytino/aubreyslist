import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { currentUserQuery } from "~/auth/current-user-query";
import { previewLoginEnabledQuery } from "~/auth/preview-login-query";
import { CTA_NAV_TO, NAV_ITEMS } from "~/components/nav-items";
import { SiteMenu } from "~/components/SiteMenu";
import { ThemeToggle } from "~/components/ThemeToggle";
import { UserMenu } from "~/components/UserMenu";
import { Button } from "~/components/ui/button";
import { Wordmark } from "~/components/Wordmark";

/**
 * App header. Reads the prefetched current-user query (hydrated from the root
 * loader) and passes the result into the presentational menus, so the auth
 * state renders correctly on first paint with no useEffect/useState fetch.
 *
 * Layout is MOBILE-FIRST (see docs/agents/styling.md → Mobile-first) with ONE
 * breakpoint switch at `sm` (640px), an owner-approved consolidation:
 *
 *  - Below `sm`: a flex row of left-aligned wordmark + a single right-anchored
 *    combined menu (`SiteMenu`) that holds the primary nav AND the account
 *    controls (theme toggle folded in as a row). No left hamburger. The
 *    `<nav aria-label="Primary">` landmark wraps the menu trigger so the
 *    navigation landmark persists even though the items live in a portaled menu.
 *  - `sm:`+ : the layout splits back apart — inline primary nav links
 *    (directly reachable, "Add a listing" as the brand-purple CTA), a
 *    standalone `ThemeToggle`, and the avatar `UserMenu` in the right cluster.
 *
 * Exactly one `Primary` nav landmark and one theme control are display-visible
 * at any width (the other variant is CSS-hidden), so the a11y tree never
 * doubles up.
 *
 * ALWAYS-VISIBLE (user feedback #2): the header is `sticky top-0` with an opaque
 * `bg-background` so the primary nav stays reachable at any scroll position. Its
 * inner row has a STABLE, known height (`h-16`), mirrored by the `--site-header-h`
 * token (app/styles/app.css) so the directory's own sticky filter bar can offset
 * exactly below it (`sticky top-[var(--site-header-h)]`) with no overlap or gap.
 * Z-INDEX: this sits at `z-40` — above the directory's sticky filter bar (`z-20`)
 * but BELOW Radix overlays (sheet/dialog/dropdown at `z-50`), so a menu/sheet
 * always renders over the nav.
 */
export function SiteHeader() {
  const { data: user } = useSuspenseQuery(currentUserQuery);
  const { data: previewLoginEnabled } = useSuspenseQuery(previewLoginEnabledQuery);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background">
      <div className="mx-auto flex h-16 w-full max-w-[96rem] items-center gap-2 px-4 sm:px-6">
        {/* Left: brand wordmark, links home. Left-aligned (owner decision 2) —
            it takes the space the removed left hamburger vacated. */}
        <Link to="/" aria-label="Aubrey's List home" className="whitespace-nowrap">
          <Wordmark size="sm" />
        </Link>

        {/* Desktop (`sm:`+) inline primary nav — directly reachable links, no
            dropdown. "Add a listing" reads as the brand-purple primary CTA. */}
        <nav aria-label="Primary" className="ml-2 hidden items-center gap-1 sm:flex md:ml-4">
          {NAV_ITEMS.map((item) => {
            const isCta = item.to === CTA_NAV_TO;
            return (
              <Button key={item.label} asChild size="sm" variant={isCta ? "default" : "ghost"}>
                <Link to={item.to}>
                  {item.Icon ? <item.Icon aria-hidden className="h-4 w-4" /> : null}
                  {item.label}
                </Link>
              </Button>
            );
          })}
        </nav>

        {/* Spacer pushes the right cluster to the edge in both layouts. */}
        <div className="flex-1" />

        {/* Mobile (below `sm`): the combined menu, wrapped so the Primary nav
            landmark persists (the menu's items are portaled out of the nav). */}
        <nav aria-label="Primary" className="sm:hidden">
          <SiteMenu user={user} previewLoginEnabled={previewLoginEnabled} />
        </nav>

        {/* Desktop (`sm:`+) right cluster: standalone theme toggle + account. */}
        <div className="hidden items-center gap-1 sm:flex sm:gap-2">
          <ThemeToggle />
          <UserMenu user={user} previewLoginEnabled={previewLoginEnabled} />
        </div>
      </div>
    </header>
  );
}
