// Weight trend. Daily weigh-ins swing by a kilo or more with water and food,
// so the app reads progress from an exponentially smoothed trend instead.
import { addDays, daysBetween, toDay } from './dates.js';

/** Smoothing per day: each weigh-in moves the trend 10% of the way to it. */
export const ALPHA = 0.1;

/**
 * @param {{date: string, kg: number}[]} entries
 * @returns {{date: string, kg: number, trend: number}[]} sorted by date
 */
export function weightTrend(entries) {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const out = [];
  let trend = null;
  let last = null;
  for (const { date, kg } of sorted) {
    if (trend === null) {
      trend = kg;
    } else {
      // A gap of n days counts as n smoothing steps, so the trend catches up
      // after a missed week instead of crawling.
      const steps = Math.max(1, daysBetween(last, date));
      const alpha = 1 - (1 - ALPHA) ** steps;
      trend += alpha * (kg - trend);
    }
    last = date;
    out.push({ date, kg, trend: Math.round(trend * 100) / 100 });
  }
  return out;
}

/** Least-squares slope of y against x. Null with fewer than 2 distinct x. */
export function slope(points) {
  const n = points.length;
  if (n < 2) return null;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.x - mx) * (p.y - my);
    den += (p.x - mx) ** 2;
  }
  return den === 0 ? null : num / den;
}

/**
 * Change in kg per week over the last `days` days up to `end`, fitted to the
 * raw weigh-ins (the smoothed trend lags, so fitting it understates the pace).
 * Null when the window holds fewer than 4 weigh-ins or spans under a week.
 */
export function weeklyRate(entries, end, days = 21) {
  const start = addDays(end, -(days - 1));
  const inWindow = entries.filter((e) => e.date >= start && e.date <= end);
  if (inWindow.length < 4) return null;
  const span = daysBetween(inWindow[0].date, inWindow.at(-1).date);
  if (span < 7) return null;
  const perDay = slope(inWindow.map((e) => ({ x: toDay(e.date), y: e.kg })));
  return perDay === null ? null : Math.round(perDay * 7 * 100) / 100;
}

/**
 * Date the trend reaches the goal at the current pace, or null when it is
 * heading the wrong way or too slowly (under 50 g a week) to project.
 */
export function projectGoal(trendKg, goalKg, ratePerWeek, fromDate) {
  const remaining = goalKg - trendKg;
  if (Math.abs(remaining) < 0.1) return { date: fromDate, weeks: 0 };
  if (ratePerWeek === null || Math.abs(ratePerWeek) < 0.05) return null;
  if (Math.sign(remaining) !== Math.sign(ratePerWeek)) return null;
  const weeks = remaining / ratePerWeek;
  if (weeks > 104) return null;
  return { date: addDays(fromDate, Math.ceil(weeks * 7)), weeks: Math.round(weeks * 10) / 10 };
}
