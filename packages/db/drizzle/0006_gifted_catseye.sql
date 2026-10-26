ALTER TABLE "send_jobs" ADD COLUMN "subsequence_step_id" uuid;--> statement-breakpoint
ALTER TABLE "subsequence_enrollments" ADD COLUMN "paused_campaign_lead_id" uuid;