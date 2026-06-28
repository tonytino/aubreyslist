import { HTTPException } from "hono/http-exception";
import { getCurrentUser } from "../auth/current-user";

/**
 * Per-user write rate limiting — a light anti-abuse guardrail for mutating
 * endpoints (add listing, attest, report incident). It mirrors the guard idiom
 * in `app/server/auth/guards.ts`: a *synchronous* core guard the caller drives
 * with an already-resolved key, plus an *async* convenience wrapper that reads
 * the ambient session itself. The same limiter therefore backs both API layers
 * (`docs/agents/api.md`):
 *
 * - **Hono routes** resolve the user from the request, then call the synchronous
 *   {@link enforceRateLimit} with the user id as the key.
 * - **Server functions** can skip that plumbing with {@link enforceWriteLimit},
 *   which resolves the current user via {@link getCurrentUser} first.
 *
 * On breach it throws `HTTPException(429, …)` with a friendly message. The Hono
 * error handler in `app/server/index.ts` returns it verbatim with the right
 * status; in a server function it surfaces as a thrown error, so an abusive
 * burst never proceeds. This is purely a guardrail — there is **no** reputation
 * gating here (per domain.md "Roles & Permissions").
 *
 * @example Wrapping a write server function
 * ```ts
 * import { createServerFn } from "@tanstack/react-start";
 * import { requireCurrentUser } from "~/server/auth/guards";
 * import { enforceWriteLimit } from "~/server/rate-limit";
 *
 * export const createListing = createServerFn({ method: "POST" })
 *   .validator(createListingSchema)
 *   .handler(async ({ data }) => {
 *     const user = await requireCurrentUser(); // 401 if anonymous
 *     await enforceWriteLimit(user.id);        // 429 if over the burst cap
 *     return insertListing(data, user.id);
 *   });
 * ```
 *
 * @remarks **Serverless caveat (ADR-009).** This app deploys to Vercel
 * serverless, where in-memory state does **not** persist across instances or
 * invocations — each cold start gets a fresh, empty bucket map, and concurrent
 * instances keep independent counters. This limiter is therefore deliberately
 * **best-effort, per-instance**: it reliably caps a single hot instance but does
 * not provide a globally-consistent limit. That is an acceptable v1 anti-abuse
 * guardrail (simple, dependency-free, no new infra). Production hardening — a
 * durable, shared counter (e.g. Postgres or Upstash Redis) — is the follow-up
 * when a strict global limit is required.
 *
 * This module is server-only.
 */

/** Tunable rate-limit thresholds. */
export interface RateLimitConfig {
  /** Maximum number of writes allowed within {@link windowMs}. */
  limit: number;
  /** Length of the fixed window, in milliseconds. */
  windowMs: number;
}

/**
 * Default write thresholds: 50 writes per rolling 60-second window per user —
 * generous enough never to bother a real user, tight enough to blunt scripted
 * bursts (issue #18).
 *
 * @remarks These live in code for v1. They can later be sourced from
 * `app_settings` (issue #13) so an admin can tune them without a deploy; until
 * then, treat these constants as the single source of truth.
 */
export const DEFAULT_WRITE_RATE_LIMIT: RateLimitConfig = {
  limit: 50,
  windowMs: 60_000,
};

/**
 * A monotonic-enough source of the current time in ms. Injectable so window
 * resets are deterministically testable without real sleeps; defaults to
 * `Date.now`.
 */
export type Clock = () => number;

/** One key's fixed-window counter: how many writes, and when the window opened. */
interface Bucket {
  /** Writes recorded so far in the current window. */
  count: number;
  /** Wall-clock ms at which the current window started. */
  windowStart: number;
}

/**
 * A best-effort, in-memory per-key fixed-window rate limiter. Instances hold
 * their own bucket map, so tests get full isolation and the production singleton
 * ({@link writeRateLimiter}) stays a private module detail.
 *
 * The window is *fixed*, not sliding: the first request for a key opens a window
 * of `windowMs`; subsequent requests increment the same window's counter until
 * it elapses, then the next request opens a fresh window. This is the simplest
 * scheme that satisfies "cap bursts" without a dependency.
 */
export class InMemoryRateLimiter {
  readonly #config: RateLimitConfig;
  readonly #now: Clock;
  readonly #buckets = new Map<string, Bucket>();

  /**
   * @param config Thresholds; defaults to {@link DEFAULT_WRITE_RATE_LIMIT}.
   * @param now Clock; defaults to `Date.now` (inject for deterministic tests).
   */
  constructor(config: RateLimitConfig = DEFAULT_WRITE_RATE_LIMIT, now: Clock = Date.now) {
    this.#config = config;
    this.#now = now;
  }

  /**
   * Record one hit for `key` and report whether it is within the limit. The
   * counter is consumed only when allowed; a rejected hit does not advance the
   * count, so a caller that backs off is not penalised further within the same
   * window.
   *
   * @returns `true` when the hit is allowed, `false` when the limit is exceeded.
   */
  hit(key: string): boolean {
    const now = this.#now();
    const bucket = this.#buckets.get(key);

    // No window yet, or the previous window has fully elapsed -> open a fresh one.
    if (!bucket || now - bucket.windowStart >= this.#config.windowMs) {
      this.#buckets.set(key, { count: 1, windowStart: now });
      return true;
    }

    if (bucket.count >= this.#config.limit) {
      return false;
    }

    bucket.count += 1;
    return true;
  }

  /**
   * Synchronous guard: record a hit for `key` and throw `HTTPException(429)`
   * when the limit is exceeded. Mirrors `requireUser` in guards.ts — the caller
   * supplies the already-resolved key, which is what lets both Hono routes and
   * server functions reuse one limiter.
   *
   * @throws {HTTPException} `429 Too Many Requests` when over the limit.
   */
  enforce(key: string): void {
    if (!this.hit(key)) {
      throw new HTTPException(429, {
        message: "You're doing that too fast. Please wait a moment and try again.",
      });
    }
  }

  /** Drop a single key's window — handy for tests; no-op if absent. */
  reset(key: string): void {
    this.#buckets.delete(key);
  }

  /** Drop all windows — handy for tests. */
  clear(): void {
    this.#buckets.clear();
  }
}

/**
 * Process-wide write limiter used by production code paths. Best-effort and
 * per-instance on serverless (see the module-level serverless caveat).
 */
const writeRateLimiter = new InMemoryRateLimiter();

/**
 * Synchronous write guard for callers that already hold the user id (e.g. Hono
 * routes that resolved the user from the request). Throws
 * `HTTPException(429)` when the per-user write limit is exceeded.
 *
 * @param userId The key to meter on — one independent window per user.
 * @throws {HTTPException} `429 Too Many Requests` when over the limit.
 */
export function enforceRateLimit(userId: string): void {
  writeRateLimiter.enforce(userId);
}

/**
 * Async convenience for server functions: resolve the ambient user via
 * {@link getCurrentUser}, then apply {@link enforceRateLimit}.
 *
 * It is metered per authenticated user; anonymous callers are *not* rate-limited
 * here because writes are already gated to authenticated users by the auth
 * guards (`requireCurrentUser`), which run first. Call this *after* the auth
 * guard so an anonymous caller gets a `401`, not a `429`. When no user is
 * resolvable this is a no-op (the auth guard owns rejecting anonymous writes).
 *
 * @param userId Optional explicit key; when omitted the ambient user id is used.
 * @throws {HTTPException} `429 Too Many Requests` when over the limit.
 */
export async function enforceWriteLimit(userId?: string): Promise<void> {
  const key = userId ?? (await getCurrentUser())?.id;
  if (!key) {
    return;
  }
  enforceRateLimit(key);
}
