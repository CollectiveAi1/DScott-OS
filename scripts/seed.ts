import { boards, pipelines, settings } from "../src/db/schema";
import { getHandle } from "../src/db/client";

// Starter structure from Blueprint v0.1. Safe to run more than once: existing rows are left alone.
const BOARD_COLUMNS = ["To do", "Doing", "Waiting on others", "Done"];

const STARTER_BOARDS = [
  { name: "This week", arena: null },
  { name: "Collective AI", arena: "collective" as const },
  { name: "Family", arena: "family" as const },
  { name: "Misc", arena: "misc" as const },
];

// Draft stages; Devon renames them in the app.
const STARTER_PIPELINES = [
  { name: "Kinetic Scholar", stages: ["Target", "Intro", "Demo", "Pilot proposal", "Pilot signed", "Paid", "Lost"] },
  { name: "Client builds", stages: ["Lead", "Scope call", "Quote sent", "Deposit", "Building", "Delivered", "Lost"] },
  { name: "Civic Sports", stages: ["Inquiry", "Family call", "Plan sent", "Enrolled", "Active", "Closed"] },
  { name: "Investors", stages: ["Researched", "Warm intro", "First meeting", "Diligence", "Committed", "Passed"] },
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
    .values(STARTER_BOARDS.map((board) => ({ ...board, columns: BOARD_COLUMNS })))
    .onConflictDoNothing();

  await db
    .insert(pipelines)
    .values(STARTER_PIPELINES.map((pipeline) => ({ ...pipeline, arena: "collective" as const })))
    .onConflictDoNothing();

  console.info("Seed complete.");
} catch (error) {
  console.error("Seed failed:", error);
  process.exitCode = 1;
} finally {
  await handle.close();
}
