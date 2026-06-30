import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import type { SessionUser } from "~/auth/current-user-query";
import { UserMenu } from "./UserMenu";

/**
 * Unit tests for the presentational `UserMenu`. It takes `user` as a prop, so
 * no query is needed — but it renders TanStack Router `<Link>`s, so it must
 * mount inside a router whose tree includes every link target (`/admin`).
 *
 * Radix DropdownMenu drives open/close through pointer-capture and scrolls the
 * focused item into view — both unimplemented in jsdom. Stub them so the menu
 * opens on a fired keyboard event (mirrors dropdown-menu.test.tsx).
 */
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

function renderMenu(user: SessionUser | null) {
  const rootRoute = createRootRoute({
    component: () => <UserMenu user={user} />,
  });
  // Link targets must exist in the tree for `Link` to resolve.
  const adminRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/admin",
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([adminRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  // The concrete router type doesn't match the provider's generic default; this
  // is a test-only structural mismatch, safe to assert through unknown.
  render(<RouterProvider router={router as unknown as never} />);
}

function openMenu(user: SessionUser) {
  const trigger = screen.getByRole("button", { name: `Account menu for ${user.name}` });
  // Radix's pointer-open path relies on real PointerEvents jsdom can't fully
  // synthesize, so open via the keyboard path (focus + Enter).
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
}

const baseUser: Omit<SessionUser, "role"> = {
  id: "user-1",
  name: "Ada Lovelace",
  email: "ada@example.com",
  avatarUrl: null,
};

describe("UserMenu", () => {
  it("shows the Admin link for an admin user", () => {
    const user: SessionUser = { ...baseUser, role: "admin" };
    renderMenu(user);
    openMenu(user);

    const adminLink = screen.getByRole("menuitem", { name: "Admin" });
    expect(adminLink).toBeInTheDocument();
    expect(adminLink).toHaveAttribute("href", "/admin");
  });

  it("hides the Admin link for a moderator", () => {
    const user: SessionUser = { ...baseUser, role: "moderator" };
    renderMenu(user);
    openMenu(user);

    expect(screen.queryByRole("menuitem", { name: "Admin" })).not.toBeInTheDocument();
    expect(screen.queryByText("Admin")).not.toBeInTheDocument();
  });

  it("hides the Admin link for a regular user", () => {
    const user: SessionUser = { ...baseUser, role: "user" };
    renderMenu(user);
    openMenu(user);

    expect(screen.queryByRole("menuitem", { name: "Admin" })).not.toBeInTheDocument();
  });

  it("shows Sign out for any logged-in user", () => {
    const user: SessionUser = { ...baseUser, role: "user" };
    renderMenu(user);
    openMenu(user);

    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeInTheDocument();
  });

  it("shows the user's name and email in the menu label", () => {
    const user: SessionUser = { ...baseUser, role: "user" };
    renderMenu(user);
    openMenu(user);

    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
  });

  it("shows Continue with Google and no avatar menu when logged out", () => {
    renderMenu(null);

    const cta = screen.getByRole("link", { name: /Continue with Google/ });
    expect(cta).toHaveAttribute("href", "/api/auth/google");
    expect(screen.queryByRole("button", { name: /Account menu/ })).not.toBeInTheDocument();
  });
});
