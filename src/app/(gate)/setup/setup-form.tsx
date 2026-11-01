"use client";

import { useActionState } from "react";
import { createOwnerAction, type FormState } from "@/lib/auth/actions";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password-rules";
import { Field, FormMessage, SubmitButton } from "@/components/form";

const initial: FormState = {};

export function SetupForm() {
  const [state, action] = useActionState(createOwnerAction, initial);
  return (
    <form action={action} className="space-y-4">
      <Field label="Your name" name="name" autoComplete="name" defaultValue="Devon" />
      <Field label="Email" name="email" type="email" autoComplete="email" />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={MIN_PASSWORD_LENGTH}
        hint={`At least ${MIN_PASSWORD_LENGTH} characters. A short sentence works well.`}
      />
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Creating…">Create account</SubmitButton>
    </form>
  );
}
