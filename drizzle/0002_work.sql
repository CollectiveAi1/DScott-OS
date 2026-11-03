ALTER TABLE "boards" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "notes" text;--> statement-breakpoint
CREATE INDEX "tasks_misc_idx" ON "tasks" USING btree ("from_misc","created_at");--> statement-breakpoint
CREATE INDEX "tasks_arena_status_idx" ON "tasks" USING btree ("arena","status");