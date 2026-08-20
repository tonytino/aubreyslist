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
   * Whether this deployment's preview-only dev-login is active. When `true` and
   * logged out, a "Dev sign-in" link is shown beside "Log in" so a tester can
   * sign in on a Vercel preview (where Google OAuth can't complete). Resolves
   * `false` in production, so the affordance never renders there.
   */
  previewLoginEnabled?: boolean;
}

// ---------------------------------------------------------------------------
// Shared account rows
//
// These render helpers are the single source of the signed-in and signed-out
// account rows, reused by both the desktop avatar dropdown (below) and the
// mobile combined `SiteMenu`, so the two surfaces cannot drift. Each renders
// `DropdownMenuItem`s and expects to sit inside a `DropdownMenuContent`.
// Touch sizing (>= 44px rows on coarse pointers) is inherited from the
// `DropdownMenuItem` primitive — don't re-add it per row.
// ---------------------------------------------------------------------------

/** Identity block (name + email) for the signed-in account menu. */
export function AccountIdentityLabel({ user }: { user: SessionUser }) {
  return (
    <DropdownMenuLabel className="flex flex-col gap-0.5">
      <span className="font-medium text-foreground">{user.name}</span>
      <span className="truncate text-caption font-normal text-muted-foreground">{user.email}</span>
    </DropdownMenuLabel>
  );
}

/**
 * Signed-in account actions: Favorites (viewer-scoped) and, for moderator+ only,
 * a role-appropriate Admin/Moderation link. Navigation only — the routes
 * re-guard server-side. Sign out is intentionally not here so callers can place
 * their own separator before it.
 */
export function AccountActionItems({ user }: { user: SessionUser }) {
  return (
    <>
      {/* The viewer's saved spots — signed-in only, since favorites are
          viewer-scoped. Navigation only; the page re-derives the viewer from
          the session server-side. */}
      <DropdownMenuItem asChild>
        <Link to="/favorites">
          <Heart aria-hidden className="h-4 w-4" />
          Favorites
        </Link>
      </DropdownMenuItem>

      {/* Link to /admin for moderator+ — the route is RBAC-gated and shows
          role-appropriate sections (admins: roles + settings + queue;
          moderators: only the moderation queue), so the label reflects what the
          viewer will actually see. Server fns re-guard regardless; this is
          navigation only. */}
      {user.role === "admin" || user.role === "moderator" ? (
        <DropdownMenuItem asChild>
          <Link to="/admin">
            <ShieldCheck aria-hidden className="h-4 w-4" />
            {user.role === "admin" ? "Admin" : "Moderation"}
          </Link>
        </DropdownMenuItem>
      ) : null}
    </>
  );
}

/**
 * Sign-out row. A form POST is the right mechanism for a state-changing,
 * full-page action (clears the session server-side then redirects home) — not
 * an RPC. The submit button itself is the menu item (the form wraps it), so the
 * item's entire padded hit area submits — no dead padding.
 */
export function SignOutItem() {
  return (
    <form method="post" action="/api/auth/sign-out">
      <DropdownMenuItem asChild>
        <button type="submit" className="w-full">
          <LogOut aria-hidden className="h-4 w-4" />
          Sign out
        </button>
      </DropdownMenuItem>
    </form>
  );
}

/**
 * Signed-out auth rows as menu items (for the mobile combined menu): the
 * preview-only Dev sign-in (rendered only when `previewLoginEnabled`) plus the
 * always-present Google "Log in". Both are plain anchors — full-page OAuth /
 * dev-login server routes, not RPC data fetches. The desktop `UserMenu` renders
 * these same destinations as buttons in its right cluster instead (see below).
 */
export function SignedOutMenuItems({ previewLoginEnabled }: { previewLoginEnabled: boolean }) {
  return (
    <>
      {previewLoginEnabled ? (
        <DropdownMenuItem asChild>
          <a href="/api/auth/dev-login">
            <FlaskConical aria-hidden className="h-4 w-4" />
            Dev sign-in
          </a>
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem asChild>
        <a href="/api/auth/google">
          <LogIn aria-hidden className="h-4 w-4" />
          Log in
        </a>
      </DropdownMenuItem>
    </>
  );
}

/**
 * Presentational auth control for the header's `sm:`+ right cluster. Takes
 * `user` as a prop (never runs the query itself) so it stays unit-testable in
 * isolation — `SiteHeader` reads the prefetched `currentUserQuery` and passes
 * the result down. Below `sm` the header renders the combined `SiteMenu`
 * instead of this component; it shares the account rows above so content stays
 * in lockstep.
 *
 * - Logged out: compact "Log in" (full-page OAuth redirect; Google is the sole
 *   provider per ADR-006) plus, on previews, a "Dev sign-in" button.
 * - Logged in: an avatar button opening a portal dropdown with the user's
 *   identity, Favorites, a moderator+ Admin/Moderation link, and a POST
 *   sign-out form.
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
              Dev sign-in
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
            combined-menu trigger in SiteMenu; the 32px avatar stays centred). */}
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

      {/* Wider panel on touch so icons + labels breathe at 375px (item touch
          sizing lives in ui/dropdown-menu). */}
      <DropdownMenuContent align="end" className="w-56 pointer-coarse:w-64">
        <AccountIdentityLabel user={user} />
        <DropdownMenuSeparator />
        <AccountActionItems user={user} />
        {/* The separator adds breathing room so a thumb aiming at the row above
            can't mis-tap sign-out. */}
        <DropdownMenuSeparator />
        <SignOutItem />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
