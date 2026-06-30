import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminSettingsView } from "~/server/admin/admin-view.fn";

/**
 * Component tests for the admin-panel shell.
 *
 * Concerns covered here:
 * - SECTION VISIBILITY (#38): an admin sees all three sections; a moderator sees
 *   only the moderation queue (and so NEVER the admin-only settings/toggle OR the
 *   role-management section).
 * - The #24 intake-mode TOGGLE: an admin gets an accessible, labelled control set
 *   to the current value, and switching it calls `setIntakeMode` with the right
 *   payload.
 * - The #142 ROLE-MANAGEMENT section: an admin sees the user directory (from the
 *   mocked `listUsers`), can grant/revoke the moderator role via the mocked
 *   `setUserRole` (asserting the right payload), and a server error — including
 *   the last-admin 409 — surfaces as an inline alert. Admin accounts expose no
 *   role control.
 *
 * All server fns are mocked, so we assert UI WIRING only — the real permission
 * gates live in `set-intake-mode.test.ts`, `set-role.test.ts`, and
 * `list-users.test.ts`. The intake-mode control calls `useRouter().invalidate()`
 * on success, so the panel mounts inside an in-memory router.
 *
 * The moderation-queue section (#40) fetches via TanStack Query; AdminPanel's own
 * concern is not the queue's data path, so we stub the queue with a marker — its
 * data fetching is covered by `queue.test.ts` / `ModerationQueue.test.tsx`.
 */

const mocks = vi.hoisted(() => ({
  setIntakeMode: vi.fn((_args: unknown) => Promise.resolve({ intakeMode: "manual" as const })),
  listUsers: vi.fn<() => Promise<unknown>>(),
  setUserRole: vi.fn<(args: unknown) => Promise<unknown>>(),
}));

vi.mock("./ModerationQueue", () => ({
  ModerationQueue: () => <div data-testid="moderation-queue" />,
}));

vi.mock("~/server/admin/set-intake-mode.fn", () => ({
  setIntakeMode: (args: unknown) => mocks.setIntakeMode(args),
}));

vi.mock("~/server/admin/list-users.fn", () => ({
  listUsers: () => mocks.listUsers(),
}));

vi.mock("~/server/admin/set-role.fn", () => ({
  setUserRole: (args: unknown) => mocks.setUserRole(args),
}));

import { AdminPanel } from "./AdminPanel";

/** A directory row matching `AdminUserSummary` (id/email/name/role only). */
function account(
  overrides: Partial<{ id: string; email: string; name: string; role: string }> = {}
) {
  return {
    id: "u-user",
    email: "user@example.com",
    name: "Sam User",
    role: "user",
    ...overrides,
  };
}

// Radix Dialog (the role-change confirm) drives focus/scroll through APIs that
// jsdom does not implement; stub them so the dialog opens on a fired click.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

beforeEach(() => {
  // Default directory: one promotable user. Role tests override per-case.
  mocks.listUsers.mockResolvedValue([account()]);
  mocks.setUserRole.mockResolvedValue({ user: account({ role: "moderator" }) });
});

afterEach(() => {
  vi.clearAllMocks();
});

function settings(overrides: Partial<AdminSettingsView> = {}): AdminSettingsView {
  return { intakeMode: "places", stalenessMonths: 6, ...overrides };
}

/** Mount `ui` inside an in-memory router + query client (the panel uses both). */
function renderInApp(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({
    component: () => <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  // Test-only structural mismatch between the concrete router and the provider's
  // generic default — safe to assert through unknown.
  render(<RouterProvider router={router as unknown as never} />);
}

describe("AdminPanel — section visibility", () => {
  it("shows all three sections to an admin", async () => {
    renderInApp(<AdminPanel viewerRole="admin" settings={settings()} />);
    expect(await screen.findByRole("heading", { name: "App settings" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Role management" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Moderation queue" })).toBeInTheDocument();
  });

  it("shows only the moderation queue to a moderator (no admin-only settings/toggle)", async () => {
    renderInApp(<AdminPanel viewerRole="moderator" settings={null} />);
    expect(await screen.findByRole("heading", { name: "Moderation queue" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "App settings" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Role management" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/intake mode/i)).not.toBeInTheDocument();
  });
});

describe("AdminPanel — intake-mode toggle (#24)", () => {
  it("shows the admin an accessible, labelled control set to the current value", async () => {
    renderInApp(<AdminPanel viewerRole="admin" settings={settings({ intakeMode: "places" })} />);

    const select = await screen.findByLabelText(/intake mode/i);
    expect(select).toBeInstanceOf(HTMLSelectElement);
    expect((select as HTMLSelectElement).value).toBe("places");
    expect(screen.getByRole("option", { name: /places/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /manual/i })).toBeInTheDocument();
  });

  it("reflects 'manual' as the current value when that mode is active", async () => {
    renderInApp(<AdminPanel viewerRole="admin" settings={settings({ intakeMode: "manual" })} />);

    const select = (await screen.findByLabelText(/intake mode/i)) as HTMLSelectElement;
    expect(select.value).toBe("manual");
  });

  it("calls setIntakeMode with the chosen mode when an admin switches", async () => {
    renderInApp(<AdminPanel viewerRole="admin" settings={settings({ intakeMode: "places" })} />);

    fireEvent.change(await screen.findByLabelText(/intake mode/i), {
      target: { value: "manual" },
    });

    await waitFor(() => {
      expect(mocks.setIntakeMode).toHaveBeenCalledTimes(1);
    });
    expect(mocks.setIntakeMode).toHaveBeenCalledWith({ data: { mode: "manual" } });
  });

  it("keeps the staleness window visible (read-only) alongside the toggle", async () => {
    renderInApp(<AdminPanel viewerRole="admin" settings={settings({ stalenessMonths: 9 })} />);

    expect(await screen.findByLabelText(/intake mode/i)).toBeInTheDocument();
    expect(screen.getByText("9 months")).toBeInTheDocument();
  });
});

describe("AdminPanel — role management (#142)", () => {
  it("lists accounts with their current role for an admin", async () => {
    mocks.listUsers.mockResolvedValue([
      account({ id: "u1", name: "Ada Admin", email: "ada@example.com", role: "admin" }),
      account({ id: "u2", name: "Mo Mod", email: "mo@example.com", role: "moderator" }),
      account({ id: "u3", name: "Sam User", email: "sam@example.com", role: "user" }),
    ]);
    renderInApp(<AdminPanel viewerRole="admin" settings={settings()} />);

    // Each account's name + current role (as TEXT, not colour) appear.
    expect(await screen.findByText("Ada Admin")).toBeInTheDocument();
    expect(screen.getByText("Mo Mod")).toBeInTheDocument();
    expect(screen.getByText("Sam User")).toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getAllByText("Moderator").length).toBeGreaterThan(0);
  });

  it("does NOT show a role control for an admin account (can't change admins here)", async () => {
    mocks.listUsers.mockResolvedValue([
      account({ id: "u1", name: "Ada Admin", email: "ada@example.com", role: "admin" }),
    ]);
    renderInApp(<AdminPanel viewerRole="admin" settings={settings()} />);

    await screen.findByText("Ada Admin");
    expect(screen.queryByLabelText(/set role for ada admin/i)).not.toBeInTheDocument();
    expect(screen.getByText(/can't be changed here/i)).toBeInTheDocument();
  });

  it("calls setUserRole with the chosen role when an admin promotes a user (via confirm dialog)", async () => {
    mocks.listUsers.mockResolvedValue([
      account({ id: "u-target", name: "Sam User", email: "sam@example.com", role: "user" }),
    ]);
    renderInApp(<AdminPanel viewerRole="admin" settings={settings()} />);

    // The role control now opens a confirmation dialog; the mutation must NOT
    // fire until the admin explicitly confirms inside it (the dialog gates the
    // click — it is not the authorization; the server fn still re-gates).
    fireEvent.click(await screen.findByLabelText(/set role for sam user/i));
    expect(mocks.setUserRole).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /make moderator/i }));

    await waitFor(() => {
      expect(mocks.setUserRole).toHaveBeenCalledTimes(1);
    });
    expect(mocks.setUserRole).toHaveBeenCalledWith({
      data: { userId: "u-target", role: "moderator" },
    });
  });

  it("does NOT fire the mutation when the admin cancels the confirm dialog", async () => {
    mocks.listUsers.mockResolvedValue([
      account({ id: "u-target", name: "Sam User", email: "sam@example.com", role: "user" }),
    ]);
    renderInApp(<AdminPanel viewerRole="admin" settings={settings()} />);

    fireEvent.click(await screen.findByLabelText(/set role for sam user/i));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /cancel/i }));

    expect(mocks.setUserRole).not.toHaveBeenCalled();
  });

  it("surfaces the last-admin 409 as an inline alert rather than crashing", async () => {
    mocks.listUsers.mockResolvedValue([
      account({ id: "u-mod", name: "Mo Mod", email: "mo@example.com", role: "moderator" }),
    ]);
    mocks.setUserRole.mockRejectedValue(new Error("Cannot demote the last remaining admin."));
    renderInApp(<AdminPanel viewerRole="admin" settings={settings()} />);

    // Demoting a moderator is a destructive role change → confirm in the dialog.
    fireEvent.click(await screen.findByLabelText(/set role for mo mod/i));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /revoke moderator/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Cannot demote the last remaining admin.");
  });

  it("does not render the role section to a moderator (no directory fetch)", async () => {
    renderInApp(<AdminPanel viewerRole="moderator" settings={null} />);

    await screen.findByRole("heading", { name: "Moderation queue" });
    expect(screen.queryByRole("heading", { name: "Role management" })).not.toBeInTheDocument();
    // The admin-only directory must never be fetched for a moderator.
    expect(mocks.listUsers).not.toHaveBeenCalled();
  });
});
