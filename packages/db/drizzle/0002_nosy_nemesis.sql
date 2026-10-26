CREATE TABLE "mailbox_daily_stats" (
	"mailbox_id" uuid NOT NULL,
	"date" text NOT NULL,
	"sent" integer DEFAULT 0 NOT NULL,
	"bounced" integer DEFAULT 0 NOT NULL,
	"errors" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mailbox_daily_stats" ADD CONSTRAINT "mailbox_daily_stats_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mailbox_daily_stats_pk_idx" ON "mailbox_daily_stats" USING btree ("mailbox_id","date");--> statement-breakpoint
CREATE INDEX "mailbox_daily_stats_date_idx" ON "mailbox_daily_stats" USING btree ("date");