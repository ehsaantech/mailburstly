CREATE TABLE "campaign_mailboxes" (
	"campaign_id" uuid NOT NULL,
	"mailbox_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_mailboxes" ADD CONSTRAINT "campaign_mailboxes_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_mailboxes" ADD CONSTRAINT "campaign_mailboxes_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_mailboxes_pk_idx" ON "campaign_mailboxes" USING btree ("campaign_id","mailbox_id");--> statement-breakpoint
CREATE INDEX "campaign_mailboxes_mailbox_idx" ON "campaign_mailboxes" USING btree ("mailbox_id");