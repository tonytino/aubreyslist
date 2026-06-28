import { eq } from "drizzle-orm";
import { getDb } from "~/db/client";
import { type User, users } from "~/db/schema";
import type { GoogleUserInfo } from "./google";

/**
 * Resolve a Google profile to a `users` row, creating it on first sign-in.
 *
 * Identity anchors on the Google subject (`google_sub`, ADR-006): we look up by
 * it, insert a fresh row (role defaults to `user` per ADR-010 — set DB-side via
 * the column default, never trusted from the client) when absent, and otherwise
 * refresh the mutable profile fields (email/name/avatar) on the existing row so
 * returning users stay in sync with Google. Role is never touched here, so an
 * admin/moderator promotion survives subsequent sign-ins.
 */
export async function upsertUserFromGoogle(profile: GoogleUserInfo): Promise<User> {
  const db = getDb();

  const name = profile.name?.trim() || profile.email;
  const avatarUrl = profile.picture ?? null;

  const existing = await db.query.users.findFirst({
    where: eq(users.googleSub, profile.sub),
  });

  if (existing) {
    const [updated] = await db
      .update(users)
      .set({
        email: profile.email,
        name,
        avatarUrl,
        updatedAt: new Date(),
      })
      .where(eq(users.id, existing.id))
      .returning();
    return updated ?? existing;
  }

  const [created] = await db
    .insert(users)
    .values({
      googleSub: profile.sub,
      email: profile.email,
      name,
      avatarUrl,
      // role omitted on purpose → DB default `user` (ADR-010).
    })
    .returning();

  if (!created) {
    throw new Error("Failed to create user row for Google account");
  }
  return created;
}
