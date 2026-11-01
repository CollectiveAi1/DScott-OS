import type { Metadata } from "next";
import { getSettings } from "@/lib/settings";
import { DeliveryModeForm, PasswordForm } from "./forms";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const current = await getSettings();
  return (
    <div className="mx-auto max-w-2xl space-y-10">
      <h1 className="text-3xl font-semibold">Settings</h1>

      <section aria-labelledby="delivery-heading" className="rounded-[--radius-panel] border border-line bg-surface p-6">
        <h2 id="delivery-heading" className="text-lg font-semibold">
          Delivery mode
        </h2>
        <p className="mt-1 text-sm text-muted">
          {current.deliveryMode === "sandbox"
            ? "Sandbox: approvals are recorded and nothing is sent."
            : "Live: approved emails, texts and calendar writes are delivered."}
        </p>
        <DeliveryModeForm mode={current.deliveryMode} />
      </section>

      <section aria-labelledby="time-heading" className="rounded-[--radius-panel] border border-line bg-surface p-6">
        <h2 id="time-heading" className="text-lg font-semibold">
          Time zone
        </h2>
        <p className="mt-1 font-mono text-sm text-ink">{current.timezone}</p>
        <p className="mt-1 text-xs text-muted">Set with OS_TIMEZONE. Editable here in v1.</p>
      </section>

      <section aria-labelledby="password-heading" className="rounded-[--radius-panel] border border-line bg-surface p-6">
        <h2 id="password-heading" className="text-lg font-semibold">
          Password
        </h2>
        <PasswordForm />
      </section>
    </div>
  );
}
