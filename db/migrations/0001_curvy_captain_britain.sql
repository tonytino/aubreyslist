CREATE TYPE "public"."moderation_action" AS ENUM('dismiss', 'hide', 'remove', 'restore');--> statement-breakpoint
CREATE TYPE "public"."moderation_status" AS ENUM('visible', 'hidden', 'removed');--> statement-breakpoint
CREATE TABLE "moderation_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text NOT NULL,
	"action" "moderation_action" NOT NULL,
	"listing_id" text,
	"claim_id" text,
	"incident_id" text,
	"flag_id" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_actions_one_target" CHECK (num_nonnulls("moderation_actions"."listing_id", "moderation_actions"."claim_id", "moderation_actions"."incident_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "moderation_status" "moderation_status" DEFAULT 'visible' NOT NULL;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "moderation_status" "moderation_status" DEFAULT 'visible' NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "moderation_status" "moderation_status" DEFAULT 'visible' NOT NULL;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_flag_id_flags_id_fk" FOREIGN KEY ("flag_id") REFERENCES "public"."flags"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "moderation_actions_listing_idx" ON "moderation_actions" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "moderation_actions_claim_idx" ON "moderation_actions" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "moderation_actions_incident_idx" ON "moderation_actions" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX "moderation_actions_flag_idx" ON "moderation_actions" USING btree ("flag_id");--> statement-breakpoint
CREATE INDEX "moderation_actions_actor_idx" ON "moderation_actions" USING btree ("actor_id");