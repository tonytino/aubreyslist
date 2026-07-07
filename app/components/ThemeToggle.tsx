import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";

type Theme = "light" | "dark";

/**
 * Read the theme currently applied to <html>. The no-FOUC inline script in
 * app/routes/__root.tsx sets the `dark` class before hydration, so this is the
 * source of truth post-mount. SSR-safe: `document` is undefined on the server.
 */
function readAppliedTheme(): Theme {
  if (typeof document === "undefined") {
    return "light";
  }
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/**
 * Shared theme state + toggle logic. UI state (not data) — `useState` + a
 * DOM-syncing handler is the sanctioned pattern here. Toggling flips the `dark`
 * class on <html> and persists the choice to `localStorage["theme"]`.
 *
 * Initial state is "light" so the hydration render matches the server (which
 * always renders "light" — it can't read the client's storage/media). A
 * post-mount effect then reconciles to the actually-applied theme set by the
 * inline script pre-paint, so a dark user's control corrects itself on mount
 * with no hydration mismatch. The page's own theme is already correct pre-paint
 * via that script; only the control's icon/label reconciles here.
 *
 * Exposed as a hook so BOTH the standalone header button (`ThemeToggle`, shown
 * on `sm:`+) and the in-menu theme row (`SiteMenu`, mobile) drive the same
 * behaviour and copy from one place — no drift between the two surfaces.
 *
 * KNOWN COSMETIC LIMITATION (intentionally not fixed): each call site owns its
 * OWN `useState`, so toggling in one instance does not update the other's
 * icon/label. This only surfaces if you resize ACROSS the 640px breakpoint AFTER
 * toggling in the now-hidden instance (a devtools-only edge case) — the actual
 * page theme is always correct (it lives on the `<html>` class, not this state),
 * and the stale control reconciles to the applied theme on its next mount. Only
 * one of the two instances is ever visible at a time, so a shared store /
 * cross-instance listener would add live-state machinery for no user-facing win.
 */
export function useThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    setTheme(readAppliedTheme());
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);

    if (typeof document !== "undefined") {
      document.documentElement.classList.toggle("dark", next === "dark");
    }
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("theme", next);
    }
  }

  const goingDark = theme !== "dark";
  const label = goingDark ? "Switch to dark theme" : "Switch to light theme";
  const Icon = goingDark ? Moon : Sun;

  return { theme, goingDark, label, Icon, toggle };
}

/**
 * Standalone theme-toggle button for the header's right cluster. Rendered on
 * `sm:`+ only; below `sm` the toggle folds into the combined `SiteMenu` as a
 * non-closing menu row (see docs/agents/styling.md → mobile-first). Both share
 * `useThemeToggle`, so the icon + label copy never diverge.
 */
export function ThemeToggle() {
  const { label, Icon, toggle } = useThemeToggle();

  // Icon shape (Moon vs Sun) plus the aria-label carry the meaning — never
  // colour alone. `useThemeToggle` picks the glyph for the current theme.
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      onClick={toggle}
    >
      <Icon aria-hidden className="h-4 w-4" />
    </Button>
  );
}
