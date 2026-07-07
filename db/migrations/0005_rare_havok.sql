CREATE TYPE "public"."listing_link_kind" AS ENUM('menu', 'gluten_free_menu', 'website', 'reservations', 'online_ordering');--> statement-breakpoint
CREATE TABLE "listing_links" (
	"id" text PRIMARY KEY NOT NULL,
	"listing_id" text NOT NULL,
	"kind" "listing_link_kind" NOT NULL,
	"url" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listing_links_listing_kind_unique" UNIQUE("listing_id","kind")
);
--> statement-breakpoint
ALTER TABLE "listing_links" ADD CONSTRAINT "listing_links_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_links" ADD CONSTRAINT "listing_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "listing_links_listing_idx" ON "listing_links" USING btree ("listing_id");