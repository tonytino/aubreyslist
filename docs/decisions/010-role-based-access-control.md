# ADR-010: Role-based access control (admin / moderator / user)

## Status

Accepted

## Context

Community input requires moderation: spam, trolling, competitor sabotage, and
honest-but-wrong reports all need a path to removal. At single-metro pilot scale
the volume is low, but the owner wants the ability to **grant moderator status
to any Google account at any time** (starting with themselves + trusted people,
expandable to friends) rather than being the sole moderator forever. We also
need an admin-only surface for app settings (intake mode, staleness window).

## Decision

Model a **three-tier role system from day one**: `admin`, `moderator`, `user`.
Role is a first-class field on the user record (not a retrofit). **Admins can
promote/demote moderators** at runtime. Moderators get the flag-review queue and
content-moderation actions; admins additionally manage roles and app settings.

## Consequences

- Persist a **`role` field** on the user; default new users to `user`.
- **Admin-only:** promote/demote moderators, manage AppSettings. **Moderator+:**
  view moderation queue, hide/remove/dismiss **any** content. **User:** create
  content, edit/retract **own** content, flag content.
- Enforce permissions **server-side** on every mutating/moderation route, not
  just in the UI.
- The first admin is the repo owner; seed/assign this during setup (a
  `safe:human` step).
- **No reputation-gated powers** in v1 — roles are explicitly granted, not
  earned. Light rate limiting is the only automatic write guardrail.
- The full permission matrix lives in `docs/agents/domain.md` (Roles section).
