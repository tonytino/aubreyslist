import { HTTPException } from "hono/http-exception";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "~/db/schema";

/**
 * Tests for the moderation ACTIONS write layer (`dismiss`/`hide`/`remove`/
 * `restore`, #41, ADR-010).
 *
 * These are the ADR-010 security boundary for acting on flagged content: the
 * gate is enforced server-side off the authoritative `users` row, never the UI.
 * The bulk of these tests pin down that PERMISSION BOUNDARY — anonymous (401)
 * and plain `user` (403) callers must be rejected BEFORE any DB work, while
 * `moderator` and `admin` pass — by driving the real `requireCurrentRole` guard
 * through a mocked current-user accessor (so the genuine 401/403 policy runs).
 *
 * The DB is mocked (no live connection): we capture the `db.batch([...])`
 * payload and assert the action writes the audit row, the content-status update,
 * and the prompting-flag status update as ONE atomic batch — and that `dismiss`
 * leaves content untouched while `restore` leaves the flag untouched.
 */

const h = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  // Captured statements handed to db.batch([...]).
  batchMock: vi.fn<(stmts: unknown[]) => Promise<unknown[]>>(),
  // Capture the values passed to each builder so we can assert intent.
  insertValuesMock: vi.fn((v: unknown) => ({ __op: "insert", values: v })),
  updateSetMock: vi.fn(),
  // The flag-target verification SELECT (#157) — resolves to the flag's
  // exclusive-arc target columns (or [] for not-found).
  selectLimitMock: vi.fn<() => Promise<unknown[]>>(),
}));

vi.mock("~/server/auth/current-user", () => ({
  getCurrentUser: h.getCurrentUserMock,
}));

// Model the drizzle builders enough to capture intent. `insert().values()` and
// `update().set().where()` return plain marker objects; the action only awaits
// `db.batch([...])`, so the markers never need to be thenable.
vi.mock("~/db/client", () => ({
  getDb: () => ({
    batch: h.batchMock,
    insert: (table: unknown) => ({
      values: (v: unknown) => h.insertValuesMock({ table, ...(v as object) }),
    }),
    update: (table: unknown) => ({
      set: (s: unknown) => ({
        where: (w: unknown) => h.updateSetMock({ table, set: s, where: w }),
      }),
    }),
    // The flag-target check (#157): select(...).from(...).where(...).limit(1)
    // resolves to the matched flag's exclusive-arc target columns.
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => h.selectLimitMock() }),
      }),
    }),
  }),
}));

import {
  dismissFlag,
  hideContent,
  moderationActionInputSchema,
  removeContent,
  restoreContent,
} from "./actions";

const { getCurrentUserMock, batchMock, insertValuesMock, updateSetMock, selectLimitMock } = h;

function userRow(role: User["role"], overrides: Partial<User> = {}): User {
  return {
    id: `user-${role}`,
    googleSub: `sub-${role}`,
    email: `${role}@example.com`,
    name: role,
    avatarUrl: null,
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as User;
}

beforeEach(() => {
  updateSetMock.mockImplementation((arg: unknown) => ({ __op: "update", ...(arg as object) }));
  batchMock.mockResolvedValue([]);
  // By default the prompting flag (`flag-1`) targets `listing-1` — i.e. it
  // matches the `listingPayload` target, so the #157 check passes. Mismatch
  // cases override this per-test.
  selectLimitMock.mockResolvedValue([{ listingId: "listing-1", claimId: null, incidentId: null }]);
});

afterEach(() => {
  vi.clearAllMocks();
});

const listingPayload = { target: "listing", listingId: "listing-1", flagId: "flag-1" } as const;

describe("moderation actions — permission boundary (ADR-010)", () => {
  it("rejects an anonymous caller with 401 (no DB write)", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    await expect(hideContent(listingPayload)).rejects.toMatchObject({ status: 401 });
    expect(batchMock).not.toHaveBeenCalled();
  });

  it("forbids a plain 'user' caller with 403 (no DB write)", async () => {
    getCurrentUserMock.mockResolvedValue(userRow("user"));
    await expect(hideContent(listingPayload)).rejects.toMatchObject({ status: 403 });
    expect(batchMock).not.toHaveBeenCalled();
  });

  it("surfaces the guard's HTTPException type for forbidden callers", async () => {
    getCurrentUserMock.mockResolvedValue(userRow("user"));
    await expect(hideContent(listingPayload)).rejects.toBeInstanceOf(HTTPException);
  });

  it("allows a moderator to act", async () => {
    getCurrentUserMock.mockResolvedValue(userRow("moderator"));
    await expect(hideContent(listingPayload)).resolves.toBeUndefined();
    expect(batchMock).toHaveBeenCalledTimes(1);
  });

  it("allows an admin to act (admins out-rank moderators)", async () => {
    getCurrentUserMock.mockResolvedValue(userRow("admin"));
    await expect(removeContent(listingPayload)).resolves.toBeUndefined();
    expect(batchMock).toHaveBeenCalledTimes(1);
  });
});

describe("moderation actions — atomic batch contents", () => {
  beforeEach(() => {
    getCurrentUserMock.mockResolvedValue(userRow("moderator", { id: "mod-1" }));
  });

  it("hide: writes audit row + content→hidden + flag→resolved in ONE batch", async () => {
    await hideContent(listingPayload);

    // Single atomic batch.
    expect(batchMock).toHaveBeenCalledTimes(1);
    const stmts = batchMock.mock.calls[0]?.[0] as unknown[];
    // audit insert + content update + flag update.
    expect(stmts).toHaveLength(3);

    // Audit row: action=hide, actor, exclusive-arc target, prompting flag.
    const audit = insertValuesMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(audit.action).toBe("hide");
    expect(audit.actorId).toBe("mod-1");
    expect(audit.listingId).toBe("listing-1");
    expect(audit.flagId).toBe("flag-1");

    // The two updates set content→hidden and flag→resolved.
    const sets = updateSetMock.mock.calls.map(
      (c) => (c[0] as { set: Record<string, unknown> }).set
    );
    expect(sets).toContainEqual(expect.objectContaining({ moderationStatus: "hidden" }));
    expect(sets).toContainEqual(expect.objectContaining({ status: "resolved" }));
  });

  it("remove: content→removed + flag→resolved", async () => {
    await removeContent(listingPayload);
    const audit = insertValuesMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(audit.action).toBe("remove");
    const sets = updateSetMock.mock.calls.map(
      (c) => (c[0] as { set: Record<string, unknown> }).set
    );
    expect(sets).toContainEqual(expect.objectContaining({ moderationStatus: "removed" }));
    expect(sets).toContainEqual(expect.objectContaining({ status: "resolved" }));
  });

  it("dismiss: flag→dismissed but leaves content UNTOUCHED", async () => {
    await dismissFlag(listingPayload);
    const audit = insertValuesMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(audit.action).toBe("dismiss");
    const stmts = batchMock.mock.calls[0]?.[0] as unknown[];
    // audit insert + flag update only (no content update).
    expect(stmts).toHaveLength(2);
    const sets = updateSetMock.mock.calls.map(
      (c) => (c[0] as { set: Record<string, unknown> }).set
    );
    expect(sets).toContainEqual(expect.objectContaining({ status: "dismissed" }));
    expect(sets).not.toContainEqual(
      expect.objectContaining({ moderationStatus: expect.anything() })
    );
  });

  it("restore: content→visible but leaves the flag UNTOUCHED", async () => {
    await restoreContent(listingPayload);
    const audit = insertValuesMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(audit.action).toBe("restore");
    const stmts = batchMock.mock.calls[0]?.[0] as unknown[];
    // audit insert + content update only (restore never touches the flag).
    expect(stmts).toHaveLength(2);
    const sets = updateSetMock.mock.calls.map(
      (c) => (c[0] as { set: Record<string, unknown> }).set
    );
    expect(sets).toContainEqual(expect.objectContaining({ moderationStatus: "visible" }));
    expect(sets).not.toContainEqual(expect.objectContaining({ status: expect.anything() }));
  });

  it("acts on a claim target (exclusive arc) without a prompting flag", async () => {
    await hideContent({ target: "claim", claimId: "claim-9" });
    const audit = insertValuesMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(audit.claimId).toBe("claim-9");
    expect(audit.flagId).toBeNull();
    // No flagId → no flag-status update; just audit + content update.
    const stmts = batchMock.mock.calls[0]?.[0] as unknown[];
    expect(stmts).toHaveLength(2);
  });
});

describe("moderation actions — flag must target the acted-on content (#157)", () => {
  beforeEach(() => {
    getCurrentUserMock.mockResolvedValue(userRow("moderator", { id: "mod-1" }));
  });

  it("rejects a flagId whose target differs from the action's target (422, no batch)", async () => {
    // The action targets listing-1 but flag-1 is a flag on claim-X.
    selectLimitMock.mockResolvedValue([{ listingId: null, claimId: "claim-X", incidentId: null }]);
    await expect(hideContent(listingPayload)).rejects.toMatchObject({ status: 422 });
    expect(batchMock).not.toHaveBeenCalled();
  });

  it("surfaces an HTTPException for a mismatched flag", async () => {
    selectLimitMock.mockResolvedValue([{ listingId: null, claimId: "claim-X", incidentId: null }]);
    await expect(hideContent(listingPayload)).rejects.toBeInstanceOf(HTTPException);
  });

  it("rejects a flagId pointing at a different listing of the same target type (422, no batch)", async () => {
    selectLimitMock.mockResolvedValue([
      { listingId: "listing-OTHER", claimId: null, incidentId: null },
    ]);
    await expect(hideContent(listingPayload)).rejects.toMatchObject({ status: 422 });
    expect(batchMock).not.toHaveBeenCalled();
  });

  it("rejects a missing (not-found) flag (422, no batch)", async () => {
    selectLimitMock.mockResolvedValue([]);
    await expect(hideContent(listingPayload)).rejects.toMatchObject({ status: 422 });
    expect(batchMock).not.toHaveBeenCalled();
  });

  it("allows the action when the flag targets the acted-on content", async () => {
    // Default mock: flag-1 targets listing-1, matching the payload.
    await expect(hideContent(listingPayload)).resolves.toBeUndefined();
    expect(batchMock).toHaveBeenCalledTimes(1);
  });

  it("skips the flag-target check entirely when no flagId is supplied", async () => {
    await hideContent({ target: "claim", claimId: "claim-9" });
    expect(selectLimitMock).not.toHaveBeenCalled();
    expect(batchMock).toHaveBeenCalledTimes(1);
  });
});

describe("moderation actions — input validation (exclusive arc)", () => {
  it("rejects a payload with no target", () => {
    expect(moderationActionInputSchema.safeParse({ flagId: "flag-1", note: "x" }).success).toBe(
      false
    );
  });

  it("rejects a payload with multiple targets", () => {
    expect(
      moderationActionInputSchema.safeParse({
        target: "listing",
        listingId: "l1",
        claimId: "c1",
      }).success
    ).toBe(false);
  });

  it("rejects an empty target id", () => {
    expect(
      moderationActionInputSchema.safeParse({ target: "listing", listingId: "" }).success
    ).toBe(false);
  });

  it("accepts a valid single-target payload", () => {
    expect(
      moderationActionInputSchema.safeParse({ target: "incident", incidentId: "i1", note: "spam" })
        .success
    ).toBe(true);
  });
});
