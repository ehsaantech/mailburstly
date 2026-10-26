CREATE TYPE "public"."activity_type" AS ENUM('email_sent', 'email_opened', 'link_clicked', 'reply_received', 'auto_reply', 'bounced', 'unsubscribed', 'status_changed', 'subsequence_entered');--> statement-breakpoint
CREATE TYPE "public"."blocklist_source" AS ENUM('manual', 'hard_bounce', 'unsubscribe', 'complaint', 'ai_blocklist');--> statement-breakpoint
CREATE TYPE "public"."blocklist_type" AS ENUM('email', 'domain');--> statement-breakpoint
CREATE TYPE "public"."campaign_state" AS ENUM('active', 'stopped', 'completed', 'suppressed', 'paused');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'active', 'paused', 'completed');--> statement-breakpoint
CREATE TYPE "public"."interest" AS ENUM('positive', 'neutral', 'negative');--> statement-breakpoint
CREATE TYPE "public"."lead_email_status" AS ENUM('unknown', 'valid', 'invalid', 'risky', 'catch_all');--> statement-breakpoint
CREATE TYPE "public"."mailbox_provider" AS ENUM('google', 'microsoft', 'imap_smtp');--> statement-breakpoint
CREATE TYPE "public"."mailbox_status" AS ENUM('connected', 'degraded', 'failed', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."send_job_state" AS ENUM('pending', 'claimed', 'sent', 'soft_bounced', 'hard_bounced', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."thread_mode" AS ENUM('reply', 'new_thread');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'member');--> statement-breakpoint
CREATE TABLE "mailboxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"provider" "mailbox_provider" NOT NULL,
	"status" "mailbox_status" DEFAULT 'connected' NOT NULL,
	"emailengine_id" text NOT NULL,
	"daily_cap" integer DEFAULT 30 NOT NULL,
	"health_score" real DEFAULT 100 NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"reply_to" text,
	"signature_html" text,
	"last_checked_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_agent" text,
	"ip" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" DEFAULT 'member' NOT NULL,
	"password_hash" text NOT NULL,
	"active" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mailboxes_email_idx" ON "mailboxes" USING btree ("email");--> statement-breakpoint
CREATE INDEX "mailboxes_status_idx" ON "mailboxes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "mailboxes_workspace_idx" ON "mailboxes" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_idx" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");