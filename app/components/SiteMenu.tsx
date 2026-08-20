import { Link } from "@tanstack/react-router";
import { Menu, User } from "lucide-react";
import type { SessionUser } from "~/auth/current-user-query";
import { NAV_ITEMS } from "~/components/nav-items";
import { useThemeToggle } from "~/components/ThemeToggle";
import {
  AccountActionItems,
  AccountIdentityLabel,
  SignedOutMenuItems,
  SignOutItem,
} from "~/components/UserMenu";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";

interface SiteMenuProps {
  /** The signed-in user, or `null` when logged out. */
  user: SessionUser | null;
  /** Whether the preview-only dev-login affordance is active (see `UserMenu`). */
  previewLoginEnabled: boolean;
}

/** Section header inside the combined menu — a non-interactive label. */
function MenuSectionLabel({ children }: { children: string }) {
  return (
    <DropdownMenuLabel className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </DropdownMenuLabel>
  );
}

/**
 * Theme-toggle row (mobile only). Folds the standalone `ThemeToggle` into the
 * combined menu as a real row. `onSelect` preventDefault keeps the menu open so
 * the user can flip the theme and keep browsing — a normal item would close it.
 * Shares `useThemeToggle` with the standalone button, so the icon + label copy
 * match exactly. Meaning is carried by the glyph shape (Moon/Sun) and the text
 * label, never colour alone.
 */
function ThemeMenuRow() {
  const { label, Icon, toggle } = useThemeToggle();
  return (
    <DropdownMenuItem
      onSelect={(event) => {
        event.preventDefault();
        toggle();
      }}
    >
      <Icon aria-hidden className="h-4 w-4" />
      {label}
    </DropdownMenuItem>
  );
}

/**
 * Mobile (below `sm`) combined header menu — one right-anchored dropdown that
 * consolidates the primary nav and the account controls the desktop layout
 * splits apart. At `sm:`+ the header renders inline nav + a standalone theme
 * toggle + the avatar `UserMenu` instead, so this component is CSS-hidden there.
 *
 * Content order:
 *  - signed in: identity → Navigate (Browse/Add/About) → Account (Favorites,
 *    role-gated Admin/Moderation, theme row, Sign out)
 *  - signed out: Navigate → Account (theme row, Log in, preview-only Dev sign-in)
 *
 * The trigger reads as a menu: signed-in shows the user's avatar + a burger
 * glyph (`aria-label="Open menu, signed in as {name}"`); signed-out is a generic
 * menu icon (`aria-label="Open menu"`). Both are >= 44px touch targets. The
 * Navigate/Account rows and the sign-out POST are shared with the desktop
 * `UserMenu` so the two surfaces never drift.
 */
export function SiteMenu({ user, previewLoginEnabled }: SiteMenuProps) {
  const signedIn = user !== null;
  const initial = signedIn ? user.name.trim().charAt(0).toUpperCase() : "";
  const triggerLabel = signedIn ? `Open menu, signed in as ${user.name}` : "Open menu";

  return (
    // Non-modal (a11y): a modal Radix dropdown sets aria-hidden="true" on all
    // background content when open, which puts the SiteFooter's visible,
    // focusable nav links inside an aria-hidden subtree — a serious WCAG 4.1.2
    // (aria-hidden-focus) violation. Non-modal skips the background aria-hiding
    // while Radix still moves focus into the menu and closes it on Escape /
    // outside interaction, so the combined menu stays keyboard-correct without
    // burying the footer from assistive tech.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          aria-label={triggerLabel}
          className="h-11 gap-2 rounded-full px-2.5"
        >
          {signedIn ? (
            user.avatarUrl ? (
              <img src={user.avatarUrl} alt="" className="h-7 w-7 rounded-full object-cover" />
            ) : (
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand text-brand-foreground">
                {initial ? (
                  <span className="text-caption font-semibold">{initial}</span>
                ) : (
                  <User aria-hidden className="h-4 w-4" />
                )}
              </span>
            )
          ) : null}
          <Menu aria-hidden className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64 pointer-coarse:w-72">
        {signedIn ? (
          <>
            <AccountIdentityLabel user={user} />
            <DropdownMenuSeparator />
          </>
        ) : null}

        <MenuSectionLabel>Navigate</MenuSectionLabel>
        {NAV_ITEMS.map((item) => (
          <DropdownMenuItem key={item.label} asChild>
            <Link to={item.to}>
              {item.Icon ? <item.Icon aria-hidden className="h-4 w-4" /> : null}
              {item.label}
            </Link>
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />
        <MenuSectionLabel>Account</MenuSectionLabel>
        {signedIn ? (
          <>
            <AccountActionItems user={user} />
            <ThemeMenuRow />
            <SignOutItem />
          </>
        ) : (
          <>
            <ThemeMenuRow />
            <SignedOutMenuItems previewLoginEnabled={previewLoginEnabled} />
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
