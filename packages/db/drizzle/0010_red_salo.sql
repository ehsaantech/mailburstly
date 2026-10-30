CREATE TYPE "public"."alert_severity" AS ENUM('error', 'warning');--> statement-breakpoint
CREATE TABLE "alert_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"severity" "alert_severity" DEFAULT 'error' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_recipients" ADD CONSTRAINT "alert_recipients_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_recipients_workspace_email_idx" ON "alert_recipients" USING btree ("workspace_id","email");--> statement-breakpoint
CREATE INDEX "alert_recipients_workspace_idx" ON "alert_recipients" USING btree ("workspace_id");