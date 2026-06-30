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
 * Layout is mobile-first: a hamburger dropdown holds the nav below `sm`, the
 * inline `<nav>` takes over at `sm` and up.
 */
export function SiteHeader() {
  const { data: user } = useSuspenseQuery(currentUserQuery);

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-x-4 px-4 py-3 sm:gap-x-6 sm:px-6">
        <Link to="/" aria-label="Aubrey's List home">
          <Wordmark />
        </Link>

        {/* Desktop nav: inline links with icons + active state. */}
        <nav aria-label="Primary" className="hidden sm:flex">
          <ul className="flex items-center gap-x-5 text-sm font-medium text-muted-foreground">
            {NAV_ITEMS.map((item) => (
              <li key={item.label}>
                <Link
                  to={item.to}
                  className="inline-flex items-center gap-1.5 hover:text-foreground"
                  activeProps={{ className: "text-foreground" }}
                >
                  {item.Icon ? <item.Icon aria-hidden className="h-4 w-4" /> : null}
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {/* Mobile hamburger: same nav items inside a portal dropdown. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Open menu"
                className="sm:hidden"
              >
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

          <ThemeToggle />
          <UserMenu user={user} />
        </div>
      </div>
    </header>
  );
}
