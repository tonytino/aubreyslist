import { ShieldCheck, SignIn, SignOut, User } from "@phosphor-icons/react/dist/ssr";
import { Link } from "@tanstack/react-router";
import type { SessionUser } from "~/auth/current-user-query";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";

interface UserMenuProps {
  /** The signed-in user, or `null` when logged out. */
  user: SessionUser | null;
}

/**
 * Presentational auth control for the header. Takes `user` as a prop (never
 * runs the query itself) so it stays unit-testable in isolation — `SiteHeader`
 * reads the prefetched `currentUserQuery` and passes the result down.
 *
 * - Logged out: a compact "Log in" anchor (full-page OAuth redirect; Google is
 *   the sole provider per ADR-006, but the header CTA stays generic).
 * - Logged in: an avatar button opening a portal dropdown with the user's
 *   identity, a moderation/admin link for moderator+ roles, and a POST sign-out
 *   form.
 */
export function UserMenu({ user }: UserMenuProps) {
  if (user === null) {
    // Full-page navigation to the OAuth initiation route (not an RPC data
    // fetch) — a plain anchor is the correct mechanism for the redirect dance.
    return (
      <Button asChild variant="outline" size="sm">
        <a href="/api/auth/google">
          <SignIn aria-hidden className="h-4 w-4" />
          Log in
        </a>
      </Button>
    );
  }

  const initial = user.name.trim().charAt(0).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="rounded-full"
          aria-label={`Account menu for ${user.name}`}
        >
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
          ) : (
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
              {initial ? (
                <span className="text-sm font-medium">{initial}</span>
              ) : (
                <User aria-hidden className="h-4 w-4" />
              )}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="font-medium text-foreground">{user.name}</span>
          <span className="truncate text-caption font-normal text-muted-foreground">
            {user.email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {/* Link to /admin for moderator+ — the route is RBAC-gated and shows
            role-appropriate sections (admins: roles + settings + queue;
            moderators: only the moderation queue), so the label reflects what
            the viewer will actually see. Server fns re-guard regardless; this is
            navigation only. */}
        {user.role === "admin" || user.role === "moderator" ? (
          <DropdownMenuItem asChild>
            <Link to="/admin">
              <ShieldCheck aria-hidden className="h-4 w-4" />
              {user.role === "admin" ? "Admin" : "Moderation"}
            </Link>
          </DropdownMenuItem>
        ) : null}

        {/* Sign-out clears the session server-side then redirects home; a form
            POST is the right mechanism for a state-changing, full-page action
            (not an RPC). The submit button is the menu item itself. */}
        <DropdownMenuItem asChild>
          <form method="post" action="/api/auth/sign-out">
            <button type="submit" className="flex w-full items-center gap-2">
              <SignOut aria-hidden className="h-4 w-4" />
              Sign out
            </button>
          </form>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
