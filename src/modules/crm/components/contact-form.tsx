"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import type { FormState } from "@/lib/auth/actions";
import { createContactAction, deleteContactAction, updateContactAction } from "../actions";
import { CONTACT_TYPES } from "../service";

const initial: FormState = {};

export type ContactValues = {
  id?: string;
  firstName: string;
  lastName: string;
  orgName: string;
  email: string;
  phone: string;
  types: string[];
  tags: string[];
  doNotContact: boolean;
};

function DeleteContact({ id }: { id: string }) {
  const [state, action, pending] = useActionState(deleteContactAction, initial);
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
        {armed ? "Really delete this contact?" : "Delete contact"}
      </button>
      {armed ? <FormMessage state={state} /> : null}
    </form>
  );
}

export function ContactForm({ values }: { values: ContactValues }) {
  const editing = Boolean(values.id);
  const [state, action] = useActionState(editing ? updateContactAction : createContactAction, initial);

  const [firstName, setFirstName] = useState(values.firstName);
  const [lastName, setLastName] = useState(values.lastName);
  const [orgName, setOrgName] = useState(values.orgName);
  const [email, setEmail] = useState(values.email);
  const [phone, setPhone] = useState(values.phone);
  const [tags, setTags] = useState(values.tags.join(", "));
  const [types, setTypes] = useState<string[]>(values.types);
  const [doNotContact, setDoNotContact] = useState(values.doNotContact);

  // Checkboxes cannot be diffed back into place after React clears a settled form, so they are
  // remounted on every submit. The rule from M1–M3.
  const settled = useRef<FormState | null>(null);
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (state === settled.current) return;
    settled.current = state;
    setRound((current) => current + 1);
  }, [state]);

  const toggleType = (type: string) =>
    setTypes((current) => (current.includes(type) ? current.filter((value) => value !== type) : [...current, type]));

  return (
    <div className="space-y-6">
      <form action={action} className="space-y-5">
        {values.id ? <input type="hidden" name="id" value={values.id} /> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" name="firstName" value={firstName} onChange={setFirstName} autoComplete="off" />
          <Field label="Last name" name="lastName" value={lastName} onChange={setLastName} required={false} autoComplete="off" />
          <Field
            label="Organisation"
            name="orgName"
            value={orgName}
            onChange={setOrgName}
            required={false}
            autoComplete="off"
            hint="Created if it is new."
          />
          <Field label="Email" name="email" type="email" value={email} onChange={setEmail} required={false} autoComplete="off" />
          <Field label="Phone" name="phone" value={phone} onChange={setPhone} required={false} autoComplete="off" />
          <Field
            label="Tags"
            name="tags"
            value={tags}
            onChange={setTags}
            required={false}
            autoComplete="off"
            hint="Comma separated."
          />
        </div>

        <fieldset key={`types-${round}`}>
          <legend className="mb-2 text-sm text-muted">Type</legend>
          <div className="flex flex-wrap gap-3">
            {CONTACT_TYPES.map((type) => (
              <label key={type} className="flex items-center gap-1.5 text-sm text-ink">
                <input
                  type="checkbox"
                  name="types"
                  value={type}
                  checked={types.includes(type)}
                  onChange={() => toggleType(type)}
                  className="accent-[--color-accent]"
                />
                {type}
              </label>
            ))}
          </div>
        </fieldset>

        <label key={`dnc-${round}`} className="flex items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            name="doNotContact"
            checked={doNotContact}
            onChange={(event) => setDoNotContact(event.target.checked)}
            className="mt-1 accent-[--color-accent]"
          />
          <span>
            Do not contact
            <span className="block text-xs text-muted">
              Nothing in the OS — not an automation, not the Operator — can draft a message to them while this is set.
            </span>
          </span>
        </label>

        <FormMessage state={state} />
        <div className="max-w-48">
          <SubmitButton pendingLabel="Saving…">{editing ? "Save contact" : "Add contact"}</SubmitButton>
        </div>
      </form>

      {values.id ? <DeleteContact id={values.id} /> : null}
    </div>
  );
}
