import {
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  RouterProvider,
} from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { listingPreviewLinkState, useListingPreview } from "./photo-preview-state";

function DetailProbe() {
  const preview = useListingPreview();
  return <span>{preview ? `${preview.src}|${preview.attributionNames.join(",")}` : "none"}</span>;
}

/**
 * A real `createBrowserHistory()` router (not the in-memory kind other card
 * tests use): this module's whole point is browser `history.state`
 * persistence across a reload, so the regression tests below need jsdom's
 * actual `window.history`, not an isolated in-memory stack.
 */
function buildRouter(linkState?: ReturnType<typeof listingPreviewLinkState>) {
  const rootRoute = createRootRoute();
  const fromRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => (
      <Link to="/listings/$id" params={{ id: "listing-1" }} {...(linkState ?? {})}>
        Go
      </Link>
    ),
  });
  const toRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/listings/$id",
    component: DetailProbe,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([fromRoute, toRoute]),
    history: createBrowserHistory(),
  });
  // The concrete router type doesn't match the provider's generic default; this
  // is a test-only structural mismatch, safe to assert through unknown.
  return router as unknown as never;
}

afterEach(() => {
  // Reset the real browser history between tests — RTL's auto-cleanup unmounts
  // the React tree, but `window.history` is a shared jsdom global this module
  // deliberately reads/writes and must not leak across tests.
  window.history.replaceState(null, "", "/");
});

describe("listingPreviewLinkState", () => {
  it("wraps a photo URL + attribution names as router state", () => {
    expect(listingPreviewLinkState("https://cdn.example.com/x.jpg", ["A Diner"])).toEqual({
      state: {
        listingPreviewSrc: "https://cdn.example.com/x.jpg",
        listingPreviewAttributionNames: ["A Diner"],
      },
    });
  });

  it("omits the attribution key when there are no names (kept truly absent, not an empty array)", () => {
    expect(listingPreviewLinkState("https://cdn.example.com/x.jpg", [])).toEqual({
      state: { listingPreviewSrc: "https://cdn.example.com/x.jpg" },
    });
  });
});

describe("useListingPreview — normal navigation", () => {
  it("reads the preview (src + attribution names) carried by the Link's state", async () => {
    render(
      <RouterProvider
        router={buildRouter(
          listingPreviewLinkState("https://cdn.example.com/x.jpg", ["A Diner", "B Baker"])
        )}
      />
    );
    fireEvent.click(await screen.findByRole("link"));
    expect(
      await screen.findByText("https://cdn.example.com/x.jpg|A Diner,B Baker")
    ).toBeInTheDocument();
  });

  it("is undefined on a direct visit (no state)", async () => {
    render(<RouterProvider router={buildRouter()} />);
    fireEvent.click(await screen.findByRole("link"));
    expect(await screen.findByText("none")).toBeInTheDocument();
  });
});

describe("useListingPreview — refresh regression", () => {
  it("mount-gates the render: a stale history.state at boot is not read synchronously (SSR/hydration parity)", async () => {
    // Seeds the SAME condition a persisted-across-reload `window.history.state`
    // would carry. `__TSR_key` must be present — `createBrowserHistory()` only
    // auto-assigns its own bookkeeping keys when they're ABSENT, so omitting it
    // here would let the router silently overwrite our seed before boot.
    window.history.replaceState(
      { __TSR_key: "seed", __TSR_index: 0, listingPreviewSrc: "https://cdn.example.com/x.jpg" },
      "",
      "/listings/listing-1"
    );

    render(<RouterProvider router={buildRouter()} />);

    // The FIRST paint (before the consuming effect has a chance to run) must
    // match what SSR rendered for this route: no preview.
    expect(screen.queryByText(/cdn\.example\.com/)).not.toBeInTheDocument();
  });

  it("consumes the preview once: history.state no longer carries it after the effect runs", async () => {
    render(
      <RouterProvider
        router={buildRouter(listingPreviewLinkState("https://cdn.example.com/x.jpg", []))}
      />
    );
    fireEvent.click(await screen.findByRole("link"));
    await screen.findByText("https://cdn.example.com/x.jpg|");

    await waitFor(() => expect(window.history.state?.listingPreviewSrc).toBeUndefined());
    // The router's own bookkeeping key survives the strip (a fresh one, since
    // `history.replace` always mints a new key on every call).
    expect(window.history.state?.__TSR_key).toEqual(expect.any(String));
  });

  it("REGRESSION: a reload after the preview was consumed renders nothing — byte-identical to a direct visit", async () => {
    const first = render(
      <RouterProvider
        router={buildRouter(listingPreviewLinkState("https://cdn.example.com/x.jpg", []))}
      />
    );
    fireEvent.click(await screen.findByRole("link"));
    await screen.findByText("https://cdn.example.com/x.jpg|");
    await waitFor(() => expect(window.history.state?.listingPreviewSrc).toBeUndefined());
    first.unmount();

    // A reload boots a brand-new router against whatever the browser's address
    // bar + `history.state` currently hold — exactly what `buildRouter()` does
    // here, since consumption above already stripped the preview from it.
    render(<RouterProvider router={buildRouter()} />);

    expect(screen.queryByText(/cdn\.example\.com/)).not.toBeInTheDocument();
    expect(await screen.findByText("none")).toBeInTheDocument();
  });
});
