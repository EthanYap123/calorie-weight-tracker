// Adaptive maintenance: work out what the user really burns from what they
// ate and how their weight moved, instead of trusting the BMR formula.
//
//   maintenance = average intake - (weight change per day x 7700 kcal/kg)
//
// Eating 2000 kcal a day while losing 0.5 kg a week means burning about
// 2000 + 0.5 x 7700 / 7 = 2550 kcal a day.
import { addDays, toDay } from './dates.js';
import { KCAL_PER_KG } from './nutrition.js';
import { slope } from './trend.js';

/** Days under this total look half-logged and are left out of the average. */
export const MIN_COMPLETE_DAY_KCAL = 800;
export const WINDOW_DAYS = 28;
export const MIN_LOGGED_DAYS = 14;
export const MIN_WEIGH_INS = 6;

/**
 * @param {{date: string, kcal: number}[]} meals
 * @param {{date: string, kg: number}[]} weights
 * @param {string} end last day of the window (inclusive)
 */
export function estimateMaintenance(meals, weights, end, windowDays = WINDOW_DAYS) {
  const start = addDays(end, -(windowDays - 1));

  const perDay = new Map();
  for (const m of meals) {
    if (m.date < start || m.date > end) continue;
    perDay.set(m.date, (perDay.get(m.date) ?? 0) + m.kcal);
  }
  const complete = [...perDay.values()].filter((kcal) => kcal >= MIN_COMPLETE_DAY_KCAL);
  const weighIns = weights.filter((w) => w.date >= start && w.date <= end);

  const progress = {
    loggedDays: complete.length,
    weighIns: weighIns.length,
    neededDays: MIN_LOGGED_DAYS,
    neededWeighIns: MIN_WEIGH_INS,
  };
  if (complete.length < MIN_LOGGED_DAYS || weighIns.length < MIN_WEIGH_INS) {
    return { ready: false, ...progress };
  }

  const avgIntake = complete.reduce((s, k) => s + k, 0) / complete.length;
  const kgPerDay = slope(weighIns.map((w) => ({ x: toDay(w.date), y: w.kg })));
  if (kgPerDay === null) return { ready: false, ...progress };

  const maintenance = avgIntake - kgPerDay * KCAL_PER_KG;
  const confidence =
    complete.length >= 21 && weighIns.length >= 12 ? 'high' : 'medium';

  return {
    ready: true,
    ...progress,
    maintenance: Math.round(maintenance / 10) * 10,
    avgIntake: Math.round(avgIntake),
    weeklyChangeKg: Math.round(kgPerDay * 7 * 100) / 100,
    confidence,
  };
}
