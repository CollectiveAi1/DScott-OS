"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { Field, FormMessage, Select, Textarea } from "@/components/form";
import type { FormState } from "@/lib/auth/actions";
import { createEventAction, deleteEventAction, updateEventAction } from "../actions";
import { defaultsAllDay, isReadOnlySource, kindsForArena, SOURCE_LABEL, type EventArena, type EventKind } from "../kinds";

const initial: FormState = {};

const ARENAS = [
  { value: "collective", label: "Collective AI" },
  { value: "basketball", label: "Basketball" },
  { value: "family", label: "Family" },
  { value: "misc", label: "Misc" },
];

export type EventFormValues = {
  id?: string;
  title: string;
  arena: EventArena;
  kind: EventKind;
  allDay: boolean;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  location: string;
  notes: string;
  source: string;
};

function DateTimeField({
  label,
  name,
  value,
  onChange,
  type,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (next: string) => void;
  type: "date" | "time";
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm text-muted">{label}</span>
      <input
        type={type}
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-[--radius-control] border border-line-strong bg-base px-3 py-2.5 text-ink focus:border-accent focus:outline-none"
      />
    </label>
  );
}

/** Two presses to delete, as everywhere else in the OS. */
function DeleteEvent({ id }: { id: string }) {
  const [state, action, pending] = useActionState(deleteEventAction, initial);
  const [armed, setArmed] = useState(false);
  return (
    <form action={action} onSubmit={() => setArmed(true)} className="flex items-center gap-3">
      <input type="hidden" name="id" value={id} />
      {armed ? <input type="hidden" name="confirm" value="yes" /> : null}
      <button
        type="submit"
        disabled={pending}
        className={`rounded-[--radius-control] border px-3 py-2 text-sm disabled:opacity-60 ${
          armed ? "border-danger text-danger" : "border-line-strong text-muted hover:border-danger hover:text-danger"
        }`}
      >
        {armed ? "Really delete?" : "Delete event"}
      </button>
      {armed ? <FormMessage state={state} /> : null}
    </form>
  );
}

export function EventForm({
  values,
  fromTaskId,
  captureTitle,
}: {
  values: EventFormValues;
  fromTaskId?: string;
  captureTitle?: string;
}) {
  const editing = Boolean(values.id);
  const [state, action, pending] = useActionState(editing ? updateEventAction : createEventAction, initial);

  // Controlled throughout: React clears an uncontrolled form once its action settles, and a
  // refusal must not make Devon retype an event.
  const [title, setTitle] = useState(values.title);
  const [arena, setArena] = useState<EventArena>(values.arena);
  const [kind, setKind] = useState<EventKind>(values.kind);
  const [allDay, setAllDay] = useState(values.allDay);
  const [startDate, setStartDate] = useState(values.startDate);
  const [startTime, setStartTime] = useState(values.startTime);
  const [endDate, setEndDate] = useState(values.endDate);
  const [endTime, setEndTime] = useState(values.endTime);
  const [location, setLocation] = useState(values.location);
  const [notes, setNotes] = useState(values.notes);

  // React clears a form once its action settles. Text inputs pick their value back up from
  // state, but a <select> or a checkbox does not: React's own tree still holds the value it had,
  // so there is no diff to re-apply and the control silently shows something else. Remounting
  // those on every settled submit re-applies the state. Third time this has bitten — see the
  // M1 and M2 build-log entries.
  const settled = useRef<FormState | null>(null);
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (state === settled.current) return;
    settled.current = state;
    setRound((current) => current + 1);
  }, [state]);

  const readOnly = isReadOnlySource(values.source);
  const kinds = kindsForArena(arena);

  const changeArena = (next: string) => {
    const nextArena = next as EventArena;
    setArena(nextArena);
    // Kinds follow the arena, so keep the selection valid rather than letting the service refuse it.
    const allowed = kindsForArena(nextArena);
    if (!allowed.some((option) => option.value === kind)) setKind(allowed[0]!.value);
  };

  const changeKind = (next: string) => {
    const nextKind = next as EventKind;
    setKind(nextKind);
    // Travel is a journey, not an appointment: departure through return.
    if (defaultsAllDay(nextKind) && !allDay) {
      setAllDay(true);
      setEndDate((current) => current || startDate);
    }
  };

  return (
    <div className="space-y-6">
      {readOnly ? (
        <p className="rounded-[--radius-panel] border border-line bg-surface px-4 py-3 text-sm text-muted">
          {SOURCE_LABEL[values.source]}. Only notes can be changed here — everything else is kept in step with
          the source.
        </p>
      ) : null}

      {fromTaskId ? (
        <p className="rounded-[--radius-panel] border border-line bg-surface px-4 py-3 text-sm text-muted">
          From your Misc inbox: “{captureTitle}”. Saving this event clears that capture.
        </p>
      ) : null}

      <form action={action} className="space-y-5">
        {values.id ? <input type="hidden" name="id" value={values.id} /> : null}
        {fromTaskId ? <input type="hidden" name="fromTaskId" value={fromTaskId} /> : null}

        <fieldset disabled={readOnly} className="space-y-5 disabled:opacity-60">
          <Field label="Title" name="title" value={title} onChange={setTitle} autoComplete="off" />

          <div className="grid gap-4 sm:grid-cols-2">
            <Select key={`arena-${round}`} label="Arena" name="arena" options={ARENAS} value={arena} onChange={changeArena} />
            <Select key={`kind-${round}`} label="Kind" name="kind" options={kinds} value={kind} onChange={changeKind} />
          </div>

          <label key={`allday-${round}`} className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              name="allDay"
              checked={allDay}
              onChange={(event) => setAllDay(event.target.checked)}
              className="accent-[--color-accent]"
            />
            All day
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <DateTimeField label="Starts" name="startDate" type="date" value={startDate} onChange={setStartDate} />
            {allDay ? null : (
              <DateTimeField label="Start time" name="startTime" type="time" value={startTime} onChange={setStartTime} />
            )}
            <DateTimeField label={allDay ? "Through" : "Ends"} name="endDate" type="date" value={endDate} onChange={setEndDate} />
            {allDay ? null : (
              <DateTimeField label="End time" name="endTime" type="time" value={endTime} onChange={setEndTime} />
            )}
          </div>
          {allDay ? (
            <p className="text-xs text-muted">All-day events run through the end of the “through” date.</p>
          ) : null}

          <Field label="Location" name="location" value={location} onChange={setLocation} required={false} autoComplete="off" />
        </fieldset>

        <Textarea label="Notes" name="notes" value={notes} onChange={setNotes} rows={3} />

        <FormMessage state={state} />

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded-[--radius-control] bg-accent px-4 py-2.5 font-semibold text-accent-ink disabled:opacity-60"
          >
            {pending ? "Saving…" : editing ? "Save event" : "Add event"}
          </button>
          <Link href="/schedule" className="text-sm text-muted underline hover:text-ink">
            Back to Schedule
          </Link>
        </div>
      </form>

      {editing && !readOnly ? <DeleteEvent id={values.id!} /> : null}
    </div>
  );
}
