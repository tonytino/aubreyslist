import { eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { z } from "zod";
import { getDb } from "~/db/client";
import {
  type ModerationStatus,
  claims,
  flags,
  incidents,
  listings,
  moderationActions,
} from "~/db/schema";
import { requireCurrentRole } from "~/server/auth/guards";

/**
 * Moderation ACTIONS — the server-only write layer a moderator/admin uses to act
 * on flagged content (issue #41, ADR-010 + domain.md "Roles & Permissions").
 *
 * The design is deliberately the SAFEST option: every action is
 *
 *  - **soft** — content is never hard-deleted; `hide`/`remove` flip the content
 *    row's `moderationStatus` enum (`db/schema.ts`), `restore` flips it back, so
 *    every decision is fully REVERSIBLE and preserves the audit trail;
 *  - **audited** — every action appends an immutable `moderation_actions` row
 *    (who/what/which target/which prompting flag/optional note/when), so the
 *    history is complete (a `hide` then a `restore` are two rows, never an
 *    overwrite);
 *  - **atomic** — the audit row, the content-state change (where applicable), and
 *    the prompting flag's status change are written in ONE `db.batch(...)` so a
 *    partial application can never leave the queue and content out of sync.
 *
 * Trust principle (domain.md → Trust Model, "recent harm is never buried"): the
 * PUBLIC read paths exclude non-`visible` content and recompute aggregates from
 * the surviving rows, so moderation can only ever REMOVE moderated-away content
 * from the public surface — it can never bury a real, still-visible incident.
 *
 * Permission boundary: every entry point runs `requireCurrentRole("moderator")`
 * FIRST (admins out-rank moderators and pass; a plain `user` gets 403; an
 * anonymous caller gets 401) BEFORE any DB work — the gate is enforced
 * server-side off the authoritative `users` row, never trusted to the UI.
 *
 * Server-only: imports the DB client and the auth guards. NEVER import from
 * client code — the client-callable `createServerFn` wrappers live in
 * `./actions.fn.ts` (the `*.fn.ts` convention) so the browser bundle never drags
 * in `getDb` (neon/drizzle).
 */

// ---------------------------------------------------------------------------
// Input validation — exactly one target (exclusive arc) + optional flag + note
// ---------------------------------------------------------------------------

/** Max moderation-note length — generous for rationale, bounded to blunt bloat. */
export const MODERATION_NOTE_MAX_LENGTH = 2000;

/** An optional, length-bounded moderator note (trimmed; empty → omitted). */
const noteSchema = z
  .string()
  .trim()
  .max(
    MODERATION_NOTE_MAX_LENGTH,
    `Note must be ${MODERATION_NOTE_MAX_LENGTH} characters or fewer.`
  )
  .optional();

/** The flag that prompted the action (optional — e.g. a direct restore). */
const flagIdSchema = z.string().min(1).optional();

/**
 * Exactly one target must be set. A discriminated union enforces the
 * exclusive-arc invariant structurally (mirroring `createFlagInputSchema` and the
 * DB `num_nonnulls(...) = 1` CHECK on `moderation_actions`): each branch is
 * `.strict()` and carries exactly one target id, so a payload with zero targets
 * matches no branch and a payload with multiple ids is rejected for the unknown
 * extra key — long before it reaches the DB.
 */
export const moderationActionInputSchema = z.discriminatedUnion("target", [
  z
    .object({
      target: z.literal("listing"),
      listingId: z.string().min(1, "listingId is required"),
      flagId: flagIdSchema,
      note: noteSchema,
    })
    .strict(),
  z
    .object({
      target: z.literal("claim"),
      claimId: z.string().min(1, "claimId is required"),
      flagId: flagIdSchema,
      note: noteSchema,
    })
    .strict(),
  z
    .object({
      target: z.literal("incident"),
      incidentId: z.string().min(1, "incidentId is required"),
      flagId: flagIdSchema,
      note: noteSchema,
    })
    .strict(),
]);
export type ModerationActionInput = z.infer<typeof moderationActionInputSchema>;

// ---------------------------------------------------------------------------
// Internal helpers — resolve the single target + the content-status update
// ---------------------------------------------------------------------------

/** The exclusive-arc target columns for the `moderation_actions` insert. */
type TargetColumns = { listingId: string } | { claimId: string } | { incidentId: string };

/** Resolve the single set target column from the discriminated input. */
function resolveTargetColumns(input: ModerationActionInput): TargetColumns {
  switch (input.target) {
    case "listing":
      return { listingId: input.listingId };
    case "claim":
      return { claimId: input.claimId };
    case "incident":
      return { incidentId: input.incidentId };
  }
}

/** Build the `UPDATE <content> SET moderation_status = status` statement for the target. */
function buildContentStatusUpdate(
  db: ReturnType<typeof getDb>,
  input: ModerationActionInput,
  status: ModerationStatus
) {
  const now = new Date();
  switch (input.target) {
    case "listing":
      return db
        .update(listings)
        .set({ moderationStatus: status, updatedAt: now })
        .where(eq(listings.id, input.listingId));
    case "claim":
      return db
        .update(claims)
        .set({ moderationStatus: status, updatedAt: now })
        .where(eq(claims.id, input.claimId));
    case "incident":
      return db
        .update(incidents)
        .set({ moderationStatus: status, updatedAt: now })
        .where(eq(incidents.id, input.incidentId));
  }
}

/**
 * The shared write path for every action (issue #41).
 *
 * 1. Gate: `requireCurrentRole("moderator")` (admins pass) BEFORE any DB work.
 * 2. Validate: parse the exclusive-arc target + optional note/flagId via Zod.
 * 3. Atomic `db.batch(...)`: append the `moderation_actions` audit row, then (for
 *    hide/remove/restore) flip the target content's `moderationStatus`, then (for
 *    dismiss/hide/remove) set the prompting flag's `flags.status`. `restore` and
 *    actions without a prompting flag write only the rows that apply.
 *
 * `contentStatus` is the new content state (null ⇒ leave content untouched, i.e.
 * `dismiss`). `flagStatus` is the new prompting-flag status (null ⇒ leave the
 * flag untouched, i.e. `restore`); only applied when a `flagId` was supplied.
 */
async function applyModerationAction(
  rawInput: ModerationActionInput,
  action: "dismiss" | "hide" | "remove" | "restore",
  contentStatus: ModerationStatus | null,
  flagStatus: "resolved" | "dismissed" | null
): Promise<void> {
  // 1. Permission boundary FIRST — before any validation or DB work.
  const actor = await requireCurrentRole("moderator");

  // 2. Validate the exclusive-arc target + optional note/flag.
  const input = moderationActionInputSchema.parse(rawInput);

  const db = getDb();
  const target = resolveTargetColumns(input);

  // 3. Assemble the atomic batch: audit row first (always), then the content
  //    state change (when applicable), then the prompting flag's status (when a
  //    flag prompted the action). `db.batch` runs as a single transaction over
  //    the Neon HTTP driver, so the three either all apply or none do.
  const auditInsert = db.insert(moderationActions).values({
    actorId: actor.id,
    action,
    ...target,
    flagId: input.flagId ?? null,
    note: input.note && input.note.length > 0 ? input.note : null,
  });

  // Heterogeneous batch (insert + updates), so type the array as the driver's
  // `BatchItem` union rather than letting it infer the audit-insert type only.
  const statements: BatchItem<"pg">[] = [auditInsert];

  if (contentStatus !== null) {
    statements.push(buildContentStatusUpdate(db, input, contentStatus));
  }

  if (flagStatus !== null && input.flagId) {
    statements.push(
      db
        .update(flags)
        .set({ status: flagStatus, updatedAt: new Date() })
        .where(eq(flags.id, input.flagId))
    );
  }

  // `db.batch` requires a non-empty tuple; `auditInsert` is always present, so
  // narrow the `BatchItem[]` to the `[item, ...items]` shape the signature wants.
  await db.batch(statements as [BatchItem<"pg">, ...BatchItem<"pg">[]]);
}

// ---------------------------------------------------------------------------
// Public actions — dismiss / hide / remove / restore
// ---------------------------------------------------------------------------

/**
 * Dismiss the prompting flag: the report was reviewed and needs no content
 * change. Content is left untouched (`moderationStatus` unchanged); the flag (if
 * supplied) moves to `dismissed`, leaving the triage queue. Audited as `dismiss`.
 */
export async function dismissFlag(input: ModerationActionInput): Promise<void> {
  await applyModerationAction(input, "dismiss", null, "dismissed");
}

/**
 * Hide the target — a reversible takedown. Content → `hidden` (excluded from
 * public reads; aggregates recompute from the survivors), the prompting flag (if
 * supplied) → `resolved`. Audited as `hide`. Reverse with {@link restoreContent}.
 */
export async function hideContent(input: ModerationActionInput): Promise<void> {
  await applyModerationAction(input, "hide", "hidden", "resolved");
}

/**
 * Remove the target — a terminal moderator decision. Content → `removed` (still
 * SOFT — never hard-deleted, so it stays auditable and reversible), the prompting
 * flag (if supplied) → `resolved`. Audited as `remove`. Reverse with
 * {@link restoreContent}.
 */
export async function removeContent(input: ModerationActionInput): Promise<void> {
  await applyModerationAction(input, "remove", "removed", "resolved");
}

/**
 * Restore previously-hidden/removed content back to public visibility. Content →
 * `visible`; the flag is left untouched (a restore is a content decision, not a
 * triage one). Audited as `restore`.
 */
export async function restoreContent(input: ModerationActionInput): Promise<void> {
  await applyModerationAction(input, "restore", "visible", null);
}

// The client-callable `createServerFn` wrappers live in `./actions.fn.ts` (the
// `*.fn.ts` convention), so client code never imports this db-touching module.
