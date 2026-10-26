CREATE TABLE "lead_labels" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "lead_labels_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"interest" "interest" DEFAULT 'neutral' NOT NULL,
	"is_builtin" integer DEFAULT 0 NOT NULL,
	"use_ai" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"email" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"company" text,
	"title" text,
	"phone" text,
	"status_id" integer,
	"email_status" "lead_email_status" DEFAULT 'unknown' NOT NULL,
	"verification_score" real,
	"custom_variables" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"owner_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "blocklist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"type" text NOT NULL,
	"value" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bounces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"campaign_id" uuid,
	"mailbox_id" uuid,
	"step_id" uuid,
	"reason" text NOT NULL,
	"code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"current_step_id" uuid,
	"state" "campaign_state" DEFAULT 'active' NOT NULL,
	"stopped_reason" text,
	"next_step_at" timestamp with time zone,
	"last_sent_at" timestamp with time zone,
	"variant_assignments" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"paused_until" timestamp with time zone,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "campaign_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"subject" text,
	"body_html" text DEFAULT '' NOT NULL,
	"body_text" text,
	"preheader" text,
	"delay_minutes" integer DEFAULT 0 NOT NULL,
	"thread_mode" "thread_mode" DEFAULT 'reply' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"daily_limit" integer,
	"daily_max_leads" integer,
	"email_gap_minutes" integer DEFAULT 9 NOT NULL,
	"random_wait_max" integer DEFAULT 5 NOT NULL,
	"stop_on_reply" boolean DEFAULT true NOT NULL,
	"stop_on_auto_reply" boolean DEFAULT false NOT NULL,
	"stop_for_company" boolean DEFAULT true NOT NULL,
	"open_tracking" boolean DEFAULT true NOT NULL,
	"link_tracking" boolean DEFAULT true NOT NULL,
	"text_only" boolean DEFAULT false NOT NULL,
	"insert_unsubscribe_header" boolean DEFAULT true NOT NULL,
	"allow_risky_contacts" boolean DEFAULT false NOT NULL,
	"schedule" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"owner_id" uuid,
	"paused_reason" text,
	"paused_at" timestamp with time zone,
	"launched_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "send_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_lead_id" uuid NOT NULL,
	"step_id" uuid NOT NULL,
	"variant_id" uuid,
	"mailbox_id" uuid NOT NULL,
	"scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "step_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"step_id" uuid NOT NULL,
	"label" text NOT NULL,
	"subject" text,
	"body_html" text DEFAULT '' NOT NULL,
	"weight" integer DEFAULT 100 NOT NULL,
	"pinned" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_status_id_lead_labels_id_fk" FOREIGN KEY ("status_id") REFERENCES "public"."lead_labels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bounces" ADD CONSTRAINT "bounces_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bounces" ADD CONSTRAINT "bounces_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bounces" ADD CONSTRAINT "bounces_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bounces" ADD CONSTRAINT "bounces_step_id_campaign_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."campaign_steps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_leads" ADD CONSTRAINT "campaign_leads_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_leads" ADD CONSTRAINT "campaign_leads_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_leads" ADD CONSTRAINT "campaign_leads_current_step_id_campaign_steps_id_fk" FOREIGN KEY ("current_step_id") REFERENCES "public"."campaign_steps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_steps" ADD CONSTRAINT "campaign_steps_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "send_jobs" ADD CONSTRAINT "send_jobs_campaign_lead_id_campaign_leads_id_fk" FOREIGN KEY ("campaign_lead_id") REFERENCES "public"."campaign_leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "send_jobs" ADD CONSTRAINT "send_jobs_step_id_campaign_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."campaign_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "send_jobs" ADD CONSTRAINT "send_jobs_variant_id_step_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."step_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "send_jobs" ADD CONSTRAINT "send_jobs_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_variants" ADD CONSTRAINT "step_variants_step_id_campaign_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."campaign_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lead_labels_name_idx" ON "lead_labels" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_email_idx" ON "leads" USING btree ("workspace_id","email");--> statement-breakpoint
CREATE INDEX "leads_status_idx" ON "leads" USING btree ("status_id");--> statement-breakpoint
CREATE INDEX "leads_owner_idx" ON "leads" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "blocklist_value_idx" ON "blocklist" USING btree ("workspace_id","type","value");--> statement-breakpoint
CREATE INDEX "bounces_lead_idx" ON "bounces" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "bounces_campaign_idx" ON "bounces" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_leads_unique_idx" ON "campaign_leads" USING btree ("campaign_id","lead_id");--> statement-breakpoint
CREATE INDEX "campaign_leads_state_idx" ON "campaign_leads" USING btree ("state");--> statement-breakpoint
CREATE INDEX "campaign_leads_next_step_idx" ON "campaign_leads" USING btree ("next_step_at");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_steps_position_idx" ON "campaign_steps" USING btree ("campaign_id","position");--> statement-breakpoint
CREATE INDEX "campaigns_status_idx" ON "campaigns" USING btree ("status");--> statement-breakpoint
CREATE INDEX "campaigns_workspace_idx" ON "campaigns" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "send_jobs_state_idx" ON "send_jobs" USING btree ("state");--> statement-breakpoint
CREATE INDEX "send_jobs_scheduled_idx" ON "send_jobs" USING btree ("scheduled_at");--> statement-breakpoint
CREATE INDEX "send_jobs_mailbox_idx" ON "send_jobs" USING btree ("mailbox_id");--> statement-breakpoint
CREATE INDEX "step_variants_step_idx" ON "step_variants" USING btree ("step_id");