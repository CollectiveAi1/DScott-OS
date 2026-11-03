/** Calendar date (YYYY-MM-DD) for an instant, as seen in the given IANA time zone. */
export function dateInZone(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

/** Adds whole days to a YYYY-MM-DD date without touching time zones. */
export function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const shifted = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + days));
  return shifted.toISOString().slice(0, 10);
}

export function greetingFor(instant: Date, timeZone: string): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(instant),
  );
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** Wall-clock time (HH:MM, 24-hour) for an instant, as seen in the given IANA time zone. */
export function timeInZone(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${pick("hour")}:${pick("minute")}`;
}

/** ISO weekday (Monday = 1 … Sunday = 7) for an instant, as seen in the given time zone. */
export function weekdayInZone(instant: Date, timeZone: string): number {
  const short = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(instant);
  const index = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(short);
  if (index < 0) throw new Error(`Unexpected weekday "${short}" for time zone ${timeZone}.`);
  return index + 1;
}

/** "HH:MM" as minutes past local midnight, for comparing a wall-clock time against a rule. */
export function minutesOfDay(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  if (hour === undefined || minute === undefined || Number.isNaN(hour) || Number.isNaN(minute)) {
    throw new Error(`Not a HH:MM time: "${time}".`);
  }
  return hour * 60 + minute;
}

/** ISO weekday (Monday = 1 … Sunday = 7) for a YYYY-MM-DD calendar date. */
export function weekdayOf(isoDate: string): number {
  const [year, month, day] = isoDate.split("-").map(Number);
  const utc = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
  // getUTCDay gives Sunday = 0; the OS counts Monday = 1 everywhere else.
  return utc.getUTCDay() === 0 ? 7 : utc.getUTCDay();
}

/** The next date falling on `weekday` (Monday = 1), counting today itself as the next one. */
export function nextWeekday(fromIsoDate: string, weekday: number): string {
  const ahead = (weekday - weekdayOf(fromIsoDate) + 7) % 7;
  return addDays(fromIsoDate, ahead);
}
