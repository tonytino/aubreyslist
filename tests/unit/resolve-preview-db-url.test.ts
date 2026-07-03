import { describe, expect, it, vi } from "vitest";
// The preview-DB resolver is plain ESM CI glue (AUB-139); import its testable core.
// @ts-expect-error — .mjs script, no type declarations
import { resolvePreviewConnectionUri } from "../../.github/scripts/resolve-preview-db-url.mjs";

/**
 * Unit tests for the Neon preview-branch connection-URI resolver. All I/O is
 * injected (`fetchImpl`, `sleep`), so these exercise the real branch-lookup +
 * retry + connection-uri logic without touching the network.
 */

const silentLog = { warn: () => {}, log: () => {}, error: () => {} };

/** A canned Neon API `fetch` keyed on the request path. Missing keys → 404. */
function mockFetch(routes: Record<string, unknown>) {
  return vi.fn(async (url: string) => {
    // Match by pathname+search against the routes map (longest-prefix wins).
    const path = url.replace("https://console.neon.tech/api/v2", "");
    for (const [prefix, body] of Object.entries(routes)) {
      if (path.startsWith(prefix)) {
        return { ok: true, status: 200, statusText: "OK", json: async () => body };
      }
    }
    return { ok: false, status: 404, statusText: "Not Found", json: async () => ({}) };
  });
}

const BRANCHES = (names: string[]) => ({
  branches: names.map((name, i) => ({ id: `br-${i}`, name })),
});
const DATABASES = { databases: [{ name: "neondb", owner_name: "app" }] };
const CONN = { uri: "postgresql://app:secret@ep-preview.neon.tech/neondb" };

describe("resolvePreviewConnectionUri", () => {
  it("resolves the connection URI for an existing preview branch", async () => {
    const fetchImpl = mockFetch({
      "/projects/proj_1/branches/br-1/databases": DATABASES,
      "/projects/proj_1/branches/br-1/connection_uri": {}, // not used
      "/projects/proj_1/connection_uri": CONN,
      "/projects/proj_1/branches": BRANCHES(["main", "preview/feature-x"]),
    });

    const result = await resolvePreviewConnectionUri({
      apiKey: "key",
      projectId: "proj_1",
      branchName: "preview/feature-x",
      fetchImpl,
      sleep: async () => {},
      log: silentLog,
    });

    expect(result.found).toBe(true);
    expect(result.uri).toBe(CONN.uri);
    expect(result.branchId).toBe("br-1");

    // The connection URI was requested for the resolved branch + its db/role.
    const connCall = fetchImpl.mock.calls.find(([u]) => String(u).includes("/connection_uri"));
    expect(String(connCall?.[0])).toContain("branch_id=br-1");
    expect(String(connCall?.[0])).toContain("database_name=neondb");
    expect(String(connCall?.[0])).toContain("role_name=app");
    expect(String(connCall?.[0])).toContain("pooled=false");
  });

  it("retries the branch lookup, then succeeds once the branch appears", async () => {
    let attempt = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      const path = String(url).replace("https://console.neon.tech/api/v2", "");
      if (path.startsWith("/projects/proj_1/branches/br-0/databases")) {
        return { ok: true, status: 200, statusText: "OK", json: async () => DATABASES };
      }
      if (path.startsWith("/projects/proj_1/connection_uri")) {
        return { ok: true, status: 200, statusText: "OK", json: async () => CONN };
      }
      if (path.startsWith("/projects/proj_1/branches")) {
        attempt += 1;
        // Absent on the first attempt, present on the second (Vercel just created it).
        const body = attempt >= 2 ? BRANCHES(["preview/late"]) : { branches: [] };
        return { ok: true, status: 200, statusText: "OK", json: async () => body };
      }
      return { ok: false, status: 404, statusText: "Not Found", json: async () => ({}) };
    });

    const sleep = vi.fn(async () => {});
    const result = await resolvePreviewConnectionUri({
      apiKey: "key",
      projectId: "proj_1",
      branchName: "preview/late",
      fetchImpl,
      sleep,
      attempts: 4,
      log: silentLog,
    });

    expect(result.found).toBe(true);
    expect(result.uri).toBe(CONN.uri);
    expect(sleep).toHaveBeenCalledTimes(1); // waited once between the two lookups
  });

  it("returns found:false (graceful skip) when the branch never appears", async () => {
    const fetchImpl = mockFetch({ "/projects/proj_1/branches": { branches: [] } });

    const result = await resolvePreviewConnectionUri({
      apiKey: "key",
      projectId: "proj_1",
      branchName: "preview/missing",
      fetchImpl,
      sleep: async () => {},
      attempts: 3,
      log: silentLog,
    });

    expect(result.found).toBe(false);
    expect(result.uri).toBeUndefined();
  });

  it("auto-detects the project id when exactly one project exists", async () => {
    const fetchImpl = mockFetch({
      "/projects/proj_only/branches/br-0/databases": DATABASES,
      "/projects/proj_only/connection_uri": CONN,
      "/projects/proj_only/branches": BRANCHES(["preview/x"]),
      "/projects": { projects: [{ id: "proj_only" }] },
    });

    const result = await resolvePreviewConnectionUri({
      apiKey: "key",
      branchName: "preview/x",
      fetchImpl,
      sleep: async () => {},
      log: silentLog,
    });

    expect(result.found).toBe(true);
    expect(result.projectId).toBe("proj_only");
  });

  it("throws (asking for NEON_PROJECT_ID) when the key has multiple projects", async () => {
    const fetchImpl = mockFetch({
      "/projects": { projects: [{ id: "a" }, { id: "b" }] },
    });

    await expect(
      resolvePreviewConnectionUri({
        apiKey: "key",
        branchName: "preview/x",
        fetchImpl,
        sleep: async () => {},
        log: silentLog,
      })
    ).rejects.toThrow(/NEON_PROJECT_ID/);
  });

  it("rethrows an auto-detect API failure (e.g. 400 from an org-scoped key) with the NEON_PROJECT_ID fix", async () => {
    // `GET /projects` 400s (org-scoped key) → not in the routes map, so mockFetch 404s;
    // simulate the 400 directly.
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: async () => ({}),
    }));

    await expect(
      resolvePreviewConnectionUri({
        apiKey: "key",
        branchName: "preview/x",
        fetchImpl,
        sleep: async () => {},
        log: silentLog,
      })
    ).rejects.toThrow(/NEON_PROJECT_ID/);
  });
});
