import { createServerFn } from "@tanstack/react-start";

/**
 * Client-callable moderation-queue server function (issue #40).
 *
 * This `createServerFn` entry point is the ONLY part of the moderation-queue
 * server layer that client code (the route loader + the queue UI's TanStack
 * Query) imports. Mirroring `admin-view.fn.ts` / `set-role.fn.ts`, the
 * db-touching implementation lives in the server-only `./queue` module and is
 * referenced only from inside the handler via a lazy `import()`, so the bundler
 * strips it (and its `db`-bound imports) out of the browser bundle.
 *
 * The exported types below are type-only (erased at build time), so they are
 * safe to import from client code — the route loader and the queue component
 * consume them.
 */

/** Which entity a flag targets — the exclusive arc on the `flags` table. */
export type QueueTargetType = "listing" | "claim" | "incident";

/** The resolved target of a flagged item, with a human label for triage. */
export interface QueueTarget {
  /** Which kind of content was flagged. */
  type: QueueTargetType;
  /** The flagged row's id (listing/claim/incident id). */
  id: string;
  /** A human label/snippet: the listing name, claim attribute, or incident note. */
  label: string;
  /**
   * The listing the target belongs to, for linking moderators to context. It is
   * the target itself for a listing flag, the claim/incident's parent listing
   * otherwise; `null` only if the joined content row is missing.
   */
  listingId: string | null;
}

/** The reporter who filed a flag — surfaced so moderators know who raised it. */
export interface QueueReporter {
  name: string;
  email: string;
}

/** One open flag with the context a moderator needs to triage it. */
export interface QueueItem {
  /** The flag row id (the unit a moderation action will act on, #41). */
  id: string;
  /** The reporter's free-text reason for flagging. */
  reason: string;
  /** When the flag was filed. */
  createdAt: Date;
  /** Who filed it. */
  reporter: QueueReporter;
  /** What was flagged, with a human label. */
  target: QueueTarget;
}

/**
 * What the moderation-queue loader gets back. `access` discriminates the three
 * UX outcomes (mirroring `AdminView`); `items` is present only when granted.
 */
export type ModerationQueue =
  | { access: "anonymous" }
  | { access: "forbidden" }
  | { access: "granted"; items: QueueItem[] };

export const fetchModerationQueue = createServerFn({ method: "GET" }).handler(
  async (): Promise<ModerationQueue> => {
    // Imported lazily inside the handler so the server-only query (and its
    // `db`-bound deps) stays out of the client bundle.
    const { resolveModerationQueue } = await import("./queue");
    return resolveModerationQueue();
  }
);
