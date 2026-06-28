import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "~/db/schema";

/**
 * Tests for the moderation-queue access gate + shape (`resolveModerationQueue`,
 * #40, ADR-010).
 *
 * The queue is a moderator+ surface and an ADR-010 security boundary: the gate
 * is enforced SERVER-SIDE off the authoritative `users` row, never the UI. We
 * drive the REAL `requireCurrentRole` guard through a mocked current-user
 * accessor (so the genuine 401/403 policy runs, not a stubbed one) and assert it
 * maps to the typed access discriminator:
 *
 *   no user          → { access: "anonymous" }          (DB never queried)
 *   role "user"      → { access: "forbidden" }          (DB never queried)
 *   role "moderator" → { access: "granted", items }     (queue loaded)
 *   role "admin"     → { access: "granted", items }     (admins out-rank, pass)
 *
 * A separate test pins the queue's SHAPE: open flags only, each carrying the
 * target (type + id + label), reason, reporter (name/email), and date. The DB is
 * mocked (a single `select()...orderBy()` chain), so no live connection is
 * needed, per `docs/agents/testing.md` (minimal mocking).
 */

// --- Mocks -----------------------------------------------------------------
// The query uses the real `requireCurrentRole` guard (→ `getCurrentUser`) and
// the drizzle select chain. Mock only those two seams.
const h = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  // db.select(...).from(...).innerJoin(...).leftJoin(...x3).where(...).orderBy(...)
  orderByMock: vi.fn(),
  selectMock: vi.fn(),
}));

vi.mock("~/server/auth/current-user", () => ({
  getCurrentUser: h.getCurrentUserMock,
}));

vi.mock("~/db/client", () => ({
  getDb: () => ({ select: h.selectMock }),
}));

import { resolveModerationQueue } from "./queue";

const { getCurrentUserMock, orderByMock, selectMock } = h;

// --- Fixtures --------------------------------------------------------------

function userRow(role: User["role"]): User {
  return {
    id: `user-${role}`,
    googleSub: `sub-${role}`,
    email: `${role}@example.com`,
    name: role,
    avatarUrl: null,
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as User;
}

/** A joined queue row as the select chain would return it (one target set). */
type QueueDbRow = {
  id: string;
  reason: string;
  createdAt: Date;
  listingId: string | null;
  claimId: string | null;
  incidentId: string | null;
  reporterName: string;
  reporterEmail: string;
  flaggedListingName: string | null;
  flaggedClaimAttribute: string | null;
  claimListingId: string | null;
  incidentNote: string | null;
  incidentListingId: string | null;
};

function baseRow(overrides: Partial<QueueDbRow>): QueueDbRow {
  return {
    id: "flag-1",
    reason: "spam",
    createdAt: new Date("2026-06-01T00:00:00Z"),
    listingId: null,
    claimId: null,
    incidentId: null,
    reporterName: "Rep Orter",
    reporterEmail: "rep@example.com",
    flaggedListingName: null,
    flaggedClaimAttribute: null,
    claimListingId: null,
    incidentNote: null,
    incidentListingId: null,
    ...overrides,
  };
}

/** Wire the select chain to resolve `rows` from the terminal `.orderBy()`. */
function mockSelectRows(rows: QueueDbRow[]): void {
  orderByMock.mockResolvedValue(rows);
  const where = vi.fn(() => ({ orderBy: orderByMock }));
  const leftJoin3 = vi.fn(() => ({ where }));
  const leftJoin2 = vi.fn(() => ({ leftJoin: leftJoin3 }));
  const leftJoin1 = vi.fn(() => ({ leftJoin: leftJoin2 }));
  const innerJoin = vi.fn(() => ({ leftJoin: leftJoin1 }));
  const from = vi.fn(() => ({ innerJoin }));
  selectMock.mockImplementation(() => ({ from }));
}

beforeEach(() => {
  mockSelectRows([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("resolveModerationQueue — moderator+ access gate (ADR-010)", () => {
  it("reports anonymous when there is no current user (no DB query)", async () => {
    getCurrentUserMock.mockResolvedValue(null);

    const result = await resolveModerationQueue();

    expect(result).toEqual({ access: "anonymous" });
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("forbids a plain 'user' role with no DB query", async () => {
    getCurrentUserMock.mockResolvedValue(userRow("user"));

    const result = await resolveModerationQueue();

    expect(result).toEqual({ access: "forbidden" });
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("grants a moderator and loads the queue", async () => {
    getCurrentUserMock.mockResolvedValue(userRow("moderator"));

    const result = await resolveModerationQueue();

    expect(result.access).toBe("granted");
    expect(selectMock).toHaveBeenCalledTimes(1);
  });

  it("grants an admin (admins out-rank moderators)", async () => {
    getCurrentUserMock.mockResolvedValue(userRow("admin"));

    const result = await resolveModerationQueue();

    expect(result.access).toBe("granted");
    expect(selectMock).toHaveBeenCalledTimes(1);
  });
});

describe("resolveModerationQueue — queue shape", () => {
  beforeEach(() => {
    // All shape tests run as a moderator.
    getCurrentUserMock.mockResolvedValue(userRow("moderator"));
  });

  it("maps a listing flag to a listing target with the listing name as label", async () => {
    mockSelectRows([
      baseRow({
        id: "flag-listing",
        reason: "wrong address",
        listingId: "listing-1",
        flaggedListingName: "Gluten-Free Grill",
      }),
    ]);

    const result = await resolveModerationQueue();
    if (result.access !== "granted") throw new Error("expected granted");

    expect(result.items).toEqual([
      {
        id: "flag-listing",
        reason: "wrong address",
        createdAt: new Date("2026-06-01T00:00:00Z"),
        reporter: { name: "Rep Orter", email: "rep@example.com" },
        target: {
          type: "listing",
          id: "listing-1",
          label: "Gluten-Free Grill",
          listingId: "listing-1",
        },
      },
    ]);
  });

  it("maps a claim flag to a claim target labelled by its attribute", async () => {
    mockSelectRows([
      baseRow({
        id: "flag-claim",
        claimId: "claim-1",
        flaggedClaimAttribute: "dedicated_fryer",
        claimListingId: "listing-9",
      }),
    ]);

    const result = await resolveModerationQueue();
    if (result.access !== "granted") throw new Error("expected granted");

    expect(result.items[0]?.target).toEqual({
      type: "claim",
      id: "claim-1",
      label: "Dedicated fryer",
      listingId: "listing-9",
    });
  });

  it("maps an incident flag to an incident target labelled by its note snippet", async () => {
    mockSelectRows([
      baseRow({
        id: "flag-incident",
        incidentId: "incident-1",
        incidentNote: "Got glutened after the fries",
        incidentListingId: "listing-3",
      }),
    ]);

    const result = await resolveModerationQueue();
    if (result.access !== "granted") throw new Error("expected granted");

    expect(result.items[0]?.target).toEqual({
      type: "incident",
      id: "incident-1",
      label: "Got glutened after the fries",
      listingId: "listing-3",
    });
  });

  it("falls back to a generic incident label when the note is empty", async () => {
    mockSelectRows([
      baseRow({
        id: "flag-incident-2",
        incidentId: "incident-2",
        incidentNote: null,
        incidentListingId: "listing-4",
      }),
    ]);

    const result = await resolveModerationQueue();
    if (result.access !== "granted") throw new Error("expected granted");

    expect(result.items[0]?.target.label).toBe("Incident report");
  });

  it("returns an empty list when there are no open flags", async () => {
    mockSelectRows([]);

    const result = await resolveModerationQueue();
    if (result.access !== "granted") throw new Error("expected granted");

    expect(result.items).toEqual([]);
  });
});
