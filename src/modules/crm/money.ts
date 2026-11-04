/**
 * Money is integer cents everywhere (PRD §6.1), formatted only at render. This is the one place
 * that converts, so there is one set of rules to get right.
 */

/** Cents as Devon would read them: 125000 → "$1,250.00". */
export function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

/** The same, without trailing zeroes on a round number: 125000 → "$1,250". */
export function formatCentsShort(cents: number): string {
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export type MoneyResult = { ok: true; cents: number } | { ok: false; error: string };

/**
 * What a person types, into cents. "$1,250", "1,250.50" and "1250" all work.
 *
 * Anything it cannot read is refused rather than coerced. A deal value quietly rounded into
 * something plausible is worse than one that would not save.
 */
export function parseMoney(input: string): MoneyResult {
  const raw = input.trim();
  if (!raw) return { ok: true, cents: 0 };

  // The sign is read first and exactly once. Stripping every "-" during cleanup would quietly
  // turn "--5" into a valid negative, which is the kind of plausible-but-wrong this refuses.
  const wrapped = /^\((.*)\)$/.exec(raw);
  const withoutParens = wrapped ? (wrapped[1] ?? "") : raw;
  const leadingMinus = withoutParens.trimStart().startsWith("-");
  const negative = Boolean(wrapped) !== leadingMinus;
  const body = leadingMinus ? withoutParens.trimStart().slice(1) : withoutParens;

  const cleaned = body.replace(/[$\s,]/g, "");
  if (!cleaned) return { ok: false, error: "That is not an amount. Try 1250 or $1,250." };
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    return { ok: false, error: `Could not read "${raw}" as an amount. Try 1250 or $1,250.` };
  }

  const [whole, fraction = ""] = cleaned.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) return { ok: false, error: "That amount is too large." };
  return { ok: true, cents: negative ? -cents : cents };
}

/** Cents back into something the money input can show for editing. */
export function centsToInput(cents: number): string {
  if (cents === 0) return "";
  return (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
}
