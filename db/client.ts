import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { getEnv } from "~/env";
import * as schema from "./schema";

let cached: NeonHttpDatabase<typeof schema> | undefined;

/**
 * Lazily constructed Drizzle client, memoized after the first call.
 * Construction is deferred (rather than running at import time) so importing
 * this module — e.g. transitively from a unit test — does not require a live
 * `DATABASE_URL`. The connection is only established on first {@link getDb}.
 */
export function getDb(): NeonHttpDatabase<typeof schema> {
  if (cached === undefined) {
    const sql = neon(getEnv().DATABASE_URL);
    cached = drizzle(sql, { schema });
  }
  return cached;
}
