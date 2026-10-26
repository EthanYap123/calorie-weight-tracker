// Reminders. A web app can't wake itself up at set times without a push
// server, so reminders work three ways: daily repeating events with alerts
// for the phone's own calendar (.ics), gentle nudges inside the app, and
// notifications while the app is open.

export const DEFAULT_REMINDERS = {
  weighIn: '07:30',
  breakfast: '08:30',
  lunch: '12:30',
  dinner: '19:00',
  water: true,
  notify: false,
};

const LABELS = {
  weighIn: 'Weigh in (before breakfast)',
  breakfast: 'Log breakfast',
  lunch: 'Log lunch',
  dinner: 'Log dinner',
};

/** Times for water reminders: every two hours through the day. */
export const WATER_TIMES = ['10:00', '12:00', '14:00', '16:00', '18:00', '20:00'];

const minutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};
const validTime = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(t ?? ''));

export function normaliseReminders(raw = {}) {
  const r = { ...DEFAULT_REMINDERS };
  for (const k of ['weighIn', 'breakfast', 'lunch', 'dinner']) {
    if (raw[k] === '' || raw[k] === null) r[k] = '';
    else if (validTime(raw[k])) r[k] = raw[k];
  }
  if (raw.water !== undefined) r.water = Boolean(raw.water);
  if (raw.notify !== undefined) r.notify = Boolean(raw.notify);
  return r;
}

/** Everything that should alert today: [{key, time, text}], sorted by time. */
export function schedule(reminders) {
  const r = normaliseReminders(reminders);
  const items = Object.entries(LABELS)
    .filter(([k]) => r[k])
    .map(([key, text]) => ({ key, time: r[key], text }));
  if (r.water) for (const time of WATER_TIMES) items.push({ key: `water-${time}`, time, text: 'Drink a glass of water' });
  return items.sort((a, b) => minutes(a.time) - minutes(b.time));
}

/**
 * In-app nudges for today, given the dashboard and the time now ("HH:MM").
 * A meal nudge appears an hour after its reminder time if nothing is logged.
 */
export function nudges(d, now, reminders) {
  const r = normaliseReminders(reminders);
  const t = minutes(now);
  const out = [];
  if (r.weighIn && !d.weight.loggedToday && t >= minutes(r.weighIn) && t < minutes('12:00')) {
    out.push({ key: 'weighIn', text: 'Weigh in before you eat, so your trend stays accurate.' });
  }
  for (const slot of ['breakfast', 'lunch', 'dinner']) {
    const due = r[slot] && t >= minutes(r[slot]) + 60;
    const empty = !d.today.meals.find((m) => m.slot === slot)?.items.length;
    if (due && empty) out.push({ key: slot, text: `Nothing logged for ${slot} yet.` });
  }
  if (r.water) {
    // Expect water spread evenly from 8 am to 10 pm.
    const share = Math.min(1, Math.max(0, (t - minutes('08:00')) / (14 * 60)));
    const expected = Math.round((d.water.goal * share) / 250) * 250;
    if (d.water.ml + 500 <= expected) {
      out.push({ key: 'water', text: `Water is behind: ${d.water.ml} of about ${expected} ml by now.` });
    }
  }
  return out;
}

/**
 * An .ics calendar file with one daily repeating event per reminder, each
 * with an alert at its start, so the phone reminds you even when the app
 * is closed.
 */
export function icsFile(reminders, today, stamp = new Date()) {
  const day = today.replaceAll('-', '');
  const utc = stamp.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const events = schedule(reminders).map(({ key, time, text }) => {
    const hhmm = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}${String(mins % 60).padStart(2, '0')}`;
    const start = minutes(time);
    return [
      'BEGIN:VEVENT',
      `UID:steady-${key}@calorie-weight-tracker`,
      `DTSTAMP:${utc}`,
      `DTSTART:${day}T${hhmm(start)}00`,
      `DTEND:${day}T${hhmm(Math.min(start + 5, 23 * 60 + 59))}00`,
      'RRULE:FREQ=DAILY',
      `SUMMARY:Steady: ${text}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${text}`,
      'TRIGGER:PT0M',
      'END:VALARM',
      'END:VEVENT',
    ].join('\r\n');
  });
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Steady//Reminders//EN', 'CALSCALE:GREGORIAN', ...events, 'END:VCALENDAR', ''].join('\r\n');
}
