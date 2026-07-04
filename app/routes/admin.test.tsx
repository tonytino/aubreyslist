import { describe, expect, it } from "vitest";
import { Route } from "./admin";

/**
 * Test for /admin route head() meta tags (AUB-163).
 *
 * Verifies that the noindex,nofollow robots meta tag is present in the route's
 * head() output, preventing search engine indexing of the admin panel.
 */
describe("Admin route — head() meta tags (AUB-163)", () => {
  it("includes noindex,nofollow robots meta tag in head", async () => {
    const headCtx = {} as Parameters<NonNullable<typeof Route.options.head>>[0];
    const headDataOrPromise = Route.options.head?.(headCtx);
    const headData =
      headDataOrPromise instanceof Promise ? await headDataOrPromise : headDataOrPromise;
    expect(headData).toBeDefined();
    expect(headData?.meta).toBeDefined();

    const robotsMeta = (headData?.meta ?? []).find((m) => m?.name === "robots");
    expect(robotsMeta).toBeDefined();
    expect(robotsMeta?.content).toBe("noindex,nofollow");
  });
});
