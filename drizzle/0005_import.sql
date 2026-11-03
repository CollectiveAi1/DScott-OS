ALTER TABLE "calendar_events" ADD COLUMN "import_batch" text;--> statement-breakpoint
CREATE INDEX "calendar_events_import_idx" ON "calendar_events" USING btree ("source","import_batch");