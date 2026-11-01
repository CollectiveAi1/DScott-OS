CREATE TYPE "public"."actor" AS ENUM('devon', 'operator', 'automation');--> statement-breakpoint
CREATE TYPE "public"."approval_kind" AS ENUM('email', 'text', 'calendar_write', 'other');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('waiting', 'scheduled', 'sent', 'failed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."arena" AS ENUM('collective', 'basketball', 'family', 'misc');--> statement-breakpoint
CREATE TYPE "public"."calendar_kind" AS ENUM('practice', 's_and_c', 'team_event', 'game', 'travel', 'family', 'deadline', 'other');--> statement-breakpoint
CREATE TYPE "public"."calendar_source" AS ENUM('import', 'google', 'manual');--> statement-breakpoint
CREATE TYPE "public"."delivery_mode" AS ENUM('sandbox', 'live');--> statement-breakpoint
CREATE TYPE "public"."learning_kind" AS ENUM('course', 'book', 'video', 'project');--> statement-breakpoint
CREATE TYPE "public"."learning_status" AS ENUM('queued', 'active', 'done', 'dropped');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('active', 'paused', 'done');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('open', 'done');--> statement-breakpoint
CREATE TYPE "public"."timeline_kind" AS ENUM('note', 'call', 'email', 'meeting', 'stage_move');--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "approval_kind" NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "approval_status" DEFAULT 'waiting' NOT NULL,
	"mode" "delivery_mode",
	"send_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"failure_reason" text,
	"idempotency_key" text NOT NULL,
	"contact_id" uuid,
	"arena" "arena" DEFAULT 'collective' NOT NULL,
	"created_by" "actor" DEFAULT 'devon' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approvals_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "boards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"columns" text[] NOT NULL,
	"arena" "arena",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "boards_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "calendar_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"kind" "calendar_kind" DEFAULT 'other' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"location" text,
	"notes" text,
	"source" "calendar_source" DEFAULT 'manual' NOT NULL,
	"external_id" text,
	"arena" "arena" NOT NULL,
	"created_by" "actor" DEFAULT 'devon' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text,
	"org_id" uuid,
	"email" text,
	"phone" text,
	"types" text[] DEFAULT '{}' NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"arena" "arena" DEFAULT 'collective' NOT NULL,
	"do_not_contact" boolean DEFAULT false NOT NULL,
	"created_by" "actor" DEFAULT 'devon' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"contact_id" uuid,
	"stage" text NOT NULL,
	"value_cents" integer DEFAULT 0 NOT NULL,
	"next_step" text,
	"next_step_due" date,
	"owner" text DEFAULT 'Devon' NOT NULL,
	"arena" "arena" DEFAULT 'collective' NOT NULL,
	"created_by" "actor" DEFAULT 'devon' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skill_id" uuid NOT NULL,
	"title" text NOT NULL,
	"kind" "learning_kind" NOT NULL,
	"status" "learning_status" DEFAULT 'queued' NOT NULL,
	"due" date,
	"url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"site" text,
	"arena" "arena" DEFAULT 'collective' NOT NULL,
	"created_by" "actor" DEFAULT 'devon' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "owner" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"session_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipelines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"stages" text[] NOT NULL,
	"arena" "arena" DEFAULT 'collective' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pipelines_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "practice_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skill_id" uuid NOT NULL,
	"day" date NOT NULL,
	"minutes" integer NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"owner" text DEFAULT 'Devon' NOT NULL,
	"due" date,
	"status" "project_status" DEFAULT 'active' NOT NULL,
	"org_id" uuid,
	"deal_id" uuid,
	"arena" "arena" DEFAULT 'collective' NOT NULL,
	"created_by" "actor" DEFAULT 'devon' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"delivery_mode" "delivery_mode" DEFAULT 'sandbox' NOT NULL,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"protected_time" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"calendar_sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"brand_kit" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"model_routing" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"encrypted_keys" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"current_level" integer DEFAULT 1 NOT NULL,
	"target_level" integer DEFAULT 3 NOT NULL,
	"why" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skills_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"due" date,
	"priority" "priority" DEFAULT 'normal' NOT NULL,
	"status" "task_status" DEFAULT 'open' NOT NULL,
	"board_id" uuid,
	"board_column" text,
	"owner" text DEFAULT 'Devon' NOT NULL,
	"contact_id" uuid,
	"deal_id" uuid,
	"project_id" uuid,
	"arena" "arena" DEFAULT 'misc' NOT NULL,
	"from_misc" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"created_by" "actor" DEFAULT 'devon' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timeline" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" timeline_kind NOT NULL,
	"body" text NOT NULL,
	"contact_id" uuid,
	"deal_id" uuid,
	"created_by" "actor" DEFAULT 'devon' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_items" ADD CONSTRAINT "learning_items_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_log" ADD CONSTRAINT "practice_log_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline" ADD CONSTRAINT "timeline_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline" ADD CONSTRAINT "timeline_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approvals_contact_idx" ON "approvals" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "approvals_status_idx" ON "approvals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "calendar_events_range_idx" ON "calendar_events" USING btree ("starts_at","ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_events_source_external_idx" ON "calendar_events" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "contacts_org_idx" ON "contacts" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "contacts_arena_idx" ON "contacts" USING btree ("arena");--> statement-breakpoint
CREATE INDEX "deals_pipeline_idx" ON "deals" USING btree ("pipeline_id");--> statement-breakpoint
CREATE INDEX "deals_contact_idx" ON "deals" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "learning_items_skill_idx" ON "learning_items" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "practice_log_skill_day_idx" ON "practice_log" USING btree ("skill_id","day");--> statement-breakpoint
CREATE INDEX "projects_org_idx" ON "projects" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "projects_deal_idx" ON "projects" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "tasks_board_idx" ON "tasks" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "tasks_contact_idx" ON "tasks" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "tasks_deal_idx" ON "tasks" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "tasks_project_idx" ON "tasks" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "tasks_open_due_idx" ON "tasks" USING btree ("status","due");--> statement-breakpoint
CREATE INDEX "timeline_contact_idx" ON "timeline" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "timeline_deal_idx" ON "timeline" USING btree ("deal_id");