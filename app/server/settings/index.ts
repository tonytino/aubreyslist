import { eq } from "drizzle-orm";
import { getDb } from "~/db/client";
import { appSettings } from "~/db/schema";
import { DEFAULT_STALENESS_MONTHS } from "~/trust/summary";

/**
 * App-settings / feature-flag system (ADR-007 + ADR-008).
 *
 * Admin-tunable runtime config persisted in the `app_settings` key/value
 * table. The table stores every value as TEXT; this module is the only place
 * that (de)serializes those strings into typed values.
 *
 * Design:
 * - A single `SETTINGS` registry is the source of truth. Each entry names a
 *   key, its in-code default, and a `codec` that bridges TEXT and the typed
 *   value. Adding a setting is one entry; nothing else changes.
 * - The registry drives the types: `SettingKey` and `SettingValue<K>` derive
 *   from it, so {@link getSetting}/{@link setSetting} are fully typed per key
 *   with no `any` and no per-key overloads.
 * - Defaults live in code, so reads never fail on an empty table. DB seeding
 *   is optional; {@link seedDefaults} is an idempotent convenience.
 *
 * Server-only: imports the DB client. Never import this from client code.
 */

// ---------------------------------------------------------------------------
// Codecs — TEXT <-> typed value, with safe fallback to the default on bad data
// ---------------------------------------------------------------------------

/**
 * A codec serializes a typed value to the TEXT stored in `app_settings.value`
 * and parses it back. `parse` returns `undefined` for any malformed stored
 * value so the caller can fall back to the in-code default rather than throw —
 * a corrupt row must never break a read.
 */
interface Codec<T> {
  serialize: (value: T) => string;
  parse: (raw: string) => T | undefined;
}

/** Codec for plain string settings (identity). */
const stringCodec: Codec<string> = {
  serialize: (value) => value,
  parse: (raw) => raw,
};

/** Codec for integer settings (e.g. a month count); non-integers parse to the default. */
const intCodec: Codec<number> = {
  serialize: (value) => String(value),
  parse: (raw) => {
    const n = Number(raw);
    return Number.isInteger(n) ? n : undefined;
  },
};

/**
 * Codec for a positive integer setting (e.g. the staleness window in months).
 * A zero, negative, or fractional window is meaningless and could break
 * staleness: `0` makes the cutoff "now", flagging everything stale; a
 * negative pushes it into the future, flagging nothing. Such stored values
 * parse to `undefined` so the read falls back to the in-code default — a bad
 * admin value can never break staleness.
 */
const positiveIntCodec: Codec<number> = {
  serialize: intCodec.serialize,
  parse: (raw) => {
    const n = intCodec.parse(raw);
    return n !== undefined && n > 0 ? n : undefined;
  },
};

/**
 * Codec for boolean settings (e.g. a feature kill switch). Stored canonically
 * as the TEXT `"true"` / `"false"`; parsing is deliberately forgiving —
 * case-insensitive, whitespace-trimmed — so a hand-run SQL `'TRUE'` / `'False '`
 * still reads as intended instead of silently falling back to the default
 * (which for the photos kill switch is the spend-incurring direction). Anything
 * else parses to `undefined` so the in-code default wins — a corrupt row can
 * never wedge a switch into an unintended state.
 */
const boolCodec: Codec<boolean> = {
  serialize: (value) => (value ? "true" : "false"),
  parse: (raw) => {
    const normalized = raw.trim().toLowerCase();
    return normalized === "true" ? true : normalized === "false" ? false : undefined;
  },
};

/**
 * Codec factory for a string-union ("enum") setting. Serializes like a plain
 * string; parses back to the union type only when the stored value is a member,
 * else `undefined` (default wins).
 */
function enumCodec<const T extends string>(members: readonly T[]): Codec<T> {
  const allowed = new Set<string>(members);
  return {
    serialize: stringCodec.serialize,
    parse: (raw) => (allowed.has(raw) ? (raw as T) : undefined),
  };
}

// ---------------------------------------------------------------------------
// The typed key registry — single source of truth
// ---------------------------------------------------------------------------

/** Active listing-intake mode (ADR-008). Admin flips this to degrade gracefully. */
export const INTAKE_MODES = ["places", "manual"] as const;
export type IntakeMode = (typeof INTAKE_MODES)[number];

/**
 * Definition of one setting: its in-code default and the codec that bridges the
 * TEXT column and the typed value.
 */
interface SettingDef<T> {
  default: T;
  codec: Codec<T>;
}

/** Helper that ties a default to its codec while preserving the value type. */
function define<T>(def: SettingDef<T>): SettingDef<T> {
  return def;
}

/**
 * The registry. Keys here are exactly the keys that exist; values carry the
 * default + codec.
 */
export const SETTINGS = {
  /** Listing intake mode — `places` (default) or `manual` (ADR-008). */
  intake_mode: define<IntakeMode>({
    default: "places",
    codec: enumCodec(INTAKE_MODES),
  }),
  /**
   * Staleness window in months — claims unconfirmed past this are flagged
   * stale (ADR-007). Guarded to a positive integer: an invalid stored value
   * falls back to `DEFAULT_STALENESS_MONTHS`.
   */
  staleness_months: define<number>({
    default: DEFAULT_STALENESS_MONTHS,
    codec: positiveIntCodec,
  }),
  /**
   * Kill switch for render-time Google Place photos (ADR-014). Defaults to
   * enabled when the row is absent, so photos work out of the box; an admin
   * (or an operator via SQL) flips it to `false` to cut off Places photo
   * spend. Gates only the render-time fetch + media proxy; nothing
   * Google-sourced is persisted.
   */
  place_photos_enabled: define<boolean>({
    default: true,
    codec: boolCodec,
  }),
} as const;

/** Every valid app-settings key. */
export type SettingKey = keyof typeof SETTINGS;

/** The typed value for a given setting key, derived from the registry. */
export type SettingValue<K extends SettingKey> =
  (typeof SETTINGS)[K] extends SettingDef<infer T> ? T : never;

/** The full set of keys (e.g. for seeding / iteration). */
export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

/**
 * Look up a registry entry as its precise per-key definition. Indexing the
 * registry by a generic `K` yields a union of all defs (TS can't narrow it to
 * the single matching one), so we re-assert the precise type here in one place
 * — via `unknown` because the union and the target don't structurally overlap.
 * This keeps {@link getSetting}/{@link setSetting} fully typed without scattering
 * casts.
 */
function defFor<K extends SettingKey>(key: K): SettingDef<SettingValue<K>> {
  return SETTINGS[key] as unknown as SettingDef<SettingValue<K>>;
}

// ---------------------------------------------------------------------------
// Read path — typed, default-on-unset, never throws on a missing/bad row
// ---------------------------------------------------------------------------

/**
 * Read a single setting, typed by its key. Returns the in-code default when the
 * key has no row (empty table) or the stored TEXT fails to parse, so reads are
 * total — they never fail on an unseeded or corrupt database.
 *
 * @example
 * const mode = await getSetting("intake_mode"); // IntakeMode
 * const months = await getSetting("staleness_months"); // number
 */
export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  const def = defFor(key);

  const rows = await getDb()
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .limit(1);

  const raw = rows[0]?.value;
  if (raw === undefined) return def.default;

  const parsed = def.codec.parse(raw);
  return parsed === undefined ? def.default : parsed;
}

/**
 * The in-code default for a key, without touching the database. Useful for
 * documentation/UX defaults and for tests asserting the seed values.
 */
export function getDefault<K extends SettingKey>(key: K): SettingValue<K> {
  return defFor(key).default;
}

// ---------------------------------------------------------------------------
// Write path — admin-only (see seam note below)
// ---------------------------------------------------------------------------

/**
 * Persist a single setting, typed by its key. Upserts the row (insert, or
 * update `value` + `updatedAt` on conflict), serializing through the key's
 * codec so the TEXT column stays canonical.
 *
 * Admin-guard seam: this function performs no authorization itself. Managing
 * app settings is admin-only (`domain.md` Roles table) — callers must gate on
 * an admin check at the call site / server-function boundary, e.g.
 * `requireRole('admin'); await setSetting(...)`. Keeping the check out of this
 * module leaves the guard a single clean seam.
 */
export async function setSetting<K extends SettingKey>(
  key: K,
  value: SettingValue<K>
): Promise<void> {
  const serialized = defFor(key).codec.serialize(value);

  await getDb()
    .insert(appSettings)
    .values({ key, value: serialized })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: serialized, updatedAt: new Date() },
    });
}

/**
 * Idempotently write the in-code defaults for any keys missing a row, leaving
 * existing (admin-tuned) rows untouched. Optional — reads already fall back
 * to defaults — but handy for a seed script or first-run setup.
 *
 * Like {@link setSetting}, an admin/operational action with no auth of its
 * own (see the seam note on {@link setSetting}).
 */
export async function seedDefaults(): Promise<void> {
  const rows = SETTING_KEYS.map((key) => {
    const def = defFor(key);
    return { key, value: def.codec.serialize(def.default) };
  });

  await getDb().insert(appSettings).values(rows).onConflictDoNothing();
}
