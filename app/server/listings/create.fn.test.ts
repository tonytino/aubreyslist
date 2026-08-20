import { HTTPException } from "hono/http-exception";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Guard tests for the add-listing write seam (`submitCreateListing`) — the
 * server fn the intake forms call, so it is the live call-site for the auth +
 * per-user write-limit gate. The seam lazy-imports its collaborators (the
 * pure `runCreateListing` impl, the auth guard, the limiter) inside the
 * handler; all three are mocked to assert the gate without cookie/DB
 * plumbing:
 *
 *   - anonymous  -> 401, and the impl is not invoked,
 *   - over-limit -> 429, and the impl is not invoked,
 *   - happy path -> requireCurrentUser, then enforceWriteLimit, then the impl.
 *
 * `runCreateListing`'s own dedup/insert logic is covered in `create.test.ts`;
 * the guards' window logic in `auth/guards.test.ts` and
 * `rate-limit/index.test.ts`.
 */

const runCreateListingMock = vi.fn((_input: unknown, _createdBy?: string | null) =>
  Promise.resolve({ listing: { id: "listing-1" }, created: true })
);
vi.mock("./create", () => ({
  runCreateListing: (input: unknown, createdBy?: string | null) =>
    runCreateListingMock(input, createdBy),
}));

const requireCurrentUserMock = vi.fn(() => Promise.resolve({ id: "user-1" }));
vi.mock("~/server/auth/guards", () => ({
  requireCurrentUser: () => requireCurrentUserMock(),
}));

const enforceWriteLimitMock = vi.fn((_userId?: string) => Promise.resolve());
vi.mock("~/server/rate-limit", () => ({
  enforceWriteLimit: (userId?: string) => enforceWriteLimitMock(userId),
}));

import { callServerFn } from "../../../tests/server-fn";
import { submitCreateListing } from "./create.fn";

const placesInput = { data: { mode: "places" as const, placeId: "place-123" } };
const call = () => callServerFn(() => submitCreateListing(placesInput));

afterEach(() => {
  vi.clearAllMocks();
});

describe("submitCreateListing — auth + rate limit seam (#141)", () => {
  it("gates auth then the write limit then the impl, in that order", async () => {
    await call();

    expect(requireCurrentUserMock).toHaveBeenCalledTimes(1);
    expect(enforceWriteLimitMock).toHaveBeenCalledTimes(1);
    expect(enforceWriteLimitMock).toHaveBeenCalledWith("user-1");
    expect(runCreateListingMock).toHaveBeenCalledTimes(1);
    // The authed user rides along as the links' `createdBy` provenance.
    expect(runCreateListingMock).toHaveBeenCalledWith(placesInput.data, "user-1");

    // Auth before limit before the write — the security ordering.
    const authOrder = requireCurrentUserMock.mock.invocationCallOrder[0];
    const limitOrder = enforceWriteLimitMock.mock.invocationCallOrder[0];
    const implOrder = runCreateListingMock.mock.invocationCallOrder[0];
    expect(authOrder).toBeDefined();
    expect(limitOrder).toBeDefined();
    expect(implOrder).toBeDefined();
    expect(authOrder as number).toBeLessThan(limitOrder as number);
    expect(limitOrder as number).toBeLessThan(implOrder as number);
  });

  it("rejects an anonymous caller (401) before the limiter and the write", async () => {
    const unauthorized = new HTTPException(401, { message: "Authentication required." });
    requireCurrentUserMock.mockRejectedValueOnce(unauthorized);

    await expect(call()).rejects.toBe(unauthorized);
    expect(enforceWriteLimitMock).not.toHaveBeenCalled();
    expect(runCreateListingMock).not.toHaveBeenCalled();
  });

  it("does not perform the write when the rate limit is exceeded (429)", async () => {
    const tooFast = new HTTPException(429, { message: "too fast" });
    enforceWriteLimitMock.mockRejectedValueOnce(tooFast);

    await expect(call()).rejects.toBe(tooFast);
    expect(requireCurrentUserMock).toHaveBeenCalledTimes(1);
    expect(runCreateListingMock).not.toHaveBeenCalled();
  });
});
