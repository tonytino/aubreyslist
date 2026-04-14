import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

// DATABASE_URL is validated at startup via app/env.ts — never commit .env
import { env } from "~/env";
const sql = neon(env.DATABASE_URL);

export const db = drizzle(sql, { schema });
