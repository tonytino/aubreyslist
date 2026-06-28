import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Client-callable moderation-action server functions (issue #41).
 *
 * These `createServerFn` POST entry points are the ONLY part of the moderation
 * write layer that client code (the moderation-queue UI's TanStack Query
 * mutations) imports. The db-touching implementations live in the server-only
 * `./actions` module and are referenced only from inside each handler via a lazy
 * `import()`, so the bundler strips them (and their `db`-bound imports) out of
 * the browser bundle — mirroring `queue.fn.ts` / `flags.fn.ts`.
 *
 * The validator below mirrors `moderationActionInputSchema` in `./actions` (the
 * exclusive-arc target + optional prompting flag + optional note). It runs on
 * every client call as the authoritative server-side input gate; the server
 * module re-parses for direct callers/tests, and the DB CHECK is the ultimate
 * guarantee.
 */

const MODERATION_NOTE_MAX_LENGTH = 2000;

const noteSchema = z.string().trim().max(MODERATION_NOTE_MAX_LENGTH).optional();
const flagIdSchema = z.string().min(1).optional();

/** Exactly one target (exclusive arc) + optional prompting flag + optional note. */
export const moderationActionFnInputSchema = z.discriminatedUnion("target", [
  z
    .object({
      target: z.literal("listing"),
      listingId: z.string().min(1),
      flagId: flagIdSchema,
      note: noteSchema,
    })
    .strict(),
  z
    .object({
      target: z.literal("claim"),
      claimId: z.string().min(1),
      flagId: flagIdSchema,
      note: noteSchema,
    })
    .strict(),
  z
    .object({
      target: z.literal("incident"),
      incidentId: z.string().min(1),
      flagId: flagIdSchema,
      note: noteSchema,
    })
    .strict(),
]);

/** Dismiss the prompting flag (no content change). See `dismissFlag`. */
export const dismissFlagAction = createServerFn({ method: "POST" })
  .validator(moderationActionFnInputSchema)
  .handler(async ({ data }) => {
    const { dismissFlag } = await import("./actions");
    return dismissFlag(data);
  });

/** Hide the target — reversible takedown. See `hideContent`. */
export const hideContentAction = createServerFn({ method: "POST" })
  .validator(moderationActionFnInputSchema)
  .handler(async ({ data }) => {
    const { hideContent } = await import("./actions");
    return hideContent(data);
  });

/** Remove the target — terminal (still soft) takedown. See `removeContent`. */
export const removeContentAction = createServerFn({ method: "POST" })
  .validator(moderationActionFnInputSchema)
  .handler(async ({ data }) => {
    const { removeContent } = await import("./actions");
    return removeContent(data);
  });

/** Restore previously hidden/removed content to visible. See `restoreContent`. */
export const restoreContentAction = createServerFn({ method: "POST" })
  .validator(moderationActionFnInputSchema)
  .handler(async ({ data }) => {
    const { restoreContent } = await import("./actions");
    return restoreContent(data);
  });
