import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks -----------------------------------------------------------------
// The settings module's only server-only dependency is the DB client. We model
// just the two query chains it uses:
//   read:  getDb().select().from().where().limit()  -> rows
//   write: getDb().insert().values().onConflictDoUpdate()/onConflictDoNothing()
// and capture what gets written so round-trip tests can feed it back to a read.

let selectRows: Array<{ value: string }> = [];
const limitMock = vi.fn(() => Promise.resolve(selectRows));
const whereMock = vi.fn(() => ({ limit: limitMock }));
const fromMock = vi.fn(() => ({ where: whereMock }));
const selectMock = vi.fn(() => ({ from: fromMock }));

/** Captures the most recent write so a test can assert / replay it. */
let lastInsertValues: unknown;
const onConflictDoUpdateMock = vi.fn(() => Promise.resolve());
const onConflictDoNothingMock = vi.fn(() => Promise.resolve());
const valuesMock = vi.fn((vals: unknown) => {
  lastInsertValues = vals;
  return {
    onConflictDoUpdate: onConflictDoUpdateMock,
    onConflictDoNothing: onConflictDoNothingMock,
  };
});
const insertMock = vi.fn(() => ({ values: valuesMock }));

vi.mock("~/db/client", () => ({
  getDb: () => ({ select: selectMock, insert: insertMock }),
}));

import { SETTING_KEYS, getDefault, getSetting, seedDefaults, setSetting } from "./index";

beforeEach(() => {
  selectRows = []; // default: no row -> getSetting returns the in-code default
  lastInsertValues = undefined;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("in-code defaults (ADR-007 + ADR-008)", () => {
  it("seeds intake_mode=places and staleness_months=6", () => {
    expect(getDefault("intake_mode")).toBe("places");
    expect(getDefault("staleness_months")).toBe(6);
  });

  it("returns the default when the key is unset (empty table, no throw)", async () => {
    expect(await getSetting("intake_mode")).toBe("places");
    expect(await getSetting("staleness_months")).toBe(6);
  });
});

describe("typed read parsing", () => {
  it("parses a stored enum value", async () => {
    selectRows = [{ value: "manual" }];
    const mode = await getSetting("intake_mode");
    expect(mode).toBe("manual");
  });

  it("parses a stored integer value (TEXT -> number)", async () => {
    selectRows = [{ value: "12" }];
    const months = await getSetting("staleness_months");
    expect(months).toBe(12);
    expect(typeof months).toBe("number");
  });

  it("falls back to the default when an enum value is not a member", async () => {
    selectRows = [{ value: "carrier-pigeon" }];
    expect(await getSetting("intake_mode")).toBe("places");
  });

  it("falls back to the default when an int value is malformed", async () => {
    selectRows = [{ value: "not-a-number" }];
    expect(await getSetting("staleness_months")).toBe(6);

    selectRows = [{ value: "6.5" }];
    expect(await getSetting("staleness_months")).toBe(6); // non-integer rejected
  });

  it("filters the read by the requested key", async () => {
    selectRows = [{ value: "manual" }];
    await getSetting("intake_mode");
    expect(whereMock).toHaveBeenCalledTimes(1);
    expect(limitMock).toHaveBeenCalledTimes(1);
  });
});

describe("typed write (serialize)", () => {
  it("serializes an enum value and upserts the row", async () => {
    await setSetting("intake_mode", "manual");
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(lastInsertValues).toEqual({ key: "intake_mode", value: "manual" });
    expect(onConflictDoUpdateMock).toHaveBeenCalledTimes(1);
  });

  it("serializes an integer value to TEXT", async () => {
    await setSetting("staleness_months", 9);
    expect(lastInsertValues).toEqual({ key: "staleness_months", value: "9" });
  });
});

describe("round-trip (set -> get) for each typed key", () => {
  it("round-trips an enum value", async () => {
    await setSetting("intake_mode", "manual");
    // Replay what the write captured back into the read mock.
    selectRows = [lastInsertValues as { key: string; value: string }];
    expect(await getSetting("intake_mode")).toBe("manual");
  });

  it("round-trips an integer value, preserving the number type", async () => {
    await setSetting("staleness_months", 3);
    selectRows = [lastInsertValues as { key: string; value: string }];
    const months = await getSetting("staleness_months");
    expect(months).toBe(3);
    expect(typeof months).toBe("number");
  });
});

describe("seedDefaults", () => {
  it("idempotently inserts every registry default with onConflictDoNothing", async () => {
    await seedDefaults();
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(onConflictDoNothingMock).toHaveBeenCalledTimes(1);
    expect(lastInsertValues).toEqual([
      { key: "intake_mode", value: "places" },
      { key: "staleness_months", value: "6" },
    ]);
  });

  it("covers every key in the registry", () => {
    expect(SETTING_KEYS).toEqual(["intake_mode", "staleness_months"]);
  });
});
