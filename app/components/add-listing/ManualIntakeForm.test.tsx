import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CreateListingResult } from "~/listings/create-input";

/**
 * Component tests for the manual intake form. The create server function is
 * mocked — the tests assert the form's a11y wiring (label↔input association,
 * required markers), that a successful write fires a success toast and calls
 * `onCreated`, and that a blocked-duplicate error fires an error toast while the
 * inline "View the existing listing" link still renders (the toast complements,
 * not replaces, the inline dedup message).
 */
const createListingMock = vi.fn((_args: unknown) => Promise.resolve({} as never));
vi.mock("~/server/listings/create.fn", () => ({
  submitCreateListing: (args: unknown) => createListingMock(args),
}));
// Sonner's toast host is mounted in __root; the component only fires toasts, so
// we stub the module and assert the right toast fires on success and error.
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { toast } from "sonner";

import { ManualIntakeForm } from "./ManualIntakeForm";

/**
 * The duplicate-error path renders a TanStack Router `<Link to="/listings/$id">`,
 * so the form must be mounted inside a router whose tree includes that target.
 * We mount a tiny in-memory router around the supplied UI.
 */
function renderInApp(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const rootRoute = createRootRoute();
  const formRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => ui,
  });
  // The link target must exist in the tree for `Link` to type/resolve.
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/listings/$id",
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([formRoute, detailRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      {/* The concrete router type doesn't match the provider's generic default;
          a test-only structural mismatch, safe to assert through unknown. */}
      <RouterProvider router={router as unknown as never} />
    </QueryClientProvider>
  );
}

function fill() {
  fireEvent.change(screen.getByLabelText("Restaurant name"), { target: { value: "Two Hands" } });
  fireEvent.change(screen.getByLabelText("Address"), { target: { value: "123 Main St" } });
  fireEvent.change(screen.getByLabelText("Latitude"), { target: { value: "39.7392" } });
  fireEvent.change(screen.getByLabelText("Longitude"), { target: { value: "-104.9903" } });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("ManualIntakeForm", () => {
  it("associates each label with its input and marks fields required", () => {
    renderInApp(<ManualIntakeForm onCreated={vi.fn()} />);

    for (const name of ["Restaurant name", "Address", "Latitude", "Longitude"]) {
      expect(screen.getByLabelText(name)).toBeRequired();
    }
    // The optional menu link is reachable by its label and is not required.
    expect(screen.getByLabelText(/Menu link/i)).not.toBeRequired();
  });

  it("fires a success toast and calls onCreated when the listing is created", async () => {
    const result = { listing: { id: "l1" }, created: true } as unknown as CreateListingResult;
    createListingMock.mockResolvedValueOnce(result as never);
    const onCreated = vi.fn();
    renderInApp(<ManualIntakeForm onCreated={onCreated} />);

    fill();
    fireEvent.click(screen.getByRole("button", { name: /Add listing/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(result));
    expect(toast.success).toHaveBeenCalledWith("Listing added");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("fires an error toast and still shows the inline dedup link on a duplicate", async () => {
    createListingMock.mockRejectedValueOnce(
      new Error(
        '"Two Hands" is already listed at this address. Open the existing listing instead of adding a duplicate. [[existing-listing:l9]]'
      )
    );
    renderInApp(<ManualIntakeForm onCreated={vi.fn()} />);

    fill();
    fireEvent.click(screen.getByRole("button", { name: /Add listing/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/already listed at this address/i);
    // Inline dedup link is preserved (complemented, not replaced, by the toast).
    expect(screen.getByRole("link", { name: /View the existing listing/i })).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith("This restaurant is already listed.");
  });
});
