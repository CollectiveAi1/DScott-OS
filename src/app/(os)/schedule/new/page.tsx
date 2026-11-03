import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { tasks } from "@/db/schema";
import { requireOwner } from "@/lib/auth/session";
import { dateInZone } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { EventForm } from "@/modules/schedule/components/event-form";

export const metadata: Metadata = { title: "New event" };

function one(params: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

export default async function NewEventPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOwner();
  const { timezone } = await getSettings();
  const params = await searchParams;

  const date = one(params, "date");
  const startDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : dateInZone(new Date(), timezone);

  // Prefilled from a Misc capture: the capture is completed when the event saves.
  const fromTaskId = one(params, "from");
  const capture = fromTaskId
    ? (await getDb().select({ title: tasks.title }).from(tasks).where(eq(tasks.id, fromTaskId)).limit(1))[0]
    : undefined;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-3xl font-semibold">New event</h1>
      <EventForm
        values={{
          title: one(params, "title") ?? capture?.title ?? "",
          arena: "collective",
          kind: "other",
          allDay: false,
          startDate,
          startTime: "09:00",
          endDate: startDate,
          endTime: "10:00",
          location: "",
          notes: "",
          source: "manual",
        }}
        fromTaskId={capture ? fromTaskId : undefined}
        captureTitle={capture?.title}
      />
    </div>
  );
}
