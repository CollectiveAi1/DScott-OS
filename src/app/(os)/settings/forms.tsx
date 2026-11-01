"use client";

import { useActionState } from "react";
import { changePasswordAction, type FormState } from "@/lib/auth/actions";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password-rules";
import { setDeliveryModeAction } from "@/lib/settings-actions";
import { Field, FormMessage, SubmitButton } from "@/components/form";

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
