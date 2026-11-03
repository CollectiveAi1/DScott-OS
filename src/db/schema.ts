import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const arenaEnum = pgEnum("arena", ["collective", "basketball", "family", "misc"]);
export const actorEnum = pgEnum("actor", ["devon", "operator", "automation"]);
export const priorityEnum = pgEnum("priority", ["low", "normal", "high", "urgent"]);
export const taskStatusEnum = pgEnum("task_status", ["open", "done"]);
export const projectStatusEnum = pgEnum("project_status", ["active", "paused", "done"]);
export const calendarKindEnum = pgEnum("calendar_kind", [
  "practice",
  "s_and_c",
  "team_event",
  "game",
  "travel",
  "family",
  "deadline",
  "other",
]);
export const calendarSourceEnum = pgEnum("calendar_source", ["import", "google", "manual"]);
export const learningKindEnum = pgEnum("learning_kind", ["course", "book", "video", "project"]);
export const learningStatusEnum = pgEnum("learning_status", ["queued", "active", "done", "dropped"]);
export const timelineKindEnum = pgEnum("timeline_kind", ["note", "call", "email", "meeting", "stage_move"]);
export const approvalKindEnum = pgEnum("approval_kind", ["email", "text", "calendar_write", "other"]);
export const approvalStatusEnum = pgEnum("approval_status", [
  "waiting",
  "scheduled",
  "sent",
  "failed",
  "rejected",
]);
export const deliveryModeEnum = pgEnum("delivery_mode", ["sandbox", "live"]);
export const jobStatusEnum = pgEnum("job_status", ["ok", "error", "skipped"]);

// Shared columns. Every row records who made it and when.
const stamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};
const origin = { createdBy: actorEnum("created_by").notNull().default("devon") };

// ---------------------------------------------------------------------------
// Owner (single account) and settings (single row)
// ---------------------------------------------------------------------------

export const owner = pgTable("owner", {
  id: integer("id").primaryKey().default(1),
  name: text("name").notNull(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  // Bumped on password change so every older session cookie stops working.
  sessionVersion: integer("session_version").notNull().default(1),
  ...stamps,
});

export const settings = pgTable("settings", {
  id: integer("id").primaryKey().default(1),
  deliveryMode: deliveryModeEnum("delivery_mode").notNull().default("sandbox"),
  timezone: text("timezone").notNull().default("America/New_York"),
  // [{ label, days: [1-7, Monday = 1], start: "HH:MM", end: "HH:MM" }]
  protectedTime: jsonb("protected_time").$type<ProtectedBlock[]>().notNull().default([]),
  // [{ provider: "google", calendarId, arena }]
  calendarSources: jsonb("calendar_sources").$type<CalendarSource[]>().notNull().default([]),
  brandKit: jsonb("brand_kit").$type<Record<string, string>>().notNull().default({}),
  // { chat: ["claude", ...], draft: [...], summarise: [...], numbers: [...] }
  modelRouting: jsonb("model_routing").$type<Record<string, string[]>>().notNull().default({}),
  // AES-256-GCM ciphertexts keyed by connection name. Never sent to the browser.
  encryptedKeys: jsonb("encrypted_keys").$type<Record<string, string>>().notNull().default({}),
  ...stamps,
});

export type ProtectedBlock = { label: string; days: number[]; start: string; end: string };
export type CalendarSource = { provider: "google"; calendarId: string; arena: "family" };

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export const orgs = pgTable("orgs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  site: text("site"),
  arena: arenaEnum("arena").notNull().default("collective"),
  ...origin,
  ...stamps,
});

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name"),
    orgId: uuid("org_id").references(() => orgs.id, { onDelete: "set null" }),
    email: text("email"),
    phone: text("phone"),
    types: text("types").array().notNull().default([]),
    tags: text("tags").array().notNull().default([]),
    arena: arenaEnum("arena").notNull().default("collective"),
    doNotContact: boolean("do_not_contact").notNull().default(false),
    ...origin,
    ...stamps,
  },
  (t) => [index("contacts_org_idx").on(t.orgId), index("contacts_arena_idx").on(t.arena)],
);

// ---------------------------------------------------------------------------
// Pipelines and deals (Collective AI arena)
// ---------------------------------------------------------------------------

export const pipelines = pgTable("pipelines", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  stages: text("stages").array().notNull(),
  arena: arenaEnum("arena").notNull().default("collective"),
  ...stamps,
});

export const deals = pgTable(
  "deals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    pipelineId: uuid("pipeline_id")
      .notNull()
      .references(() => pipelines.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    stage: text("stage").notNull(),
    // Money is integer cents, never a float.
    valueCents: integer("value_cents").notNull().default(0),
    nextStep: text("next_step"),
    nextStepDue: date("next_step_due"),
    owner: text("owner").notNull().default("Devon"),
    arena: arenaEnum("arena").notNull().default("collective"),
    ...origin,
    ...stamps,
  },
  (t) => [index("deals_pipeline_idx").on(t.pipelineId), index("deals_contact_idx").on(t.contactId)],
);

// ---------------------------------------------------------------------------
// Work
// ---------------------------------------------------------------------------

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    owner: text("owner").notNull().default("Devon"),
    due: date("due"),
    status: projectStatusEnum("status").notNull().default("active"),
    orgId: uuid("org_id").references(() => orgs.id, { onDelete: "set null" }),
    dealId: uuid("deal_id").references(() => deals.id, { onDelete: "set null" }),
    arena: arenaEnum("arena").notNull().default("collective"),
    ...origin,
    ...stamps,
  },
  (t) => [index("projects_org_idx").on(t.orgId), index("projects_deal_idx").on(t.dealId)],
);

export const boards = pgTable("boards", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  columns: text("columns").array().notNull(),
  // Display order. Board order is a property of the data, not of the alphabet: Work opens on
  // the first one, and that should be the daily board.
  position: integer("position").notNull().default(0),
  arena: arenaEnum("arena"),
  ...stamps,
});

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    notes: text("notes"),
    due: date("due"),
    priority: priorityEnum("priority").notNull().default("normal"),
    status: taskStatusEnum("status").notNull().default("open"),
    boardId: uuid("board_id").references(() => boards.id, { onDelete: "set null" }),
    boardColumn: text("board_column"),
    owner: text("owner").notNull().default("Devon"),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    dealId: uuid("deal_id").references(() => deals.id, { onDelete: "set null" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    arena: arenaEnum("arena").notNull().default("misc"),
    // True while a quick capture sits untriaged in the Misc inbox.
    fromMisc: boolean("from_misc").notNull().default(false),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...origin,
    ...stamps,
  },
  (t) => [
    index("tasks_board_idx").on(t.boardId),
    index("tasks_contact_idx").on(t.contactId),
    index("tasks_deal_idx").on(t.dealId),
    index("tasks_project_idx").on(t.projectId),
    index("tasks_open_due_idx").on(t.status, t.due),
    // The Misc inbox: untriaged captures, oldest first.
    index("tasks_misc_idx").on(t.fromMisc, t.createdAt),
    // The most common pair of Work filters.
    index("tasks_arena_status_idx").on(t.arena, t.status),
  ],
);

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

export const calendarEvents = pgTable(
  "calendar_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    kind: calendarKindEnum("kind").notNull().default("other"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    allDay: boolean("all_day").notNull().default(false),
    location: text("location"),
    notes: text("notes"),
    source: calendarSourceEnum("source").notNull().default("manual"),
    // Stable id from the import or the Google event, so re-syncs update instead of duplicating.
    externalId: text("external_id"),
    arena: arenaEnum("arena").notNull(),
    ...origin,
    ...stamps,
  },
  (t) => [
    index("calendar_events_range_idx").on(t.startsAt, t.endsAt),
    uniqueIndex("calendar_events_source_external_idx").on(t.source, t.externalId),
  ],
);

/**
 * A conflicting pair Devon has seen and accepted. The pair is stored in canonical order — the
 * smaller id is always event_a_id — so the unique index holds one row per pair however he
 * reached it. Editing either event's time deletes its acks, bringing the conflict back.
 */
export const conflictAcks = pgTable(
  "conflict_acks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventAId: uuid("event_a_id")
      .notNull()
      .references(() => calendarEvents.id, { onDelete: "cascade" }),
    eventBId: uuid("event_b_id")
      .notNull()
      .references(() => calendarEvents.id, { onDelete: "cascade" }),
    ...stamps,
  },
  (t) => [
    uniqueIndex("conflict_acks_pair_idx").on(t.eventAId, t.eventBId),
    index("conflict_acks_a_idx").on(t.eventAId),
    index("conflict_acks_b_idx").on(t.eventBId),
  ],
);

// ---------------------------------------------------------------------------
// Learning (Collective AI arena, personal)
// ---------------------------------------------------------------------------

export const skills = pgTable("skills", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  currentLevel: integer("current_level").notNull().default(1),
  targetLevel: integer("target_level").notNull().default(3),
  why: text("why"),
  ...stamps,
});

export const learningItems = pgTable(
  "learning_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    kind: learningKindEnum("kind").notNull(),
    status: learningStatusEnum("status").notNull().default("queued"),
    due: date("due"),
    url: text("url"),
    ...stamps,
  },
  (t) => [index("learning_items_skill_idx").on(t.skillId)],
);

export const practiceLog = pgTable(
  "practice_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    minutes: integer("minutes").notNull(),
    note: text("note"),
    ...stamps,
  },
  (t) => [index("practice_log_skill_day_idx").on(t.skillId, t.day)],
);

// ---------------------------------------------------------------------------
// History and the approvals gate
// ---------------------------------------------------------------------------

export const timeline = pgTable(
  "timeline",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: timelineKindEnum("kind").notNull(),
    body: text("body").notNull(),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
    dealId: uuid("deal_id").references(() => deals.id, { onDelete: "cascade" }),
    ...origin,
    ...stamps,
  },
  (t) => [index("timeline_contact_idx").on(t.contactId), index("timeline_deal_idx").on(t.dealId)],
);

export const approvals = pgTable(
  "approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: approvalKindEnum("kind").notNull(),
    // What will be sent, exactly as Devon will see and edit it.
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: approvalStatusEnum("status").notNull().default("waiting"),
    // The mode in force when Devon decided; a sandbox approval is never delivered.
    mode: deliveryModeEnum("mode"),
    sendAt: timestamp("send_at", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    failureReason: text("failure_reason"),
    // Guards against a double send if a retry or a double click lands twice.
    idempotencyKey: text("idempotency_key").notNull().unique(),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    arena: arenaEnum("arena").notNull().default("collective"),
    ...origin,
    ...stamps,
  },
  (t) => [index("approvals_contact_idx").on(t.contactId), index("approvals_status_idx").on(t.status)],
);

// ---------------------------------------------------------------------------
// Scheduled jobs
// ---------------------------------------------------------------------------

export const jobRuns = pgTable(
  "job_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    job: text("job").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }).notNull(),
    status: jobStatusEnum("status").notNull(),
    // One line, written for Devon: what happened or why nothing did.
    detail: text("detail"),
    ...stamps,
  },
  // The only read shape: the last N runs of one job, newest first.
  (t) => [index("job_runs_job_started_idx").on(t.job, t.startedAt.desc())],
);
