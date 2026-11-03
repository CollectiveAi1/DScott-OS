"use client";

import { useFormStatus } from "react-dom";

export function Field({
  label,
  name,
  type = "text",
  autoComplete,
  required = true,
  minLength,
  defaultValue,
  value,
  onChange,
  hint,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  defaultValue?: string;
  /** Pass value + onChange to control the field. React 19 clears uncontrolled fields when a
   *  form action finishes, which would throw away what Devon typed on a rejected submit. */
  value?: string;
  onChange?: (next: string) => void;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm text-muted">{label}</span>
      <input
        name={name}
        type={type}
        autoComplete={autoComplete}
        required={required}
        minLength={minLength}
        {...(value === undefined
          ? { defaultValue }
          : { value, onChange: (event) => onChange?.(event.target.value) })}
        className="w-full rounded-[--radius-control] border border-line-strong bg-base px-3 py-2.5 text-ink placeholder:text-muted focus:border-accent focus:outline-none"
      />
      {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export type SelectOption = string | { value: string; label: string };

export function Select({
  label,
  name,
  options,
  defaultValue,
  value,
  onChange,
  hint,
  compact = false,
}: {
  label: string;
  name: string;
  options: readonly SelectOption[];
  defaultValue?: string;
  value?: string;
  onChange?: (next: string) => void;
  hint?: string;
  /** Inline in a filter bar: a small label above a short control. */
  compact?: boolean;
}) {
  return (
    <label className="block">
      <span className={`mb-1.5 block text-muted ${compact ? "text-xs" : "text-sm"}`}>{label}</span>
      <select
        name={name}
        {...(value === undefined
          ? { defaultValue }
          : { value, onChange: (event) => onChange?.(event.target.value) })}
        className={`w-full rounded-[--radius-control] border border-line-strong bg-base text-ink focus:border-accent focus:outline-none ${
          compact ? "px-2 py-1.5 text-sm" : "px-3 py-2.5"
        }`}
      >
        {options.map((option) => {
          const item = typeof option === "string" ? { value: option, label: option } : option;
          return (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          );
        })}
      </select>
      {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function Textarea({
  label,
  name,
  rows = 4,
  value,
  onChange,
  defaultValue,
  hint,
}: {
  label: string;
  name: string;
  rows?: number;
  value?: string;
  onChange?: (next: string) => void;
  defaultValue?: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm text-muted">{label}</span>
      <textarea
        name={name}
        rows={rows}
        {...(value === undefined
          ? { defaultValue }
          : { value, onChange: (event) => onChange?.(event.target.value) })}
        className="w-full rounded-[--radius-control] border border-line-strong bg-base px-3 py-2.5 text-ink placeholder:text-muted focus:border-accent focus:outline-none"
      />
      {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function SubmitButton({ children, pendingLabel }: { children: React.ReactNode; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-[--radius-control] bg-accent px-4 py-2.5 font-semibold text-accent-ink transition-opacity disabled:opacity-60"
    >
      {pending ? pendingLabel : children}
    </button>
  );
}

/** Secondary action inside a row: a real button, no accent fill. */
export function QuietButton({ children, pendingLabel }: { children: React.ReactNode; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-[--radius-control] border border-line-strong px-3 py-1.5 text-sm text-muted transition-colors hover:border-danger hover:text-danger disabled:opacity-60"
    >
      {pending ? pendingLabel : children}
    </button>
  );
}

export function FormMessage({ state }: { state: { error?: string; ok?: string } }) {
  if (state.error) {
    return (
      <p role="alert" className="text-sm text-danger">
        {state.error}
      </p>
    );
  }
  if (state.ok) {
    return (
      <p role="status" className="text-sm text-accent">
        {state.ok}
      </p>
    );
  }
  return null;
}
