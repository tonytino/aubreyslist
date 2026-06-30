import { List, MagnifyingGlass, Plus } from "@phosphor-icons/react/dist/ssr";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ComponentType } from "react";
import { currentUserQuery } from "~/auth/current-user-query";
import { ThemeToggle } from "~/components/ThemeToggle";
import { UserMenu } from "~/components/UserMenu";
import { Wordmark } from "~/components/Wordmark";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";

interface NavItem {
  to: string;
  label: string;
  Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }> | null;
}

// Primary navigation. Each item targets its real, existing route so the active
// state is accurate.
const NAV_ITEMS: readonly NavItem[] = [
  { to: "/listings", label: "Browse", Icon: MagnifyingGlass },
  { to: "/listings/new", label: "Add a listing", Icon: Plus },
  { to: "/about", label: "About", Icon: null },
];

/**
 * App header. Reads the prefetched current-user query (hydrated from the root
 * loader) and passes the result into the presentational `UserMenu`, so the auth
 * state renders correctly on first paint with no useEffect/useState fetch.
 *
 * Layout is MOBILE-FIRST and identical at every breakpoint (see
 * docs/agents/styling.md → Mobile-first): a hamburger menu on the left holds the
 * primary nav, the brand wordmark is centred, and the theme toggle + account
 * menu sit on the right. The three-column grid (`1fr auto 1fr`) keeps the
 * wordmark optically centred regardless of the side content. The
 * `<nav aria-label="Primary">` wraps the hamburger trigger so the navigation
 * landmark persists even though the items live in a portaled menu.
 */
export function SiteHeader() {
  const { data: user } = useSuspenseQuery(currentUserQuery);

  return (
    <header className="border-b border-border">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-[1fr_auto_1fr] items-center gap-x-2 px-4 py-3 sm:px-6">
        {/* Left: primary nav as a hamburger menu — the same experience at every
            size. The nav items live in a portaled dropdown; the landmark wraps
            the trigger so it persists. */}
        <nav aria-label="Primary" className="justify-self-start">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon" aria-label="Open menu">
                <List aria-hidden className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              {NAV_ITEMS.map((item) => (
                <DropdownMenuItem key={item.label} asChild>
                  <Link to={item.to}>
                    {item.Icon ? <item.Icon aria-hidden className="h-4 w-4" /> : null}
                    {item.label}
                  </Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </nav>

        {/* Centre: brand wordmark, links home. */}
        <Link
          to="/"
          aria-label="Aubrey's List home"
          className="justify-self-center whitespace-nowrap"
        >
          <Wordmark size="sm" />
        </Link>

        {/* Right: theme toggle + account menu / sign-in. */}
        <div className="flex items-center justify-self-end gap-1 sm:gap-2">
          <ThemeToggle />
          <UserMenu user={user} />
        </div>
      </div>
    </header>
  );
}
