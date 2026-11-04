import type { DraftableKind } from "./payloads";

export type DeliveryResult = { ok: true; detail?: string } | { ok: false; reason: string };

export type DeliveryProvider = {
  kind: DraftableKind;
  name: string;
  /** Whether the provider will de-duplicate on the key, so a retry cannot send twice. */
  supportsIdempotency: boolean;
  deliver(input: { payload: unknown; idempotencyKey: string }): Promise<DeliveryResult>;
};

const LABEL: Record<DraftableKind, string> = {
  email: "email",
  text: "text",
  calendar_write: "calendar",
};

/**
 * What v1 has, for every kind.
 *
 * This is not a placeholder waiting to be tidied away — it is the guarantee that this version
 * cannot send anything, written as code rather than as a promise in a document. PRD §7 puts
 * "no automatic outbound send" in WON'T HAVE for this release; `NoopProvider` is what makes
 * that true even if every other check were bypassed.
 */
export function noopProvider(kind: DraftableKind): DeliveryProvider {
  return {
    kind,
    name: "none",
    supportsIdempotency: false,
    async deliver() {
      return { ok: false, reason: `No ${LABEL[kind]} provider connected.` };
    },
  };
}

/**
 * The providers this deployment has. v1 registers only no-ops; v2 replaces them with Resend and
 * Twilio, at which point `hasRealProvider` starts returning true and going live becomes
 * possible.
 */
export function providerFor(kind: DraftableKind): DeliveryProvider {
  return noopProvider(kind);
}

/** True once at least one provider can actually deliver. False throughout v1, by design. */
export function hasRealProvider(): boolean {
  for (const kind of ["email", "text", "calendar_write"] as DraftableKind[]) {
    if (providerFor(kind).name !== "none") return true;
  }
  return false;
}

/** What Settings says when going live is refused. */
export const NO_PROVIDER_MESSAGE =
  "No email or text provider is connected, so nothing could be delivered. Going live stays blocked until one is.";
