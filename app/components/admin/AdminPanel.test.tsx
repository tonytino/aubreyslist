import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminSettingsView } from "~/server/admin/admin-view.fn";

/**
 * Component tests for the admin-panel shell.
 *
 * Two concerns are covered here:
 * - SECTION VISIBILITY (#38): an admin sees all three sections; a moderator sees
 *   only the moderation queue (and so NEVER the admin-only settings/toggle).
 * - The #24 intake-mode TOGGLE: an admin gets an accessible, labelled control set
 *   to the current value, and switching it calls `setIntakeMode` with the right
 *   payload. The server fn is mocked so we assert UI WIRING only — the real
 *   permission gate lives in `set-intake-mode.test.ts`. The control calls
 *   `useRouter().invalidate()` on success, so the panel mounts inside an
 *   in-memory router.
 *
 * The moderation-queue section (#40) fetches via TanStack Query; AdminPanel's own
 * concern is not the queue's data path, so we stub the queue with a marker — its
 * data fetching is covered by `queue.test.ts` / `ModerationQueue.test.tsx`.
 */

const mocks = vi.hoisted(() => ({
  setIntakeMode: vi.fn((_args: unknown) => Promise.resolve({ intakeMode: "manual" as const })),
}));

vi.mock("./ModerationQueue", () => ({
  ModerationQueue: () => <div data-testid="moderation-queue" />,
}));

vi.mock("~/server/admin/set-intake-mode.fn", () => ({
  setIntakeMode: (args: unknown) => mocks.setIntakeMode(args),
}));

import { AdminPanel } from "./AdminPanel";

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
