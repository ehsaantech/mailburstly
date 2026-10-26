CREATE TABLE "processed_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" text NOT NULL,
	"event" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sent_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"message_id" text NOT NULL,
	"original_message_id" text,
	"lead_id" uuid,
	"campaign_id" uuid,
	"mailbox_id" uuid,
	"step_id" uuid,
	"variant_id" uuid,
	"recipient" text NOT NULL,
	"subject" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sent_messages" ADD CONSTRAINT "sent_messages_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sent_messages" ADD CONSTRAINT "sent_messages_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sent_messages" ADD CONSTRAINT "sent_messages_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sent_messages" ADD CONSTRAINT "sent_messages_step_id_campaign_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."campaign_steps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sent_messages" ADD CONSTRAINT "sent_messages_variant_id_step_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."step_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "processed_webhook_events_event_id_idx" ON "processed_webhook_events" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sent_messages_message_id_idx" ON "sent_messages" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "sent_messages_lead_idx" ON "sent_messages" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "sent_messages_campaign_idx" ON "sent_messages" USING btree ("campaign_id");