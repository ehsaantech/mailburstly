CREATE TABLE "macros" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"body_html" text DEFAULT '' NOT NULL,
	"body_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auto_pause_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"campaign_id" uuid,
	"metric_value" real NOT NULL,
	"action_taken" text NOT NULL,
	"fired_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auto_pause_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"campaign_id" uuid,
	"metric" text NOT NULL,
	"threshold" real NOT NULL,
	"direction" text DEFAULT 'above' NOT NULL,
	"action" text DEFAULT 'pause_campaign' NOT NULL,
	"enabled" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_fired_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "has_unread" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "remind_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "scheduled_reply_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "scheduled_reply_body" text;--> statement-breakpoint
ALTER TABLE "macros" ADD CONSTRAINT "macros_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_pause_events" ADD CONSTRAINT "auto_pause_events_rule_id_auto_pause_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."auto_pause_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_pause_events" ADD CONSTRAINT "auto_pause_events_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_pause_rules" ADD CONSTRAINT "auto_pause_rules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_pause_rules" ADD CONSTRAINT "auto_pause_rules_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "macros_name_idx" ON "macros" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE INDEX "macros_workspace_idx" ON "macros" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "auto_pause_events_rule_idx" ON "auto_pause_events" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "auto_pause_events_campaign_idx" ON "auto_pause_events" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "auto_pause_rules_workspace_idx" ON "auto_pause_rules" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "auto_pause_rules_campaign_idx" ON "auto_pause_rules" USING btree ("campaign_id");