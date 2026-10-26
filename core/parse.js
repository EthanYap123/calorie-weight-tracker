// Turns what people type ("1 bowl white rice", "100g chicken breast",
// "2 eggs", "half a plate of chicken rice") into an amount, a unit and a
// food, then works out the grams and nutrition.
import { nutritionFor, searchFoods, singular } from './foods.js';

const NUMBER_WORDS = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  half: 0.5, quarter: 0.25, dozen: 12,
};

// What people type -> the unit name foods use. Weight and volume units are
// handled directly; the rest must match one of the food's portions.
const UNIT_ALIASES = {
  g: 'g', gm: 'g', gms: 'g', gram: 'g', grams: 'g', gramme: 'g', grammes: 'g',
  kg: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg',
  oz: 'oz', ounce: 'oz', ounces: 'oz', lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  ml: 'ml', mls: 'ml', millilitre: 'ml', milliliter: 'ml', millilitres: 'ml', milliliters: 'ml',
  l: 'l', litre: 'l', liter: 'l', litres: 'l', liters: 'l',
  bowl: 'bowl', cup: 'cup', plate: 'plate', piece: 'piece', pc: 'piece', pcs: 'piece', slice: 'slice',
  tbsp: 'tbsp', tablespoon: 'tbsp', tsp: 'tsp', teaspoon: 'tsp', scoop: 'scoop', can: 'can',
  glass: 'glass', packet: 'packet', pack: 'packet', sachet: 'sachet', stick: 'stick', tub: 'tub',
  bar: 'bar', square: 'square', serving: 'serving', portion: 'serving', fillet: 'fillet', block: 'block',
  handful: 'handful', roll: 'roll', bottle: 'bottle', carton: 'carton', pint: 'pint', patty: 'patty',
  chop: 'chop', cob: 'cob', seed: 'seed', pod: 'seed', bag: 'bag', breast: 'breast', container: 'container',
  small: 'small', medium: 'medium', large: 'large', whole: 'whole',
};

const METRIC = { g: 1, kg: 1000, oz: 28.35, lb: 453.6 };
const VOLUME = { ml: 1, l: 1000 };

function toNumber(token) {
  if (/^\d+(\.\d+)?$/.test(token)) return Number(token);
  const frac = token.match(/^(\d+)\/(\d+)$/);
  if (frac && Number(frac[2]) > 0) return Number(frac[1]) / Number(frac[2]);
  if (token in NUMBER_WORDS) return NUMBER_WORDS[token];
  return null;
}

const unitOf = (token) => UNIT_ALIASES[token] ?? UNIT_ALIASES[singular(token)] ?? null;

/**
 * @returns {{qty: number, unit: string|null, query: string}}
 */
export function parseEntry(text) {
  let t = String(text ?? '')
    .toLowerCase()
    .replace(/(\d)\s*(?=[a-z])/g, '$1 ') // "100g" -> "100 g"
    .replace(/[^a-z0-9./ ]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  let qty = null;
  let unit = null;

  // Leading amount: "1.5", "1/2", "1 1/2", "half a", "two"
  const first = t.length ? toNumber(t[0]) : null;
  if (first !== null && t.length > 1) {
    qty = first;
    t = t.slice(1);
    const second = t.length > 1 ? toNumber(t[0]) : null;
    if (second !== null && second < 1 && /\//.test(t[0])) {
      qty += second; // "1 1/2"
      t = t.slice(1);
    }
    if (qty === 0.5 && (t[0] === 'a' || t[0] === 'an')) t = t.slice(1); // "half a bowl"
    if (t.length > 1 && unitOf(t[0])) {
      unit = unitOf(t[0]);
      t = t.slice(1);
    }
    if (t[0] === 'of' && t.length > 1) t = t.slice(1);
  } else if (t.length > 1) {
    // Trailing amount: "white rice 200 g", "rice 2 bowls", "chicken rice x2"
    const last = t.at(-1);
    const times = last.match(/^x(\d+(?:\.\d+)?)$/);
    if (times) {
      qty = Number(times[1]);
      t = t.slice(0, -1);
    } else if (t.length > 2 && unitOf(last) && toNumber(t.at(-2)) !== null) {
      qty = toNumber(t.at(-2));
      unit = unitOf(last);
      t = t.slice(0, -2);
    } else if (toNumber(last) !== null && !NUMBER_WORDS[last]) {
      qty = toNumber(last);
      t = t.slice(0, -1);
    }
  }

  return { qty: qty ?? 1, unit, query: t.join(' ') };
}

const fmtQty = (q) => (Number.isInteger(q) ? String(q) : String(Math.round(q * 100) / 100));
const plural = (unit, qty) => (qty === 1 || ['g', 'kg', 'ml', 'l', 'oz', 'lb', 'tbsp', 'tsp', 'small', 'medium', 'large', 'whole', 'half'].includes(unit) ? unit : unit.endsWith('ch') || unit.endsWith('sh') || unit.endsWith('ss') ? `${unit}es` : `${unit}s`);

/** The unit choices to offer for a food: its portions, then grams (and ml for drinks). */
export function unitsFor(food) {
  const units = food.portions.map((x) => ({
    unit: x.unit,
    grams: x.grams,
    label: `${x.unit} (${x.ml ? `${x.ml} ml` : `${x.grams} g`})${x.note ? `, ${x.note}` : ''}`,
  }));
  units.push({ unit: 'g', grams: 1, label: 'grams' });
  if (food.density !== 1 || food.portions.some((x) => x.ml)) units.push({ unit: 'ml', grams: food.density, label: 'ml' });
  return units;
}

/**
 * Grams and a readable amount for `qty` of `unit` of a food. With no unit,
 * the food's first portion is used ("2 eggs" = 2 large eggs).
 * @returns {{grams: number, amount: string} | {error: string}}
 */
export function resolveAmount(food, qty, unit) {
  if (!(qty > 0)) return { error: 'Amount must be more than 0.' };
  if (unit in METRIC) {
    const grams = Math.round(qty * METRIC[unit] * 10) / 10;
    const size = unit === 'oz' || unit === 'lb' ? ` (${fmtQty(grams)} g)` : '';
    return { grams, amount: `${fmtQty(qty)} ${unit}${size}` };
  }
  if (unit in VOLUME) {
    const ml = qty * VOLUME[unit];
    return { grams: Math.round(ml * food.density * 10) / 10, amount: `${fmtQty(qty)} ${unit}` };
  }
  const portion = unit ? food.portions.find((x) => x.unit === unit) : food.portions[0];
  if (!portion) {
    const options = food.portions.map((x) => x.unit).join(', ');
    return { error: `${food.name} isn't measured in ${unit}s. Use grams${options ? ` or ${options}` : ''}.` };
  }
  const grams = Math.round(qty * portion.grams * 10) / 10;
  const size = portion.ml ? `${fmtQty(qty * portion.ml)} ml` : `${fmtQty(grams)} g`;
  return { grams, amount: `${fmtQty(qty)} ${plural(portion.unit, qty)} (${size})` };
}

/**
 * Everything the food search shows: the best foods for the typed text, each
 * with the typed amount applied.
 */
export function interpret(text, extraFoods = [], limit = 8) {
  const parsed = parseEntry(text);
  if (!parsed.query) return { parsed, results: [] };
  const results = searchFoods(parsed.query, extraFoods, limit).map((food) => applyEntry(food, parsed));
  return { parsed, results };
}

/** Apply a typed amount to one food: grams, a readable amount and nutrition. */
export function applyEntry(food, { qty, unit }) {
  // A food with no portions (a saved food without a serving size) counts
  // "1" as 100 g.
  if (!unit && !food.portions.length) {
    qty *= 100;
    unit = 'g';
  }
  const r = resolveAmount(food, qty, unit);
  return {
    food,
    qty,
    unit: unit ?? food.portions[0].unit,
    ...(r.error ? { error: r.error } : { grams: r.grams, amount: r.amount, ...nutritionFor(food, r.grams) }),
  };
}
