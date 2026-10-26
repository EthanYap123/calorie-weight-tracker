// Weekly report and the day-by-day history behind the charts.
import { MIN_COMPLETE_DAY_KCAL } from './adaptive.js';
import { addDays } from './dates.js';

const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const r0 = (x) => (x === null ? null : Math.round(x));
const r1 = (x) => (x === null ? null : Math.round(x * 10) / 10);

/**
 * One row per day from `from` to `to`: calories, protein, water, exercise,
 * steps, sleep and mood (null where nothing was logged).
 */
export function dailyHistory({ meals, water, exercises, checkins }, from, to) {
  const rows = new Map();
  for (let d = from; d <= to; d = addDays(d, 1)) {
    rows.set(d, { date: d, kcal: 0, protein: 0, water: 0, exercise: 0, steps: 0, sleep: null, quality: null, mood: null });
  }
  const at = (date) => rows.get(date);
  for (const m of meals) if (at(m.date)) (at(m.date).kcal += m.kcal), (at(m.date).protein += m.protein);
  for (const w of water) if (at(w.date)) at(w.date).water = w.ml;
  for (const e of exercises) {
    if (!at(e.date)) continue;
    at(e.date).exercise += e.kcal;
    if (e.steps) at(e.date).steps += e.steps;
  }
  for (const c of checkins) {
    if (!at(c.date)) continue;
    Object.assign(at(c.date), { sleep: c.sleepHours, quality: c.sleepQuality, mood: c.mood });
  }
  return [...rows.values()].map((r) => ({ ...r, kcal: Math.round(r.kcal), protein: Math.round(r.protein) }));
}

function trendOn(series, date) {
  let last = null;
  for (const p of series) {
    if (p.date > date) break;
    last = p.trend;
  }
  return last;
}

/** Totals and averages for the 7 days ending on `end`. */
export function weekStats(data, end, { target, series, fasts, goalHours }) {
  const start = addDays(end, -6);
  const days = dailyHistory(data, start, end);
  const logged = days.filter((d) => d.kcal >= MIN_COMPLETE_DAY_KCAL);
  const workouts = data.exercises.filter((e) => e.date >= start && e.date <= end && e.activity !== 'steps');
  const stepDays = days.filter((d) => d.steps > 0);
  const waterDays = days.filter((d) => d.water > 0);
  const sleepDays = days.filter((d) => d.sleep !== null);
  const moodDays = days.filter((d) => d.mood !== null);
  const done = fasts.filter((f) => f.end && f.end.slice(0, 10) >= start && f.end.slice(0, 10) <= end);
  const hours = (f) => (Date.parse(f.end) - Date.parse(f.start)) / 3600000;
  const before = trendOn(series, addDays(start, -1));
  const after = trendOn(series, end);

  return {
    start,
    end,
    loggedDays: logged.length,
    avgKcal: r0(avg(logged.map((d) => d.kcal))),
    avgProtein: r0(avg(logged.map((d) => d.protein))),
    onTarget: target ? logged.filter((d) => Math.abs(d.kcal - target) <= target * 0.1).length : 0,
    weightChange: before !== null && after !== null ? r1(after - before) : null,
    workouts: workouts.length,
    workoutMinutes: workouts.reduce((s, e) => s + (e.minutes ?? 0), 0),
    exerciseKcal: Math.round(days.reduce((s, d) => s + d.exercise, 0)),
    avgSteps: r0(avg(stepDays.map((d) => d.steps))),
    avgWater: r0(avg(waterDays.map((d) => d.water))),
    avgSleep: r1(avg(sleepDays.map((d) => d.sleep))),
    avgMood: r1(avg(moodDays.map((d) => d.mood))),
    fasts: done.length,
    fastsOnGoal: done.filter((f) => hours(f) >= goalHours).length,
  };
}

/** The last 7 full days (ending yesterday) against the 7 before them. */
export function weeklyReport(data, date, context) {
  const end = addDays(date, -1);
  return { thisWeek: weekStats(data, end, context), lastWeek: weekStats(data, addDays(end, -7), context) };
}
