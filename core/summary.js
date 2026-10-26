// Totals, meal grouping and streaks for the Today and Insights views.
import { addDays } from './dates.js';

export const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'snacks'];

export function dayTotals(meals) {
  const t = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  for (const m of meals) {
    t.kcal += m.kcal;
    t.protein += m.protein;
    t.carbs += m.carbs;
    t.fat += m.fat;
  }
  return {
    kcal: Math.round(t.kcal),
    protein: Math.round(t.protein),
    carbs: Math.round(t.carbs),
    fat: Math.round(t.fat),
  };
}

export function groupBySlot(meals) {
  const groups = Object.fromEntries(MEAL_SLOTS.map((s) => [s, []]));
  for (const m of meals) groups[m.slot].push(m);
  return MEAL_SLOTS.map((slot) => ({ slot, items: groups[slot], kcal: dayTotals(groups[slot]).kcal }));
}

/** kcal eaten on each day from `from` to `to`, including empty days. */
export function dailyIntake(meals, from, to) {
  const perDay = new Map();
  for (const m of meals) perDay.set(m.date, (perDay.get(m.date) ?? 0) + m.kcal);
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    out.push({ date: d, kcal: Math.round(perDay.get(d) ?? 0) });
  }
  return out;
}

/**
 * Consecutive days with at least one food logged, counting back from `today`.
 * An empty today doesn't break the streak, since the day isn't over yet.
 */
export function loggingStreak(meals, today) {
  const logged = new Set(meals.map((m) => m.date));
  let day = logged.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (logged.has(day)) {
    streak += 1;
    day = addDays(day, -1);
  }
  return streak;
}
