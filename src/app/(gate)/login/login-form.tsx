"use client";

import { useActionState } from "react";
import { signInAction, type FormState } from "@/lib/auth/actions";
import { Field, FormMessage, SubmitButton } from "@/components/form";

const initial: FormState = {};

export function LoginForm() {
  const [state, action] = useActionState(signInAction, initial);
  return (
    <form action={action} className="space-y-4">
      <Field label="Email" name="email" type="email" autoComplete="email" />
      <Field label="Password" name="password" type="password" autoComplete="current-password" />
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>
    </form>
  );
}
