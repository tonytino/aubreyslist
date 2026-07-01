import { HTTPException } from "hono/http-exception";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Guard tests for the Places autocomplete SEAM (`autocompletePlaces`, #141).
 *
 * This is the server fn `PlacesIntakeForm` actually calls, so it — not the now
 * forms-orphaned `autocompletePlaces` in `~/server/places` — is the live
 * call-site for the CRITICAL auth + per-user write-limit gate that protects the
 * PAID Google Places call (#86/#18). The seam lazy-imports its collaborators (the
 * pure `runAutocomplete` impl, the auth guard, the limiter) inside the handler;
 * we mock all three so we can assert the gate without cookie/DB plumbing:
 *
 *   - anonymous  -> 401, and the upstream impl is NOT invoked,
 *   - over-limit -> 429, and the upstream impl is NOT invoked,
 *   - happy path -> requireCurrentUser BEFORE enforceWriteLimit BEFORE the impl.
 *
 * `runAutocomplete`'s own provider logic is covered in `places.test.ts`; the
 * guards' window logic in `auth/guards.test.ts` + `rate-limit/index.test.ts`.
 */

const runAutocompleteMock = vi.fn((_input: unknown) =>
  Promise.resolve({ ok: true as const, data: [] })
);
vi.mock("~/server/places", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/server/places")>();
  return {
    ...actual,
    runAutocomplete: (input: unknown) => runAutocompleteMock(input),
  };
});

const requireCurrentUserMock = vi.fn(() => Promise.resolve({ id: "user-1" }));
vi.mock("~/server/auth/guards", () => ({
  requireCurrentUser: () => requireCurrentUserMock(),
}));

const enforceWriteLimitMock = vi.fn((_userId?: string) => Promise.resolve());
vi.mock("~/server/rate-limit", () => ({
  enforceWriteLimit: (userId?: string) => enforceWriteLimitMock(userId),
}));

import { callServerFn } from "../../tests/server-fn";
import { autocompletePlaces } from "./places.fn";

const input = { data: { query: "cafe" } };
const call = () => callServerFn(() => autocompletePlaces(input));

afterEach(() => {
  vi.clearAllMocks();
});

describe("autocompletePlaces — auth + rate limit seam (#141)", () => {
  it("gates auth then the write limit then the impl, in that order", async () => {
    await call();

    expect(requireCurrentUserMock).toHaveBeenCalledTimes(1);
    expect(enforceWriteLimitMock).toHaveBeenCalledTimes(1);
    expect(enforceWriteLimitMock).toHaveBeenCalledWith("user-1");
    expect(runAutocompleteMock).toHaveBeenCalledTimes(1);
    expect(runAutocompleteMock).toHaveBeenCalledWith(input.data);

    // Auth BEFORE limit BEFORE the paid upstream call.
    const authOrder = requireCurrentUserMock.mock.invocationCallOrder[0];
    const limitOrder = enforceWriteLimitMock.mock.invocationCallOrder[0];
    const implOrder = runAutocompleteMock.mock.invocationCallOrder[0];
    expect(authOrder).toBeDefined();
    expect(limitOrder).toBeDefined();
    expect(implOrder).toBeDefined();
    expect(authOrder as number).toBeLessThan(limitOrder as number);
    expect(limitOrder as number).toBeLessThan(implOrder as number);
  });

  it("rejects an anonymous caller (401) before the limiter and the upstream call", async () => {
    const unauthorized = new HTTPException(401, { message: "Authentication required." });
    requireCurrentUserMock.mockRejectedValueOnce(unauthorized);

    await expect(call()).rejects.toBe(unauthorized);
    expect(enforceWriteLimitMock).not.toHaveBeenCalled();
    expect(runAutocompleteMock).not.toHaveBeenCalled();
  });

  it("does not call the upstream Places provider when the rate limit is exceeded (429)", async () => {
    const tooFast = new HTTPException(429, { message: "too fast" });
    enforceWriteLimitMock.mockRejectedValueOnce(tooFast);

    await expect(call()).rejects.toBe(tooFast);
    expect(requireCurrentUserMock).toHaveBeenCalledTimes(1);
    expect(runAutocompleteMock).not.toHaveBeenCalled();
  });
});
