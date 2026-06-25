import { describe, expect, it } from "vitest";
import app from "../index";

// Tests for the optional example route. `node scripts/remove-example.mjs`
// deletes this file along with the route it covers.
describe("example route", () => {
  it("responds on GET /api/example", async () => {
    const res = await app.request("/api/example");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: "Hello from Hono" });
  });

  it("validates request bodies (400 on missing field)", async () => {
    const res = await app.request("/api/example", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
