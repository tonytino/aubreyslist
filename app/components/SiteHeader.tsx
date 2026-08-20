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
 * One breakpoint switch at `sm` (640px), mobile-first
 * (docs/agents/styling.md):
 *
 *  - Below `sm`: left-aligned wordmark + a single right-anchored combined menu
 *    (`SiteMenu`) holding the primary nav and account controls. The
 *    `<nav aria-label="Primary">` landmark wraps the menu trigger so the
 *    landmark persists even though the items live in a portaled menu.
 *  - `sm:`+ : inline primary nav links ("Add a listing" as the brand-purple
 *    CTA), a standalone `ThemeToggle`, and the avatar `UserMenu`.
 *
 * Exactly one `Primary` nav landmark and one theme control are display-visible
 * at any width (the other variant is CSS-hidden), so the a11y tree never
 * doubles up.
 *
 * The header is `sticky top-0` with an opaque `bg-background`. Its inner row
 * height (`h-16`) is mirrored by the `--site-header-h` token
 * (app/styles/app.css); the directory's sticky filter bar offsets by that token
 * to sit exactly below with no overlap or gap — keep them in sync. Sits at
 * `z-40`: above the directory's sticky filter bar (`z-20`), below Radix
 * overlays (`z-50`) so a menu/sheet always renders over the nav.
 */
export function SiteHeader() {
  const { data: user } = useSuspenseQuery(currentUserQuery);
  const { data: previewLoginEnabled } = useSuspenseQuery(previewLoginEnabledQuery);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background">
      <div className="mx-auto flex h-16 w-full max-w-[96rem] items-center gap-2 px-4 sm:px-6">
        {/* Left: brand wordmark, links home. */}
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
