import { Link } from "@tanstack/react-router";
import { FlaskConical, Heart, LogIn, LogOut, ShieldCheck, User } from "lucide-react";
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
  /**
   * Whether this deployment's preview-only dev-login is active. When `true` AND
   * logged out, a "Dev sign-in" link is shown beside "Log in" so a tester can
   * sign in on a Vercel preview (where Google OAuth can't complete). Resolves
   * `false` in production, so the affordance never renders there.
   */
  previewLoginEnabled?: boolean;
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
export function UserMenu({ user, previewLoginEnabled = false }: UserMenuProps) {
  if (user === null) {
    // Full-page navigation to the OAuth initiation route (not an RPC data
    // fetch) — a plain anchor is the correct mechanism for the redirect dance.
    return (
      <div className="flex items-center gap-1 sm:gap-2">
        {/* Preview-only: Google OAuth can't complete on a per-deployment preview
            URL, so surface the dev-login form as a working alternative. Never
            rendered in production (the query resolves false there). Plain anchor:
            the form page is a full-page server route, not an RPC. */}
        {previewLoginEnabled ? (
          <Button asChild variant="ghost" size="sm">
            <a href="/api/auth/dev-login">
              <FlaskConical aria-hidden className="h-4 w-4" />
              <span className="hidden sm:inline">Dev sign-in</span>
            </a>
          </Button>
        ) : null}
        <Button asChild variant="outline" size="sm">
          <a href="/api/auth/google">
            <LogIn aria-hidden className="h-4 w-4" />
            Log in
          </a>
        </Button>
      </div>
    );
  }

  const initial = user.name.trim().charAt(0).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* Touch ergonomics: >= 44px hit area on coarse pointers (matches the
            hamburger trigger in SiteHeader; the 32px avatar stays centred). */}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="rounded-full pointer-coarse:size-11"
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

      {/* Wider panel on touch so icons + labels breathe at 375px (mirrors the
          SiteHeader nav menu; item touch sizing lives in ui/dropdown-menu). */}
      <DropdownMenuContent align="end" className="w-56 pointer-coarse:w-64">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="font-medium text-foreground">{user.name}</span>
          <span className="truncate text-caption font-normal text-muted-foreground">
            {user.email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {/* The viewer's saved spots (AUB-127 / F9) — signed-in only, since
            favorites are viewer-scoped. Navigation only; the page re-derives the
            viewer from the session server-side. */}
        <DropdownMenuItem asChild>
          <Link to="/favorites">
            <Heart aria-hidden className="h-4 w-4" />
            Favorites
          </Link>
        </DropdownMenuItem>

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
            (not an RPC). The submit BUTTON is the menu item (the form wraps it),
            so the item's entire padded hit area submits — previously the form
            was the item and taps on its padding did nothing. The separator adds
            breathing room so a thumb aiming at the row above can't mis-tap
            sign-out. */}
        <DropdownMenuSeparator />
        <form method="post" action="/api/auth/sign-out">
          <DropdownMenuItem asChild>
            <button type="submit" className="w-full">
              <LogOut aria-hidden className="h-4 w-4" />
              Sign out
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
