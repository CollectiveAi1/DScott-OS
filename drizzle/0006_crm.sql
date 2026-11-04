ALTER TABLE "pipelines" ADD COLUMN "billing_stages" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "handoff_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_handoff_key_idx" ON "tasks" USING btree ("handoff_key");--> statement-breakpoint
CREATE INDEX "timeline_contact_created_idx" ON "timeline" USING btree ("contact_id","created_at" DESC NULLS LAST);