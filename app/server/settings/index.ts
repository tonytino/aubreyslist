import { eq } from "drizzle-orm";
import { getDb } from "~/db/client";
import { appSettings } from "~/db/schema";

/**
 * App-settings / feature-flag system (issue #13, ADR-007 + ADR-008).
 *
 * A reusable, admin-tunable runtime config layer persisted in the `app_settings`
 * key/value table. The table stores every value as TEXT; this module is the only
 * place that knows how to (de)serialize those strings into typed values.
 *
 * Design:
 * - A single `SETTINGS` registry is the source of truth. Each entry names a key,
 *   its in-code default, and a `codec` that parses TEXT -> value and serializes
 *   value -> TEXT. Adding a setting is one entry; nothing else changes.
 * - The registry drives the types: `SettingKey` and `SettingValue<K>` are derived
 *   from it, so {@link getSetting}/{@link setSetting} are fully typed per key with
 *   no `any` and no per-key overloads to maintain.
 * - Defaults live in code, so reads never fail on an empty table — a brand-new
 *   database returns the seeded defaults (`intake_mode=places`,
 *   `staleness_months=6`) without any row existing. DB seeding is therefore
 *   optional; {@link seedDefaults} is provided as an idempotent convenience.
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
 * default + codec. Seeds the two first consumers (ADR-007 / ADR-008).
 */
export const SETTINGS = {
  /** Listing intake mode — `places` (default) or `manual` (ADR-008). */
  intake_mode: define<IntakeMode>({
    default: "places",
    codec: enumCodec(INTAKE_MODES),
  }),
  /** Staleness window in months — claims unconfirmed past this are flagged stale (ADR-007). */
  staleness_months: define<number>({
    default: 6,
    codec: intCodec,
  }),
} as const;

/** Every valid app-settings key. */
export type SettingKey = keyof typeof SETTINGS;

/** The typed value for a given setting key, derived from the registry. */
export type SettingValue<K extends SettingKey> = (typeof SETTINGS)[K] extends SettingDef<infer T>
  ? T
  : never;

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
// Write path — ADMIN-ONLY (see seam note below)
// ---------------------------------------------------------------------------

/**
 * Persist a single setting, typed by its key. Upserts the row (insert, or update
 * `value` + `updatedAt` on conflict), serializing the value through the key's
 * codec so the TEXT column stays canonical.
 *
 * ADMIN-GUARD SEAM (issue #17): this is a plain server-side function and performs
 * **no authorization itself**. Managing app settings is admin-only
 * (`domain.md` Roles table). The `requireRole('admin')` guard from #17 is not yet
 * on this branch, so callers must ensure the actor is an admin before calling.
 * Once #17 lands, wrap this once at the call site / server-function boundary —
 * e.g. `requireRole('admin'); await setSetting(...)` — rather than threading auth
 * through this module. Keeping the check out here makes the guard a single clean
 * seam and avoids forking an auth guard.
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
 * existing (admin-tuned) rows untouched. Optional — reads already fall back to
 * defaults — but handy for a seed script under `scripts/` or first-run setup.
 *
 * Like {@link setSetting}, this is an admin/operational action and does no auth
 * of its own (see the seam note on {@link setSetting}).
 */
export async function seedDefaults(): Promise<void> {
  const rows = SETTING_KEYS.map((key) => {
    const def = defFor(key);
    return { key, value: def.codec.serialize(def.default) };
  });

  await getDb().insert(appSettings).values(rows).onConflictDoNothing();
}
