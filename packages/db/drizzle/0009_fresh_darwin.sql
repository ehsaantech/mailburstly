CREATE TABLE "campaign_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"list_id" uuid NOT NULL,
	"attached_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_list_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "enroll_on_add" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "campaign_lists" ADD CONSTRAINT "campaign_lists_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_lists" ADD CONSTRAINT "campaign_lists_list_id_lead_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lead_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_list_members" ADD CONSTRAINT "lead_list_members_list_id_lead_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lead_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_list_members" ADD CONSTRAINT "lead_list_members_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_lists" ADD CONSTRAINT "lead_lists_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_lists_unique_idx" ON "campaign_lists" USING btree ("campaign_id","list_id");--> statement-breakpoint
CREATE INDEX "campaign_lists_list_idx" ON "campaign_lists" USING btree ("list_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_list_members_unique_idx" ON "lead_list_members" USING btree ("list_id","lead_id");--> statement-breakpoint
CREATE INDEX "lead_list_members_lead_idx" ON "lead_list_members" USING btree ("lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_lists_name_idx" ON "lead_lists" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE INDEX "lead_lists_workspace_idx" ON "lead_lists" USING btree ("workspace_id");