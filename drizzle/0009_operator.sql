CREATE TYPE "public"."operator_role" AS ENUM('user', 'assistant', 'tool');--> statement-breakpoint
CREATE TYPE "public"."tool_status" AS ENUM('ok', 'error');--> statement-breakpoint
CREATE TABLE "operator_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"role" "operator_role" NOT NULL,
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tool_name" text,
	"tool_status" "tool_status",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "operator_messages" ADD CONSTRAINT "operator_messages_thread_id_operator_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."operator_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operator_messages_thread_idx" ON "operator_messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "operator_messages_created_idx" ON "operator_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "operator_threads_updated_idx" ON "operator_threads" USING btree ("updated_at" DESC NULLS LAST);