import { describe, expect, it } from "vitest";
import { Route } from "./style-guide";

/**
 * Test for /style-guide route head() meta tags (AUB-163).
 *
 * Verifies that the noindex,nofollow robots meta tag is present in the route's
 * head() output, preventing search engine indexing of the internal style guide.
 */
describe("StyleGuide route — head() meta tags (AUB-163)", () => {
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
