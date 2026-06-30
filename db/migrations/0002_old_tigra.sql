-- Data purge (issue #175), prepended by hand to the drizzle-generated migration:
-- removing enum values forces the type-recreate below, and the final
-- `attribute::claim_attribute` cast FAILS on any row still holding a removed
-- value. drizzle-kit can't express a data migration, so this DELETE is the one
-- documented exception to "never hand-edit migrations" (docs/agents/database.md).
-- All FKs to claims (attestations, flags, moderation_actions) are ON DELETE
-- CASCADE, so this also clears their dependent rows. No-op when zero rows match.
DELETE FROM "claims" WHERE "attribute" IN ('cross_contamination_protocol', 'staff_knowledge');--> statement-breakpoint
ALTER TABLE "public"."claims" ALTER COLUMN "attribute" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."claim_attribute";--> statement-breakpoint
CREATE TYPE "public"."claim_attribute" AS ENUM('celiac_safe_vs_gluten_friendly', 'dedicated_fryer', 'dedicated_gf_menu', 'off_menu_gf_on_request', 'gf_substitutes');--> statement-breakpoint
ALTER TABLE "public"."claims" ALTER COLUMN "attribute" SET DATA TYPE "public"."claim_attribute" USING "attribute"::"public"."claim_attribute";
