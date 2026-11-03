"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { changePasswordAction, type FormState } from "@/lib/auth/actions";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password-rules";
import {
  addProtectedBlockAction,
  removeProtectedBlockAction,
  setDeliveryModeAction,
  setTimezoneAction,
} from "@/lib/settings-actions";
import { describeDays, MAX_PROTECTED_BLOCKS, WEEKDAYS } from "@/lib/settings-rules";
import type { ProtectedBlock } from "@/db/schema";
import { Field, FormMessage, QuietButton, Select, SubmitButton } from "@/components/form";

const initial: FormState = {};

export function DeliveryModeForm({ mode }: { mode: "sandbox" | "live" }) {
  const [state, action] = useActionState(setDeliveryModeAction, initial);
  const target = mode === "sandbox" ? "live" : "sandbox";
  return (
    <form action={action} className="mt-4 space-y-3">
      <input type="hidden" name="mode" value={target} />
      {target === "live" ? (
        <Field
          label="Type LIVE to confirm"
          name="confirm"
          autoComplete="off"
          hint="Connect email and text first. Live delivery is the one switch that reaches real people."
        />
      ) : null}
      <FormMessage state={state} />
      <div className="max-w-48">
        <SubmitButton pendingLabel="Switching…">{target === "live" ? "Go live" : "Switch to sandbox"}</SubmitButton>
      </div>
    </form>
  );
}

export function TimezoneForm({ timezone, zones }: { timezone: string; zones: string[] }) {
  const [state, action] = useActionState(setTimezoneAction, initial);
  return (
    <form action={action} className="mt-4 space-y-3">
      <Select
        // Remount on the saved value: React's post-action form reset would otherwise leave the
        // select showing the old zone even though the new one is what was written.
        key={timezone}
        label="Time zone"
        name="timezone"
        options={zones}
        defaultValue={timezone}
        hint="Used for today, due dates, protected time and every scheduled job."
      />
      <FormMessage state={state} />
      <div className="max-w-48">
        <SubmitButton pendingLabel="Saving…">Save time zone</SubmitButton>
      </div>
    </form>
  );
}

function RemoveBlockForm({ index, label }: { index: number; label: string }) {
  const [state, action] = useActionState(removeProtectedBlockAction, initial);
  return (
    <form action={action} className="flex items-center gap-3">
      <input type="hidden" name="index" value={index} />
      <QuietButton pendingLabel="Removing…">
        <span aria-hidden="true">Remove</span>
        <span className="sr-only">Remove {label}</span>
      </QuietButton>
      <FormMessage state={state} />
    </form>
  );
}

export function ProtectedTimeForm({ blocks }: { blocks: ProtectedBlock[] }) {
  const [state, action] = useActionState(addProtectedBlockAction, initial);
  const full = blocks.length >= MAX_PROTECTED_BLOCKS;

  // Controlled on purpose: React clears an uncontrolled form once its action settles, so a
  // rejected block would take Devon's label, days and times with it.
  const [label, setLabel] = useState("");
  const [days, setDays] = useState<number[]>([]);
  const [start, setStart] = useState("18:00");
  const [end, setEnd] = useState("19:30");
  const toggleDay = (day: number) =>
    setDays((current) => (current.includes(day) ? current.filter((d) => d !== day) : [...current, day]));

  // Clear the form once a block is actually saved, so the next one starts empty. The action
  // returns a new state object per submit, so identity is a reliable "this is new" signal.
  const handled = useRef<FormState | null>(null);
  // React's form reset also clears the day checkboxes in the DOM, and since its own tree still
  // says checked there is no diff to put them back. Remounting them re-applies `days`.
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (state === handled.current) return;
    handled.current = state;
    setRound((current) => current + 1);
    if (!state.ok) return;
    setLabel("");
    setDays([]);
    setStart("18:00");
    setEnd("19:30");
  }, [state]);

  return (
    <div className="mt-4 space-y-6">
      {blocks.length === 0 ? (
        <p className="text-sm text-muted">
          No protected time yet. Blocks you add here are times the Operator will never book over.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {blocks.map((block, index) => (
            <li key={`${block.label}-${index}`} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="text-sm text-ink">{block.label}</p>
                <p className="font-mono text-xs text-muted">
                  {describeDays(block.days)} · {block.start}–{block.end}
                </p>
              </div>
              <RemoveBlockForm index={index} label={block.label} />
            </li>
          ))}
        </ul>
      )}

      {full ? (
        <p className="text-sm text-muted">
          {MAX_PROTECTED_BLOCKS} blocks is the limit. Remove one to add another.
        </p>
      ) : (
        <form action={action} className="space-y-4 border-t border-line pt-5">
          <Field label="Label" name="label" autoComplete="off" value={label} onChange={setLabel} />
          <fieldset>
            <legend className="mb-1.5 text-sm text-muted">Days</legend>
            <div className="flex flex-wrap gap-3">
              {WEEKDAYS.map((day) => (
                <label key={`${day.value}-${round}`} className="flex items-center gap-1.5 text-sm text-ink">
                  <input
                    type="checkbox"
                    name="days"
                    value={day.value}
                    checked={days.includes(day.value)}
                    onChange={() => toggleDay(day.value)}
                    className="accent-[--color-accent]"
                  />
                  <span aria-hidden="true">{day.short}</span>
                  <span className="sr-only">{day.long}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Start" name="start" type="time" value={start} onChange={setStart} />
            <Field label="End" name="end" type="time" value={end} onChange={setEnd} />
          </div>
          <FormMessage state={state} />
          <div className="max-w-48">
            <SubmitButton pendingLabel="Adding…">Add block</SubmitButton>
          </div>
        </form>
      )}
    </div>
  );
}

export function PasswordForm() {
  const [state, action] = useActionState(changePasswordAction, initial);
  return (
    <form action={action} className="mt-4 space-y-4">
      <Field label="Current password" name="current" type="password" autoComplete="current-password" />
      <Field
        label="New password"
        name="next"
        type="password"
        autoComplete="new-password"
        minLength={MIN_PASSWORD_LENGTH}
        hint="Changing it signs out every other device."
      />
      <FormMessage state={state} />
      <div className="max-w-48">
        <SubmitButton pendingLabel="Saving…">Change password</SubmitButton>
      </div>
    </form>
  );
}
