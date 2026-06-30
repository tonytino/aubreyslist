import { Moon, Sun } from "@phosphor-icons/react/dist/ssr";
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
 * Theme toggle. UI state (not data) — `useState` + a DOM-syncing handler is the
 * sanctioned pattern here. Toggling flips the `dark` class on <html> and
 * persists the choice to `localStorage["theme"]`.
 *
 * Initial state is "light" so the hydration render matches the server (which
 * always renders "light" — it can't read the client's storage/media). A
 * post-mount effect then reconciles to the actually-applied theme set by the
 * inline script pre-paint, so a dark user's toggle icon corrects itself on
 * mount with no hydration mismatch. The page's own theme is already correct
 * pre-paint via that script; only this button's icon reconciles here.
 */
export function ThemeToggle() {
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

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      onClick={toggle}
    >
      {goingDark ? (
        <Moon aria-hidden className="h-4 w-4" />
      ) : (
        <Sun aria-hidden className="h-4 w-4" />
      )}
    </Button>
  );
}
