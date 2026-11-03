import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { requireOwner } from "@/lib/auth/session";
import { addDays } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { instantToZonedParts } from "@/lib/zoned";
import { EventForm } from "@/modules/schedule/components/event-form";
import { eventById } from "@/modules/schedule/queries";
import type { EventArena, EventKind } from "@/modules/schedule/kinds";

export const metadata: Metadata = { title: "Event" };

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOwner();
  const { timezone } = await getSettings();
  const { id } = await params;

  const event = await eventById(getDb(), id);
  if (!event) notFound();

  const start = instantToZonedParts(event.startsAt, timezone);
  const end = instantToZonedParts(event.endsAt, timezone);
  // Storage keeps an exclusive end for all-day events; the form shows the inclusive last day.
  const endDate = event.allDay ? addDays(end.date, -1) : end.date;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-2 text-3xl font-semibold">Event</h1>
      {event.externalUrl ? (
        <p className="mb-6 text-sm text-muted">
          <a
            href={event.externalUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="underline hover:text-ink"
          >
            Open where it is owned
          </a>{" "}
          to change anything but the notes.
        </p>
      ) : null}
      <EventForm
        values={{
          id: event.id,
          title: event.title,
          arena: event.arena as EventArena,
          kind: event.kind as EventKind,
          allDay: event.allDay,
          startDate: start.date,
          startTime: start.time,
          endDate,
          endTime: end.time,
          location: event.location ?? "",
          notes: event.notes ?? "",
          source: event.source,
        }}
      />
    </div>
  );
}
