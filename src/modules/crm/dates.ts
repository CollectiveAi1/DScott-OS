import { addDays, weekdayOf } from "@/lib/dates";

/**
 * Business days from a date, skipping Saturday and Sunday.
 *
 * Holidays are not modelled. This sets an internal due date on a task Ahmad or Kenza will see
 * inside the OS; a calendar of federal holidays would be more machinery than a wrong-by-one-day
 * internal date is worth.
 */
export function addBusinessDays(isoDate: string, days: number): string {
  let date = isoDate;
  let remaining = days;
  while (remaining > 0) {
    date = addDays(date, 1);
    // 6 = Saturday, 7 = Sunday.
    if (weekdayOf(date) < 6) remaining--;
  }
  return date;
}
