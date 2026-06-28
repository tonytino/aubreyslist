import { HTTPException } from "hono/http-exception";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the content-flagging write layer (#39).
 *
 * The module's only server-only dependencies are the DB client and the auth
 * guard + rate limiter. We model the exact drizzle chain it uses
 * (`getDb().insert().values()`) so we can assert behaviour — the 401/429 gates,
 * the exclusive-arc validation, and the inserted row's columns — without a live
 * database, per `docs/agents/testing.md` (minimal mocking).
 */

// --- Mocks -----------------------------------------------------------------
// The module's server-only deps are the DB client, the auth guard, and the
// write rate limiter. Mocks live in `vi.hoisted` so the (hoisted) `vi.mock`
// factories can close over them. The hoisted block exposes the mock fns +
// mutable test state we assert on.
//
// DB chain modeled:
//   insert: getDb().insert().values()  -> resolves; captures the inserted values
const h = vi.hoisted(() => {
  const state = {
    lastInsertValues: undefined as unknown,
    signedIn: true,
  };

  const valuesMock = vi.fn((vals: unknown) => {
    state.lastInsertValues = vals;
    return Promise.resolve();
  });
  const insertMock = vi.fn(() => ({ values: valuesMock }));

  // `requireCurrentUser` throws 401 for anonymous callers; here it resolves to a
  // stub user, except when a test flips `state.signedIn` to assert the gate.
  const requireCurrentUserMock = vi.fn(() => {
    if (!state.signedIn) {
      return Promise.reject(new Error("Authentication required."));
    }
    return Promise.resolve({ id: "user-1" });
  });

  // `enforceWriteLimit` is the per-user write rate limit (#18). We spy on it to
  // assert the write meters the authenticated user; the limiter's own window
  // logic has dedicated coverage in `rate-limit/index.test.ts`.
  const enforceWriteLimitMock = vi.fn((_userId?: string) => Promise.resolve());

  return { state, valuesMock, insertMock, requireCurrentUserMock, enforceWriteLimitMock };
});

vi.mock("~/db/client", () => ({
  getDb: () => ({ insert: h.insertMock }),
}));

vi.mock("~/server/auth/guards", () => ({
  requireCurrentUser: h.requireCurrentUserMock,
}));

vi.mock("~/server/rate-limit", () => ({
  enforceWriteLimit: h.enforceWriteLimitMock,
}));

import { type CreateFlagInput, createFlag, createFlagInputSchema } from "./index";

const { state, insertMock, valuesMock, requireCurrentUserMock, enforceWriteLimitMock } = h;

beforeEach(() => {
  state.lastInsertValues = undefined;
  state.signedIn = true;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("createFlagInputSchema — exclusive-arc target validation", () => {
  it("accepts a single listing target with a reason", () => {
    const parsed = createFlagInputSchema.safeParse({
      target: "listing",
      listingId: "listing-1",
      reason: "Spam",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a single claim target with a reason", () => {
    const parsed = createFlagInputSchema.safeParse({
      target: "claim",
      claimId: "claim-1",
      reason: "Wrong",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a single incident target with a reason", () => {
    const parsed = createFlagInputSchema.safeParse({
      target: "incident",
      incidentId: "incident-1",
      reason: "Inappropriate",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects zero targets (no discriminator / no id)", () => {
    expect(createFlagInputSchema.safeParse({ reason: "Spam" }).success).toBe(false);
  });

  it("rejects multiple targets (extra target id is not allowed on a branch)", () => {
    // A claim branch carries ONLY claimId; supplying a second target id makes the
    // payload invalid (strict-by-construction discriminated union branches).
    const parsed = createFlagInputSchema.safeParse({
      target: "claim",
      claimId: "claim-1",
      listingId: "listing-1",
      reason: "Spam",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an empty / whitespace-only reason", () => {
    expect(
      createFlagInputSchema.safeParse({ target: "listing", listingId: "l-1", reason: "   " })
        .success
    ).toBe(false);
  });

  it("rejects a reason over the max length", () => {
    const tooLong = "x".repeat(2001);
    expect(
      createFlagInputSchema.safeParse({ target: "listing", listingId: "l-1", reason: tooLong })
        .success
    ).toBe(false);
  });

  it("trims the reason before storing", () => {
    const parsed = createFlagInputSchema.safeParse({
      target: "listing",
      listingId: "l-1",
      reason: "  needs review  ",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.reason).toBe("needs review");
    }
  });
});

describe("createFlag — inserts an open flag attributed to the reporter", () => {
  it("inserts a listing flag with the listing target, reporter, and open status", async () => {
    await createFlag({ target: "listing", listingId: "listing-1", reason: "Spam" });

    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(state.lastInsertValues).toEqual({
      listingId: "listing-1",
      reporterId: "user-1",
      reason: "Spam",
      status: "open",
    });
  });

  it("inserts a claim flag (only the claim target column set)", async () => {
    await createFlag({ target: "claim", claimId: "claim-1", reason: "Wrong" });

    expect(state.lastInsertValues).toEqual({
      claimId: "claim-1",
      reporterId: "user-1",
      reason: "Wrong",
      status: "open",
    });
  });

  it("inserts an incident flag (only the incident target column set)", async () => {
    await createFlag({ target: "incident", incidentId: "incident-1", reason: "Inappropriate" });

    expect(state.lastInsertValues).toEqual({
      incidentId: "incident-1",
      reporterId: "user-1",
      reason: "Inappropriate",
      status: "open",
    });
  });

  it("requires a signed-in user (401 gate); no write or rate-limit happens", async () => {
    state.signedIn = false;
    await expect(
      createFlag({ target: "listing", listingId: "listing-1", reason: "Spam" })
    ).rejects.toThrow("Authentication required.");
    expect(insertMock).not.toHaveBeenCalled();
    // The auth gate short-circuits BEFORE the rate limiter — an anonymous caller
    // gets a 401, never a 429. Locks the security-critical ordering.
    expect(enforceWriteLimitMock).not.toHaveBeenCalled();
  });

  it("rate-limits the authenticated user before writing (#18), after the auth gate", async () => {
    await createFlag({ target: "listing", listingId: "listing-1", reason: "Spam" });

    expect(enforceWriteLimitMock).toHaveBeenCalledTimes(1);
    expect(enforceWriteLimitMock).toHaveBeenCalledWith("user-1");
    // Auth must run BEFORE the rate limiter so anonymous callers get 401, not 429.
    const authOrder = requireCurrentUserMock.mock.invocationCallOrder[0];
    const limitOrder = enforceWriteLimitMock.mock.invocationCallOrder[0];
    expect(authOrder).toBeDefined();
    expect(limitOrder).toBeDefined();
    expect(authOrder as number).toBeLessThan(limitOrder as number);
  });

  it("does not write when the rate limit is exceeded (429)", async () => {
    const tooFast = new HTTPException(429, { message: "too fast" });
    enforceWriteLimitMock.mockRejectedValueOnce(tooFast);

    await expect(
      createFlag({ target: "listing", listingId: "listing-1", reason: "Spam" })
    ).rejects.toBe(tooFast);
    expect(insertMock).not.toHaveBeenCalled();
    expect(valuesMock).not.toHaveBeenCalled();
  });

  it("meters the user, not the target id", async () => {
    // Type-level sanity: the input type is the discriminated union.
    const input: CreateFlagInput = { target: "claim", claimId: "c-9", reason: "x" };
    await createFlag(input);
    expect(enforceWriteLimitMock).toHaveBeenCalledWith("user-1");
  });
});
