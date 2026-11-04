import { and, eq, sql } from "drizzle-orm";
import { boards, pipelines, settings } from "../src/db/schema";
import { getHandle } from "../src/db/client";

// Starter structure from Blueprint v0.1. Safe to run more than once: existing rows are left alone.
const BOARD_COLUMNS = ["To do", "Doing", "Waiting on others", "Done"];

// Listed in the order they appear in Work. "This week" is the daily board, so it comes first.
const STARTER_BOARDS = [
  { name: "This week", arena: null },
  { name: "Collective AI", arena: "collective" as const },
  { name: "Family", arena: "family" as const },
  { name: "Misc", arena: "misc" as const },
];

// Draft stages; Devon renames them in Settings. billingStages are the stages that hand the
// deal to Ahmad for an invoice when it arrives there.
const STARTER_PIPELINES = [
  {
    name: "Kinetic Scholar",
    stages: ["Target", "Intro", "Demo", "Pilot proposal", "Pilot signed", "Paid", "Lost"],
    billingStages: ["Pilot signed", "Paid"],
  },
  {
    name: "Client builds",
    stages: ["Lead", "Scope call", "Quote sent", "Deposit", "Building", "Delivered", "Lost"],
    billingStages: ["Deposit"],
  },
  {
    name: "Civic Sports",
    stages: ["Inquiry", "Family call", "Plan sent", "Enrolled", "Active", "Closed"],
    billingStages: ["Enrolled"],
  },
  {
    name: "Investors",
    stages: ["Researched", "Warm intro", "First meeting", "Diligence", "Committed", "Passed"],
    billingStages: [],
  },
];

const handle = getHandle();
const db = handle.db;

try {
  await db
    .insert(settings)
    .values({ id: 1, deliveryMode: "sandbox", timezone: process.env.OS_TIMEZONE ?? "America/New_York" })
    .onConflictDoNothing();

  await db
    .insert(boards)
    .values(STARTER_BOARDS.map((board, position) => ({ ...board, position, columns: BOARD_COLUMNS })))
    .onConflictDoNothing();

  await db
    .insert(pipelines)
    .values(STARTER_PIPELINES.map((pipeline) => ({ ...pipeline, arena: "collective" as const })))
    .onConflictDoNothing();

  // Backfill, not overwrite. A pipeline seeded before billingStages existed carries an empty
  // array, which silently means "no billing handoff will ever fire". Fill those in, and leave
  // alone any Devon has since configured in Settings.
  for (const pipeline of STARTER_PIPELINES) {
    await db
      .update(pipelines)
      .set({ billingStages: pipeline.billingStages })
      .where(and(eq(pipelines.name, pipeline.name), sql`cardinality(${pipelines.billingStages}) = 0`));
  }

  console.info("Seed complete.");
} catch (error) {
  console.error("Seed failed:", error);
  process.exitCode = 1;
} finally {
  await handle.close();
}
