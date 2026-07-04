import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { DirectoryPager } from "./DirectoryPager";

/**
 * Tests for the visible browse pager (AUB-200). The pager derives an honest
 * "Page N of M" from the server response's `total`/`pageSize`, renders real
 * `<Link>`s that write `?page=` (carrying every other param via the functional
 * search updater), uses REAL disabled semantics (`<button disabled>`, not a
 * colour-only cue) at the boundaries, and hides entirely when there is only one
 * page. It uses TanStack Router's `Link`, so we mount a minimal in-memory router
 * (mirrors DirectoryList.test.tsx).
 */

function renderInRouter(element: ReactNode, initialPath = "/") {
  const rootRoute = createRootRoute();
  const browseRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <>{element}</>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([browseRoute]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
  render(<RouterProvider router={router as unknown as never} />);
}

describe("DirectoryPager", () => {
  it("is hidden entirely when there is only one page", async () => {
    renderInRouter(
      <>
        <DirectoryPager page={1} pageSize={20} total={12} />
        <p>sentinel</p>
      </>
    );
    // Wait for the router to mount the route component, then assert absence.
    await screen.findByText("sentinel");
    expect(screen.queryByRole("navigation", { name: "Pagination" })).not.toBeInTheDocument();
  });

  it("is hidden when there are no results at all", async () => {
    renderInRouter(
      <>
        <DirectoryPager page={1} pageSize={20} total={0} />
        <p>sentinel</p>
      </>
    );
    await screen.findByText("sentinel");
    expect(screen.queryByRole("navigation", { name: "Pagination" })).not.toBeInTheDocument();
  });

  it("shows an honest 'Page N of M' derived from total/pageSize", async () => {
    // 45 results at 20/page → 3 pages.
    renderInRouter(<DirectoryPager page={2} pageSize={20} total={45} />);
    expect(await screen.findByRole("navigation", { name: "Pagination" })).toBeInTheDocument();
    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
  });

  it("on page 1: Previous is a REAL disabled button, Next links to ?page=2", async () => {
    renderInRouter(<DirectoryPager page={1} pageSize={20} total={45} />);

    const prev = await screen.findByRole("button", { name: "Previous" });
    expect(prev).toBeDisabled();

    const next = screen.getByRole("link", { name: "Next" });
    expect(next).toHaveAttribute("href", "/?page=2");
  });

  it("on the last page: Next is a REAL disabled button, Previous links back", async () => {
    renderInRouter(<DirectoryPager page={3} pageSize={20} total={45} />);

    const next = await screen.findByRole("button", { name: "Next" });
    expect(next).toBeDisabled();

    const prev = screen.getByRole("link", { name: "Previous" });
    expect(prev).toHaveAttribute("href", "/?page=2");
  });

  it("on a middle page: both directions are live links", async () => {
    // NOTE: the minimal test router has no stripSearchParams middleware, so
    // `page=1` appears literally here; in the app the route strips it to `/`.
    renderInRouter(<DirectoryPager page={2} pageSize={20} total={45} />);

    expect(await screen.findByRole("link", { name: "Previous" })).toHaveAttribute(
      "href",
      "/?page=1"
    );
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute("href", "/?page=3");
  });

  it("carries other active search params forward in the page links", async () => {
    // The functional search updater must preserve sibling params (URL-state Hard
    // Rule) — paging never drops an active filter/sort.
    renderInRouter(<DirectoryPager page={2} pageSize={20} total={45} />, "/?page=2&sort=trust");

    const next = await screen.findByRole("link", { name: "Next" });
    expect(next.getAttribute("href")).toContain("sort=trust");
    expect(next.getAttribute("href")).toContain("page=3");
  });
});
