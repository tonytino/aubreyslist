import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "~/auth/current-user-query";
import { SiteMenu } from "./SiteMenu";

/**
 * Unit tests for the mobile combined `SiteMenu`. Like `UserMenu`, it takes
 * `user` as a prop (no query) but renders TanStack Router `<Link>`s, so it
 * mounts inside a router whose tree includes every link target. Radix drives
 * open/close through pointer-capture + scrollIntoView (both unimplemented in
 * jsdom), so we stub them and open via the keyboard path.
 */
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

beforeEach(() => {
  document.documentElement.classList.remove("dark");
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("dark");
  localStorage.clear();
});

function renderMenu(user: SessionUser | null, previewLoginEnabled = false) {
  const rootRoute = createRootRoute({
    component: () => <SiteMenu user={user} previewLoginEnabled={previewLoginEnabled} />,
  });
  const childPaths = ["/listings/new", "/about", "/admin", "/favorites"] as const;
  const children = childPaths.map((path) =>
    createRoute({ getParentRoute: () => rootRoute, path, component: () => null })
  );
  const router = createRouter({
    routeTree: rootRoute.addChildren(children),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  // Test-only structural mismatch, safe to assert through unknown.
  render(<RouterProvider router={router as unknown as never} />);
}

async function openMenu(triggerName: string | RegExp) {
  const trigger = await screen.findByRole("button", { name: triggerName });
  // Radix's pointer-open path relies on real PointerEvents jsdom can't fully
  // synthesize, so open via the keyboard path (focus + Enter).
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
  return trigger;
}

const baseUser: Omit<SessionUser, "role"> = {
  id: "user-1",
  name: "Ada Lovelace",
  email: "ada@example.com",
  avatarUrl: null,
};

describe("SiteMenu — signed out", () => {
  it("uses a generic 'Open menu' trigger and renders Navigate + Account sections", async () => {
    renderMenu(null);
    await openMenu("Open menu");

    expect(screen.getByText("Navigate")).toBeInTheDocument();
    expect(screen.getByText("Account")).toBeInTheDocument();
    // Navigate group.
    expect(screen.getByRole("menuitem", { name: "Browse" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("menuitem", { name: "Add a listing" })).toHaveAttribute(
      "href",
      "/listings/new"
    );
    expect(screen.getByRole("menuitem", { name: "About" })).toHaveAttribute("href", "/about");
    // Account group: theme row + Log in, no signed-in rows.
    expect(screen.getByRole("menuitem", { name: "Log in" })).toHaveAttribute(
      "href",
      "/api/auth/google"
    );
    expect(screen.queryByRole("menuitem", { name: "Favorites" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Sign out" })).not.toBeInTheDocument();
  });

  it("hides Dev sign-in by default (production)", async () => {
    renderMenu(null, false);
    await openMenu("Open menu");
    expect(screen.queryByRole("menuitem", { name: /Dev sign-in/ })).not.toBeInTheDocument();
  });

  it("shows Dev sign-in only when preview login is enabled", async () => {
    renderMenu(null, true);
    await openMenu("Open menu");
    expect(screen.getByRole("menuitem", { name: /Dev sign-in/ })).toHaveAttribute(
      "href",
      "/api/auth/dev-login"
    );
  });
});

describe("SiteMenu — signed in", () => {
  it("labels the trigger with the user's name and shows identity + Favorites", async () => {
    const user: SessionUser = { ...baseUser, role: "user" };
    renderMenu(user);
    await openMenu("Open menu, signed in as Ada Lovelace");

    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Favorites" })).toHaveAttribute(
      "href",
      "/favorites"
    );
  });

  it("shows an Admin link for an admin and Moderation for a moderator, gated off for a user", async () => {
    const admin: SessionUser = { ...baseUser, role: "admin" };
    renderMenu(admin);
    await openMenu("Open menu, signed in as Ada Lovelace");
    expect(screen.getByRole("menuitem", { name: "Admin" })).toHaveAttribute("href", "/admin");
    cleanup();

    const mod: SessionUser = { ...baseUser, role: "moderator" };
    renderMenu(mod);
    await openMenu("Open menu, signed in as Ada Lovelace");
    expect(screen.getByRole("menuitem", { name: "Moderation" })).toHaveAttribute("href", "/admin");
    expect(screen.queryByRole("menuitem", { name: "Admin" })).not.toBeInTheDocument();
    cleanup();

    const regular: SessionUser = { ...baseUser, role: "user" };
    renderMenu(regular);
    await openMenu("Open menu, signed in as Ada Lovelace");
    expect(screen.queryByRole("menuitem", { name: "Admin" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Moderation" })).not.toBeInTheDocument();
  });

  it("renders Sign out as a submit button inside the POST sign-out form", async () => {
    const user: SessionUser = { ...baseUser, role: "user" };
    renderMenu(user);
    await openMenu("Open menu, signed in as Ada Lovelace");

    const signOut = screen.getByRole("menuitem", { name: "Sign out" });
    expect(signOut.tagName).toBe("BUTTON");
    expect(signOut).toHaveAttribute("type", "submit");
    const form = signOut.closest("form");
    expect(form).toHaveAttribute("method", "post");
    expect(form).toHaveAttribute("action", "/api/auth/sign-out");
  });
});

describe("SiteMenu — theme row", () => {
  it("toggles the theme from the in-menu row (icon + label carry the meaning)", async () => {
    renderMenu(null);
    await openMenu("Open menu");

    const themeRow = screen.getByRole("menuitem", { name: "Switch to dark theme" });
    // Selecting the row flips the applied theme (and persists it) — the row is a
    // real control, not a link.
    fireEvent.click(themeRow);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("theme")).toBe("dark");

    // The menu stays open (onSelect preventDefault) so the user can keep
    // browsing after toggling — a normal item would close it. Both the rest of
    // the menu and the flipped theme row remain in the document.
    expect(screen.getByRole("menuitem", { name: "Log in" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Switch to light theme" })).toBeInTheDocument();
  });
});
