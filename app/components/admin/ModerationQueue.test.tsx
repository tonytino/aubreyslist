import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ModerationQueue as ModerationQueueData,
  QueueItem,
} from "~/server/moderation/queue.fn";
import { ModerationQueue } from "./ModerationQueue";
import { moderationQueueQueryKey } from "./moderation-queue-query";

/**
 * Component tests for the moderation-queue surface (#40, ACTIONS #41).
 *
 * The queue reads its data from TanStack Query via `useSuspenseQuery`, so we
 * seed the cache directly (no network) and assert the rendered triage context:
 * the target chip (icon SHAPE + TEXT label, never colour alone), the reason, the
 * reporter, the date, and the real Dismiss / Hide / Remove action controls
 * (#41). It also renders TanStack Router `Link`s for targets with a listing, so
 * we mount inside a tiny in-memory router whose tree includes `/listings/$id`.
 *
 * The action server functions are mocked so we assert the UI wires the right
 * payload (exclusive-arc target + prompting flag id) and invalidates the queue on
 * success — the real server gate/validation is covered in `actions.test.ts`. The
 * ACCESS gate itself is covered server-side in `queue.test.ts`; here the cache
 * always holds a granted verdict (what a moderator/admin would receive).
 */

const mocks = vi.hoisted(() => ({
  dismissFlagAction: vi.fn(() => Promise.resolve()),
  hideContentAction: vi.fn(() => Promise.resolve()),
  removeContentAction: vi.fn(() => Promise.resolve()),
  restoreContentAction: vi.fn(() => Promise.resolve()),
}));

vi.mock("~/server/moderation/actions.fn", () => mocks);

afterEach(() => {
  vi.clearAllMocks();
});

function reporter() {
  return { name: "Rep Orter", email: "rep@example.com" };
}

function item(overrides: Partial<QueueItem>): QueueItem {
  return {
    id: "flag-1",
    reason: "spam",
    createdAt: new Date("2026-06-01T00:00:00Z"),
    reporter: reporter(),
    target: { type: "listing", id: "listing-1", label: "Listing", listingId: "listing-1" },
    ...overrides,
  };
}

/** Seed the queue query with `data`, then render inside a router + query client. */
function renderQueue(data: ModerationQueueData) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(moderationQueueQueryKey, data);

  const rootRoute = createRootRoute();
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => (
      <QueryClientProvider client={queryClient}>
        <ModerationQueue />
      </QueryClientProvider>
    ),
  });
  // The link target must exist in the tree for `Link` to resolve.
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/listings/$id",
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([homeRoute, detailRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  // Test-only structural mismatch between the concrete router and the provider's
  // generic default — safe to assert through unknown.
  render(<RouterProvider router={router as unknown as never} />);
}

describe("ModerationQueue", () => {
  it("renders an empty state when there are no open flags", async () => {
    renderQueue({ access: "granted", items: [] });
    expect(await screen.findByText(/No open flags/i)).toBeInTheDocument();
  });

  it("renders a flag with target label, reason, reporter, and date", async () => {
    renderQueue({
      access: "granted",
      items: [
        item({
          reason: "wrong address",
          target: {
            type: "listing",
            id: "listing-1",
            label: "Gluten-Free Grill",
            listingId: "listing-1",
          },
        }),
      ],
    });

    // Target label links to the listing detail page.
    const link = await screen.findByRole("link", { name: "Gluten-Free Grill" });
    expect(link).toHaveAttribute("href", "/listings/listing-1");
    // Target type label is text (icon + label, never colour alone).
    expect(screen.getByText("Listing")).toBeInTheDocument();
    expect(screen.getByText(/wrong address/)).toBeInTheDocument();
    expect(screen.getByText(/Rep Orter/)).toBeInTheDocument();
    expect(screen.getByText(/rep@example\.com/)).toBeInTheDocument();
  });

  it("labels the target type for claim and incident flags", async () => {
    renderQueue({
      access: "granted",
      items: [
        item({
          id: "flag-claim",
          target: {
            type: "claim",
            id: "claim-1",
            label: "Dedicated fryer",
            listingId: "listing-2",
          },
        }),
        item({
          id: "flag-incident",
          target: { type: "incident", id: "incident-1", label: "Got glutened", listingId: null },
        }),
      ],
    });

    expect(await screen.findByText("Claim")).toBeInTheDocument();
    expect(screen.getByText("Incident")).toBeInTheDocument();
    // The incident target has no listing, so it renders as plain text (no link).
    expect(screen.getByText("Got glutened")).toBeInTheDocument();
  });

  it("renders the Dismiss / Hide / Remove action controls (icon + text label) (#41)", async () => {
    renderQueue({ access: "granted", items: [item({})] });

    expect(await screen.findByRole("button", { name: /Dismiss/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Hide/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Remove/i })).toBeEnabled();
  });

  it("Hide calls hideContentAction with the exclusive-arc target + prompting flag id", async () => {
    renderQueue({
      access: "granted",
      items: [
        item({
          id: "flag-7",
          target: { type: "listing", id: "listing-9", label: "Cafe", listingId: "listing-9" },
        }),
      ],
    });

    fireEvent.click(await screen.findByRole("button", { name: /Hide/i }));

    await waitFor(() => expect(mocks.hideContentAction).toHaveBeenCalledTimes(1));
    expect(mocks.hideContentAction).toHaveBeenCalledWith({
      data: { target: "listing", listingId: "listing-9", flagId: "flag-7" },
    });
  });

  it("Dismiss/Remove send the target type matching the flagged content (claim/incident)", async () => {
    renderQueue({
      access: "granted",
      items: [
        item({
          id: "flag-c",
          target: { type: "claim", id: "claim-2", label: "Dedicated fryer", listingId: "l2" },
        }),
      ],
    });

    fireEvent.click(await screen.findByRole("button", { name: /Dismiss/i }));
    await waitFor(() => expect(mocks.dismissFlagAction).toHaveBeenCalledTimes(1));
    expect(mocks.dismissFlagAction).toHaveBeenCalledWith({
      data: { target: "claim", claimId: "claim-2", flagId: "flag-c" },
    });
  });

  it("shows an inline error when an action fails", async () => {
    mocks.removeContentAction.mockRejectedValueOnce(new Error("Requires moderator privileges."));
    renderQueue({ access: "granted", items: [item({})] });

    fireEvent.click(await screen.findByRole("button", { name: /Remove/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/moderator privileges/i);
  });

  it("shows a no-access message when the verdict is not granted", async () => {
    renderQueue({ access: "forbidden" });
    expect(await screen.findByText(/do not have access/i)).toBeInTheDocument();
  });
});
