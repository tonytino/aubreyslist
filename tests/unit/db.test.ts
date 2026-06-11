import { describe, expect, it } from "vitest";
// Import through the documented `~/db/*` alias (see docs/agents/database.md) so
// a broken alias or path regression fails here rather than silently in a
// scaffolded project.
import { getDb } from "~/db/client";
import * as schema from "~/db/schema";

describe("db module wiring", () => {
  it("exposes getDb as a lazy factory (importing requires no DATABASE_URL)", () => {
    // getDb is memoized/lazy — importing the module must not construct the
    // client or read env, so this is safe without a live database.
    expect(typeof getDb).toBe("function");
  });

  it("resolves the schema module via the ~/db alias", () => {
    expect(schema).toBeTypeOf("object");
  });
});
