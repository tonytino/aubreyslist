-- Data-preserving enum-value rename (AUB-297), hand-edited into the
-- drizzle-generated migration: renaming an enum value forces the
-- type-recreate below, and the final `attribute::claim_attribute` cast FAILS
-- on any row still holding the old `celiac_safe_vs_gluten_friendly` value.
-- drizzle-kit can't express a data migration, so this UPDATE is a documented
-- exception to "never hand-edit migrations" (docs/agents/database.md), on the
-- precedent of 0002_old_tigra.sql. Unlike 0002's purge this REWRITES rows
-- rather than deleting them — the rename is cosmetic and every claim (plus its
-- cascading attestations, flags and moderation_actions) must survive it. The
-- UPDATE sits after the column becomes `text`, the earliest point at which the
-- new value is writable. No-op when zero rows match.
ALTER TABLE "claims" ALTER COLUMN "attribute" SET DATA TYPE text;--> statement-breakpoint
UPDATE "claims" SET "attribute" = 'celiac_safe' WHERE "attribute" = 'celiac_safe_vs_gluten_friendly';--> statement-breakpoint
DROP TYPE "public"."claim_attribute";--> statement-breakpoint
CREATE TYPE "public"."claim_attribute" AS ENUM('celiac_safe', 'dedicated_fryer', 'dedicated_gf_menu', 'off_menu_gf_on_request', 'gf_substitutes');--> statement-breakpoint
ALTER TABLE "claims" ALTER COLUMN "attribute" SET DATA TYPE "public"."claim_attribute" USING "attribute"::"public"."claim_attribute";
