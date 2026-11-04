CREATE TYPE "public"."digest_kind" AS ENUM('daily_brief', 'learning_review');--> statement-breakpoint
CREATE TYPE "public"."digest_source" AS ENUM('offline', 'model');--> statement-breakpoint
CREATE TABLE "digests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "digest_kind" NOT NULL,
	"day" date NOT NULL,
	"body" text NOT NULL,
	"source" "digest_source" DEFAULT 'offline' NOT NULL,
	"data" jsonb,
	"created_by" "actor" DEFAULT 'devon' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "digests_kind_day_idx" ON "digests" USING btree ("kind","day");--> statement-breakpoint
CREATE INDEX "digests_kind_idx" ON "digests" USING btree ("kind","day" DESC NULLS LAST);