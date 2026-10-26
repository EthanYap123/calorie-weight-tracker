// Energy maths: BMR, maintenance, a safe daily target and macro split.

/** Energy in 1 kg of body weight change (mixed fat and lean tissue). */
export const KCAL_PER_KG = 7700;

export const ACTIVITY_LEVELS = {
  sedentary: { factor: 1.2, label: 'Sedentary', hint: 'Desk job, little exercise' },
  light: { factor: 1.375, label: 'Lightly active', hint: 'Exercise 1-3 days a week' },
  moderate: { factor: 1.55, label: 'Moderately active', hint: 'Exercise 3-5 days a week' },
  active: { factor: 1.725, label: 'Very active', hint: 'Hard exercise 6-7 days a week' },
  athlete: { factor: 1.9, label: 'Athlete', hint: 'Training twice a day or physical job' },
};

/** Lowest daily target the app will suggest without medical supervision. */
export const CALORIE_FLOOR = { female: 1200, male: 1500 };

/** Weight-loss pace is capped at 1% of body weight a week, gain at 0.5 kg. */
export const MAX_GAIN_PER_WEEK = 0.5;

/** Within this distance of the goal weight the target switches to maintenance. */
export const GOAL_TOLERANCE_KG = 0.5;

/** Mifflin-St Jeor resting energy, kcal/day. */
export function bmr({ sex, age, heightCm }, weightKg) {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return base + (sex === 'female' ? -161 : 5);
}

export function formulaMaintenance(profile, weightKg) {
  return bmr(profile, weightKg) * ACTIVITY_LEVELS[profile.activity].factor;
}

const round10 = (n) => Math.round(n / 10) * 10;

/**
 * Daily calorie target for reaching the goal weight at the chosen pace.
 * `maintenance` defaults to the formula estimate; the tracker passes the
 * adaptive estimate instead once there is enough logged data.
 */
export function calorieTarget(profile, weightKg, maintenance = formulaMaintenance(profile, weightKg)) {
  const warnings = [];
  const gap = profile.goalKg - weightKg;
  const direction = Math.abs(gap) <= GOAL_TOLERANCE_KG ? 0 : Math.sign(gap);

  let rate = direction === 0 ? 0 : profile.weeklyRateKg;
  const cap = direction < 0 ? weightKg * 0.01 : MAX_GAIN_PER_WEEK;
  if (rate > cap) {
    rate = Math.round(cap * 100) / 100;
    warnings.push(`Pace capped at ${rate} kg a week to keep it safe.`);
  }

  const dailyDelta = (direction * rate * KCAL_PER_KG) / 7;
  const floor = CALORIE_FLOOR[profile.sex] ?? CALORIE_FLOOR.male;
  let target = round10(maintenance + dailyDelta);
  if (target < floor) {
    target = floor;
    warnings.push(`Target raised to the ${floor} kcal minimum, so progress will be slower.`);
  }

  return {
    maintenance: round10(maintenance),
    target,
    dailyDelta: Math.round(target - maintenance),
    direction: direction < 0 ? 'lose' : direction > 0 ? 'gain' : 'maintain',
    weeklyRateKg: rate,
    warnings,
  };
}

/** Protein 1.6 g/kg, fat 25% of energy, carbs fill the rest. */
export function macroTargets(targetKcal, weightKg) {
  const protein = Math.round(1.6 * weightKg);
  const fat = Math.round((targetKcal * 0.25) / 9);
  const carbs = Math.max(0, Math.round((targetKcal - protein * 4 - fat * 9) / 4));
  return { protein, carbs, fat };
}
