// The tracker itself. The Express API and the browser demo both call this,
// so every number the app shows comes from the same code in both modes.
import { estimateMaintenance } from './adaptive.js';
import { bmi, bmiCategory, bodyFatCategory, bodyFatNavy, healthyRange, waistToHeight } from './body.js';
import { addDays, isIsoDate } from './dates.js';
import { customToFood } from './foods.js';
import { calorieTarget, formulaMaintenance, macroTargets } from './nutrition.js';
import { interpret } from './parse.js';
import { exerciseKcal, findActivity, stepsKcal } from './exercise.js';
import { dailyHistory, weeklyReport } from './report.js';
import { demoData } from './seed.js';
import { dailyIntake, dayTotals, groupBySlot, loggingStreak } from './summary.js';
import { projectGoal, weeklyRate, weightTrend } from './trend.js';
import {
  ValidationError,
  validateCheckin,
  validateCustomFood,
  validateExercise,
  validateMeal,
  validateMeasurement,
  validateProfile,
  validateTime,
  validateWater,
  validateWeight,
} from './validate.js';

/** How far back the weight chart and intake history reach. */
export const HISTORY_DAYS = 180;
export const INTAKE_DAYS = 14;
/** How far back "Recent foods" looks. */
export const RECENT_DAYS = 30;
/** Days shown in the water, exercise, sleep and mood charts. */
export const CHART_DAYS = 28;

export class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotFoundError';
    this.status = 404;
  }
}

function requireDate(date) {
  if (!isIsoDate(date)) throw new ValidationError(['Date must be a real date in YYYY-MM-DD form.']);
  return date;
}

/** @param {ReturnType<import('./store-memory.js').createMemoryStore>} store */
export function createTracker(store) {
  return {
    async getProfile() {
      return store.getProfile();
    },

    async saveProfile(input) {
      const profile = validateProfile(input);
      await store.setProfile(profile);
      return profile;
    },

    async logWeight(input) {
      const entry = validateWeight(input);
      await store.upsertWeight(entry);
      return entry;
    },

    async deleteWeight(date) {
      if (!(await store.deleteWeight(requireDate(date)))) {
        throw new NotFoundError(`No weigh-in on ${date}.`);
      }
    },

    async listMeals(date) {
      requireDate(date);
      return store.listMeals({ from: date, to: date });
    },

    async addMeal(input) {
      return store.addMeal(validateMeal(input));
    },

    async updateMeal(id, input) {
      const updated = await store.updateMeal(Number(id), validateMeal(input));
      if (!updated) throw new NotFoundError(`No food entry ${id}.`);
      return updated;
    },

    async deleteMeal(id) {
      if (!(await store.deleteMeal(Number(id)))) throw new NotFoundError(`No food entry ${id}.`);
    },

    /** Foods logged in the last 30 days, most often first, for one-tap logging. */
    async recentFoods(date) {
      requireDate(date);
      const meals = await store.listMeals({ from: addDays(date, -(RECENT_DAYS - 1)), to: date });
      const seen = new Map();
      for (const m of meals) {
        const key = `${m.name}|${m.amount}`;
        const hit = seen.get(key) ?? { ...m, count: 0 };
        hit.count += 1;
        hit.last = m.date;
        seen.set(key, hit);
      }
      return [...seen.values()]
        .sort((a, b) => b.count - a.count || b.last.localeCompare(a.last))
        .slice(0, 12)
        .map(({ id, date: _date, slot, last, ...m }) => m);
    },

    /** Copy one meal (e.g. yesterday's breakfast) to another day. */
    async copyMeals({ from, to, slot }) {
      requireDate(from);
      requireDate(to);
      const meals = (await store.listMeals({ from, to: from })).filter((m) => !slot || m.slot === slot);
      for (const { id, ...m } of meals) await store.addMeal({ ...m, date: to });
      return { copied: meals.length };
    },

    /** "1 bowl white rice" -> matching foods with that amount worked out. */
    async searchFoods(text) {
      const mine = (await store.listFoods()).map(customToFood);
      return interpret(text, mine).results;
    },

    async listFoods() {
      return store.listFoods();
    },

    async addFood(input) {
      return store.addFood(validateCustomFood(input));
    },

    async deleteFood(id) {
      if (!(await store.deleteFood(Number(id)))) throw new NotFoundError(`No saved food ${id}.`);
    },

    async setWater(input) {
      const entry = validateWater(input);
      await store.setWater(entry);
      return entry;
    },

    async addExercise(input) {
      const e = validateExercise(input);
      if (e.activity !== 'custom') {
        // Burn depends on body weight: use the trend on that day.
        const weights = (await store.listWeights()).filter((w) => w.date <= e.date);
        const kg = weightTrend(weights).at(-1)?.trend;
        if (!kg) throw new ValidationError(['Log your weight first, so calories burned can be worked out.']);
        if (e.activity === 'steps') {
          e.name = `${e.steps.toLocaleString('en-US')} steps`;
          e.kcal = stepsKcal(e.steps, kg);
        } else {
          const a = findActivity(e.activity);
          if (!a) throw new ValidationError(['Pick an activity from the list.']);
          e.name = a.name;
          e.kcal = exerciseKcal(a.met, kg, e.minutes);
        }
      }
      return store.addExercise(e);
    },

    async deleteExercise(id) {
      if (!(await store.deleteExercise(Number(id)))) throw new NotFoundError(`No exercise entry ${id}.`);
    },

    async logMeasurement(input) {
      const m = validateMeasurement(input);
      await store.upsertMeasurement(m);
      return m;
    },

    async deleteMeasurement(date) {
      if (!(await store.deleteMeasurement(requireDate(date)))) throw new NotFoundError(`No measurements on ${date}.`);
    },

    async logCheckin(input) {
      const c = validateCheckin(input);
      await store.upsertCheckin(c);
      return c;
    },

    async deleteCheckin(date) {
      if (!(await store.deleteCheckin(requireDate(date)))) throw new NotFoundError(`No check-in on ${date}.`);
    },

    /** Start a fast at the client's current time; only one can run at once. */
    async startFast(time) {
      const start = validateTime(time, 'Start time');
      const running = (await store.listFasts()).find((f) => !f.end);
      if (running) throw new ValidationError(['A fast is already running.']);
      return store.addFast({ start, end: null });
    },

    async endFast(time) {
      const end = validateTime(time, 'End time');
      const running = (await store.listFasts()).find((f) => !f.end);
      if (!running) throw new NotFoundError('No fast is running.');
      if (end <= running.start) throw new ValidationError(['The fast must end after it started.']);
      return store.updateFast(running.id, { end });
    },

    async deleteFast(id) {
      if (!(await store.deleteFast(Number(id)))) throw new NotFoundError(`No fast ${id}.`);
    },

    /** Everything the app shows for one day, computed in one place. */
    async dashboard(date) {
      requireDate(date);
      const profile = await store.getProfile();
      const allWeights = (await store.listWeights()).filter((w) => w.date <= date);
      const meals = await store.listMeals({ from: addDays(date, -(HISTORY_DAYS - 1)), to: date });

      const series = weightTrend(allWeights);
      const current = series.at(-1) ?? null;
      const todaysMeals = meals.filter((m) => m.date === date);
      const totals = dayTotals(todaysMeals);
      // The day being viewed is still in progress, so the estimate stops the
      // day before; otherwise the target would shift with every meal logged.
      const adaptive = estimateMaintenance(meals, allWeights, addDays(date, -1));

      let plan = null;
      let macros = null;
      let goal = null;
      const rate = weeklyRate(allWeights, date);
      if (profile && current) {
        const formula = Math.round(formulaMaintenance(profile, current.trend) / 10) * 10;
        const maintenance = adaptive.ready ? adaptive.maintenance : formula;
        plan = {
          ...calorieTarget(profile, current.trend, maintenance),
          source: adaptive.ready ? 'adaptive' : 'formula',
          formulaMaintenance: formula,
        };
        macros = macroTargets(plan.target, current.trend);
        goal = projectGoal(current.trend, profile.goalKg, rate, date);
      }

      const exercises = await store.listExercises({ from: date, to: date });
      const burned = exercises.reduce((sum, e) => sum + e.kcal, 0);
      const budget = plan ? plan.target + (profile.eatBackExercise ? burned : 0) : null;
      const water = await store.listWater({ from: addDays(date, -6), to: date });

      const measurements = (await store.listMeasurements()).filter((m) => m.date <= date);
      // Tape measurements are taken now and then, so use the latest of each.
      const latestOf = (key) => [...measurements].reverse().find((m) => m[key] !== null)?.[key] ?? null;
      const tape = { waistCm: latestOf('waistCm'), neckCm: latestOf('neckCm'), hipCm: latestOf('hipCm') };
      let body = null;
      if (profile && current) {
        const value = bmi(current.trend, profile.heightCm);
        const fat = bodyFatNavy({ sex: profile.sex, heightCm: profile.heightCm, ...tape });
        body = {
          bmi: value,
          asian: bmiCategory(value, 'asian'),
          who: bmiCategory(value, 'who'),
          healthy: healthyRange(profile.heightCm),
          tape,
          bodyFat: fat,
          bodyFatLabel: fat === null ? null : bodyFatCategory(fat, profile.sex),
          waistToHeight: waistToHeight(tape.waistCm, profile.heightCm),
          measurements: measurements.slice(-10).reverse(),
        };
      }

      const fasts = await store.listFasts();
      const active = fasts.find((f) => !f.end) ?? null;
      const hours = (f) => Math.round(((Date.parse(f.end) - Date.parse(f.start)) / 3600000) * 10) / 10;

      // Four weeks of everything, for the charts and the weekly report.
      const from = addDays(date, -(CHART_DAYS - 1));
      const recent = {
        meals: meals.filter((m) => m.date >= from),
        water: await store.listWater({ from, to: date }),
        exercises: await store.listExercises({ from, to: date }),
        checkins: await store.listCheckins({ from, to: date }),
      };
      const history = dailyHistory(recent, from, date);
      const report = weeklyReport(recent, date, {
        target: plan?.target ?? null,
        series,
        fasts,
        goalHours: profile?.fastingHours ?? 16,
      });

      const intake = dailyIntake(meals, addDays(date, -(INTAKE_DAYS - 1)), date);
      const pastDays = intake.slice(0, -1).filter((d) => d.kcal > 0);
      const avgIntake = pastDays.length
        ? Math.round(pastDays.reduce((s, d) => s + d.kcal, 0) / pastDays.length)
        : null;
      const onTarget = plan
        ? pastDays.filter((d) => Math.abs(d.kcal - plan.target) <= plan.target * 0.1).length
        : 0;

      return {
        date,
        setupNeeded: !profile || !current,
        profile,
        today: {
          totals,
          burned,
          budget,
          remaining: plan ? budget - totals.kcal : null,
          meals: groupBySlot(todaysMeals),
        },
        exercise: { items: exercises, kcal: burned, eatBack: Boolean(profile?.eatBackExercise) },
        water: {
          ml: water.find((w) => w.date === date)?.ml ?? 0,
          goal: profile?.waterGoalMl ?? 2000,
          days: water,
        },
        body: body && {
          ...body,
          waist: measurements.filter((m) => m.waistCm !== null).map((m) => ({ date: m.date, cm: m.waistCm })),
        },
        checkin: recent.checkins.find((c) => c.date === date) ?? null,
        history,
        report,
        fasting: {
          active,
          goalHours: profile?.fastingHours ?? 16,
          recent: fasts
            .filter((f) => f.end)
            .slice(-10)
            .reverse()
            .map((f) => ({ ...f, hours: hours(f) })),
        },
        plan,
        macros,
        weight: {
          latest: current ? { date: current.date, kg: current.kg } : null,
          trend: current?.trend ?? null,
          start: series[0] ?? null,
          weeklyRate: rate,
          goal,
          loggedToday: current?.date === date,
          series: series.filter((p) => p.date > addDays(date, -HISTORY_DAYS)),
        },
        intake: { days: intake, average: avgIntake, loggedDays: pastDays.length, onTarget },
        adaptive,
        streak: loggingStreak(meals, date),
      };
    },

    async exportData() {
      return {
        app: 'calorie-weight-tracker',
        version: 1,
        profile: await store.getProfile(),
        weights: await store.listWeights(),
        meals: (await store.listMeals()).map(({ id, ...m }) => m),
        foods: (await store.listFoods()).map(({ id, ...f }) => f),
        water: await store.listWater(),
        exercises: (await store.listExercises()).map(({ id, ...e }) => e),
        measurements: await store.listMeasurements(),
        fasts: (await store.listFasts()).map(({ id, ...f }) => f),
        checkins: await store.listCheckins(),
      };
    },

    async importData(data) {
      if (!data || data.app !== 'calorie-weight-tracker') {
        throw new ValidationError(['That file is not a tracker export.']);
      }
      const profile = data.profile ? validateProfile(data.profile) : null;
      const weights = (data.weights ?? []).map(validateWeight);
      const meals = (data.meals ?? []).map(validateMeal);
      const foods = (data.foods ?? []).map(validateCustomFood);
      const water = (data.water ?? []).map(validateWater);
      // Exercise keeps the calories worked out when it was logged.
      const exercises = (data.exercises ?? []).map((e) => ({
        ...validateExercise({ ...e, activity: 'custom' }),
        activity: String(e.activity ?? 'custom').slice(0, 30),
        steps: e.steps ?? null,
      }));
      const measurements = (data.measurements ?? []).map(validateMeasurement);
      const fasts = (data.fasts ?? []).map((f) => ({
        start: validateTime(f.start, 'Fast start'),
        end: f.end ? validateTime(f.end, 'Fast end') : null,
      }));
      const checkins = (data.checkins ?? []).map(validateCheckin);
      await store.replaceAll({ profile, weights, meals, foods, water, exercises, measurements, fasts, checkins });
      return { weights: weights.length, meals: meals.length, foods: foods.length, exercises: exercises.length };
    },

    async loadDemo(today) {
      await store.replaceAll(demoData(requireDate(today)));
    },

    async reset() {
      await store.replaceAll({});
    },
  };
}
