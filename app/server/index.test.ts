import { describe, expect, it } from "vitest";
import app from "./index";

describe("api app", () => {
  it("serves a mounted route", async () => {
    const res = await app.request("/api/example");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: "Hello from Hono" });
  });

  it("returns a JSON 404 for unknown routes", async () => {
    const res = await app.request("/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ error: "Not Found" });
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
