ALTER TABLE "campaigns" ADD COLUMN "tags" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "archived_at" timestamp with time zone;