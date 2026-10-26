// Dates are plain "YYYY-MM-DD" strings everywhere. Day maths runs on UTC
// day numbers so time zones and daylight saving never shift a day.

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  return fromDay(toDay(value)) === value;
}

export function toDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function fromDay(day) {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(iso, n) {
  return fromDay(toDay(iso) + n);
}

export function daysBetween(from, to) {
  return toDay(to) - toDay(from);
}

/** Today's date in the viewer's local time zone. */
export function localToday(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
