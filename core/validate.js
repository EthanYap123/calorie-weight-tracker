// Input checks shared by the API and the browser demo, so both reject the
// same things with the same messages.
import { isIsoDate } from './dates.js';
import { ACTIVITY_LEVELS } from './nutrition.js';
import { MEAL_SLOTS } from './summary.js';

export class ValidationError extends Error {
  constructor(errors) {
    super(errors.join(' '));
    this.name = 'ValidationError';
    this.status = 400;
    this.errors = errors;
  }
}

function num(value, label, min, max, errors) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    errors.push(`${label} must be a number.`);
    return null;
  }
  if (n < min || n > max) errors.push(`${label} must be between ${min} and ${max}.`);
  return n;
}

function date(value, errors) {
  if (!isIsoDate(value)) errors.push('Date must be a real date in YYYY-MM-DD form.');
  return value;
}

function done(errors, value) {
  if (errors.length) throw new ValidationError(errors);
  return value;
}

export function validateProfile(input = {}) {
  const errors = [];
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, 40) : '';
  if (!['male', 'female'].includes(input.sex)) errors.push('Sex must be male or female.');
  if (!(input.activity in ACTIVITY_LEVELS)) errors.push('Pick an activity level.');
  return done(errors, {
    name,
    sex: input.sex,
    age: num(input.age, 'Age', 15, 100, errors),
    heightCm: num(input.heightCm, 'Height', 120, 230, errors),
    activity: input.activity,
    goalKg: num(input.goalKg, 'Goal weight', 30, 300, errors),
    weeklyRateKg: num(input.weeklyRateKg, 'Weekly pace', 0, 1, errors),
    // Optional settings, with defaults for profiles saved before they existed.
    waterGoalMl: optional(input.waterGoalMl, 2000, (v) => num(v, 'Water goal', 500, 6000, errors)),
    eatBackExercise: input.eatBackExercise === true || input.eatBackExercise === 'true' || input.eatBackExercise === 'on',
    fastingHours: optional(input.fastingHours, 16, (v) => num(v, 'Fasting goal', 10, 72, errors)),
  });
}

const blank = (v) => v === undefined || v === null || v === '';
const optional = (v, fallback, check) => (blank(v) ? fallback : check(v));

export function validateWeight(input = {}) {
  const errors = [];
  return done(errors, {
    date: date(input.date, errors),
    kg: Math.round(num(input.kg, 'Weight', 30, 300, errors) * 10) / 10,
  });
}

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

export function validateMeal(input = {}) {
  const errors = [];
  const name = text(input.name, 80);
  if (!name) errors.push('Food name is required.');
  if (!MEAL_SLOTS.includes(input.slot)) errors.push(`Meal must be one of ${MEAL_SLOTS.join(', ')}.`);
  const hasGrams = input.grams !== undefined && input.grams !== null && input.grams !== '';
  const meal = {
    date: date(input.date, errors),
    slot: input.slot,
    name,
    amount: text(input.amount, 60),
    grams: hasGrams ? num(input.grams, 'Weight', 0.1, 5000, errors) : null,
    kcal: num(input.kcal, 'Calories', 0, 5000, errors),
    protein: num(input.protein ?? 0, 'Protein', 0, 500, errors),
    carbs: num(input.carbs ?? 0, 'Carbs', 0, 1000, errors),
    fat: num(input.fat ?? 0, 'Fat', 0, 500, errors),
  };
  return done(errors, meal);
}

export function validateWater(input = {}) {
  const errors = [];
  return done(errors, { date: date(input.date, errors), ml: num(input.ml, 'Water', 0, 10000, errors) });
}

/**
 * An exercise entry: an activity and minutes, or steps. `kcal` is worked
 * out by the service from the user's weight, except for "custom" entries.
 */
export function validateExercise(input = {}) {
  const errors = [];
  const out = { date: date(input.date, errors), activity: text(input.activity, 30) };
  if (out.activity === 'steps') {
    out.steps = Math.round(num(input.steps, 'Steps', 1, 100000, errors) ?? 0);
    out.minutes = null;
  } else if (out.activity === 'custom') {
    out.name = text(input.name, 60);
    if (!out.name) errors.push('Name the activity.');
    out.minutes = blank(input.minutes) ? null : num(input.minutes, 'Minutes', 1, 1440, errors);
    out.steps = null;
    out.kcal = num(input.kcal, 'Calories burned', 0, 5000, errors);
  } else {
    out.minutes = num(input.minutes, 'Minutes', 1, 1440, errors);
    out.steps = null;
  }
  return done(errors, out);
}

/** Tape measurements in cm; any of them can be left out, but not all. */
export function validateMeasurement(input = {}) {
  const errors = [];
  const cm = (v, label) => (blank(v) ? null : num(v, label, 20, 250, errors));
  const out = {
    date: date(input.date, errors),
    waistCm: cm(input.waistCm, 'Waist'),
    neckCm: cm(input.neckCm, 'Neck'),
    hipCm: cm(input.hipCm, 'Hips'),
  };
  if (out.waistCm === null && out.neckCm === null && out.hipCm === null) errors.push('Enter at least one measurement.');
  return done(errors, out);
}

/** Daily check-in: any of sleep hours, sleep quality, mood and a note. */
export function validateCheckin(input = {}) {
  const errors = [];
  const scale = (v, label) => (blank(v) ? null : Math.round(num(v, label, 1, 5, errors) ?? 0));
  const out = {
    date: date(input.date, errors),
    sleepHours: blank(input.sleepHours) ? null : num(input.sleepHours, 'Sleep', 0, 24, errors),
    sleepQuality: scale(input.sleepQuality, 'Sleep quality'),
    mood: scale(input.mood, 'Mood'),
    note: text(input.note, 200),
  };
  if (out.sleepHours === null && out.sleepQuality === null && out.mood === null && !out.note) {
    errors.push('Fill in at least one of sleep, mood or a note.');
  }
  return done(errors, out);
}

/** An ISO timestamp, as sent by the client's clock. */
export function validateTime(value, label = 'Time') {
  const t = Date.parse(value);
  if (typeof value !== 'string' || Number.isNaN(t)) throw new ValidationError([`${label} must be a date and time.`]);
  return new Date(t).toISOString();
}

/**
 * A food the user saves from a nutrition label. Values may be given per
 * 100 g or per serving (`per: 'serving'` with `servingGrams`); they are
 * always stored per 100 g.
 */
export function validateCustomFood(input = {}) {
  const errors = [];
  const name = text(input.name, 60);
  if (!name) errors.push('Name is required.');
  const servingUnit = text(input.servingUnit, 20).toLowerCase() || 'serving';
  const hasServing = input.servingGrams !== undefined && input.servingGrams !== null && input.servingGrams !== '';
  const servingGrams = hasServing ? num(input.servingGrams, 'Serving size', 1, 2000, errors) : null;
  const perServing = input.per === 'serving';
  if (perServing && !hasServing) errors.push('Enter the serving size in grams to use per-serving values.');

  const limit = perServing ? 5000 : 900; // nothing is over 900 kcal per 100 g
  const kcal = num(input.kcal, 'Calories', 0, limit, errors);
  const protein = num(input.protein ?? 0, 'Protein', 0, perServing ? 500 : 100, errors);
  const carbs = num(input.carbs ?? 0, 'Carbs', 0, perServing ? 1000 : 100, errors);
  const fat = num(input.fat ?? 0, 'Fat', 0, perServing ? 500 : 100, errors);
  done(errors);

  const to100 = (x) => (perServing ? Math.round((x / servingGrams) * 10000) / 100 : x);
  return {
    name,
    kcal: to100(kcal),
    protein: to100(protein),
    carbs: to100(carbs),
    fat: to100(fat),
    servingUnit: hasServing ? servingUnit : null,
    servingGrams,
  };
}
