import type { Role } from "~/server/auth/guards";

/**
 * Section-level gating for the admin panel shell (issue #38).
 *
 * The route itself is admin-only and guarded server-side (see
 * `app/server/admin/admin-view.fn.ts`), but ADR-010 / domain.md grant
 * **moderators** visibility of the moderation queue. So *within* the shell we
 * gate individual sections by role rather than gating the whole page at a
 * single privilege level: an admin sees every section; a moderator sees only
 * the moderation-queue section.
 *
 * This module is the single source of truth for "which sections does role X
 * see", kept pure (no DB, no request) so it is trivially unit-testable. The
 * route loader decides page-level access (anon / forbidden / allowed); this
 * decides section-level visibility once access is granted.
 */

/** Stable identifier for each admin-panel section. */
export type AdminSectionId = "roles" | "settings" | "moderation-queue";

/**
 * The minimum role that may view a given section. The moderation queue is
 * moderator+ (so admins, who out-rank moderators, also see it); role
 * management and app settings are admin-only.
 */
const SECTION_MIN_ROLE: Record<AdminSectionId, Exclude<Role, "user">> = {
  roles: "admin",
  settings: "admin",
  "moderation-queue": "moderator",
};

/**
 * Display order of the sections in the shell. Settings first (the only one with
 * live data today), then role management, then the moderation queue.
 */
export const ADMIN_SECTION_ORDER: readonly AdminSectionId[] = [
  "settings",
  "roles",
  "moderation-queue",
] as const;

/** Role privilege rank mirroring `guards.ts` (admin > moderator > user). */
const ROLE_RANK: Record<Role, number> = {
  user: 0,
  moderator: 1,
  admin: 2,
};

/**
 * Whether `role` may see `section`, by the admin > moderator > user hierarchy.
 * A role with rank >= the section's minimum role passes.
 */
export function canViewSection(role: Role, section: AdminSectionId): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[SECTION_MIN_ROLE[section]];
}

/**
 * The sections visible to `role`, in {@link ADMIN_SECTION_ORDER}. Admins get
 * all three; moderators get only the moderation queue; `user` gets none (such a
 * caller never reaches the shell, but the function stays total).
 */
export function visibleSections(role: Role): AdminSectionId[] {
  return ADMIN_SECTION_ORDER.filter((section) => canViewSection(role, section));
}
