CREATE TABLE "conflict_acks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_a_id" uuid NOT NULL,
	"event_b_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conflict_acks" ADD CONSTRAINT "conflict_acks_event_a_id_calendar_events_id_fk" FOREIGN KEY ("event_a_id") REFERENCES "public"."calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflict_acks" ADD CONSTRAINT "conflict_acks_event_b_id_calendar_events_id_fk" FOREIGN KEY ("event_b_id") REFERENCES "public"."calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conflict_acks_pair_idx" ON "conflict_acks" USING btree ("event_a_id","event_b_id");--> statement-breakpoint
CREATE INDEX "conflict_acks_a_idx" ON "conflict_acks" USING btree ("event_a_id");--> statement-breakpoint
CREATE INDEX "conflict_acks_b_idx" ON "conflict_acks" USING btree ("event_b_id");