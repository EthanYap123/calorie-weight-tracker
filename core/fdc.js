// USDA FoodData Central: the US government's food database. Its search
// covers everyday dishes ("Survey (FNDDS)", e.g. baked beans), basic
// ingredients (SR Legacy, Foundation) and about 380,000 branded products
// from their labels. Unlike Open Food Facts' search it allows requests
// straight from the browser, so it works in the static app too.
//
// A free key from https://fdc.nal.usda.gov/api-key-signup allows 1,000
// requests an hour; the shared DEMO_KEY allows about 30 an hour per device.

const API = 'https://api.nal.usda.gov/fdc/v1';
const GENERIC = ['Foundation', 'SR Legacy', 'Survey (FNDDS)'];

// Unit words in FDC portion text -> the app's unit names.
const UNIT_WORDS = {
  cup: 'cup', cups: 'cup', tbsp: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp', tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  slice: 'slice', slices: 'slice', piece: 'piece', pieces: 'piece', pc: 'piece', pcs: 'piece', bar: 'bar', bars: 'bar',
  can: 'can', cans: 'can', bottle: 'bottle', packet: 'packet', package: 'packet', pkg: 'packet', container: 'container',
  serving: 'serving', servings: 'serving', bowl: 'bowl', plate: 'plate', glass: 'glass', scoop: 'scoop', scoops: 'scoop',
  cookie: 'piece', cookies: 'piece', cracker: 'piece', crackers: 'piece', egg: 'piece', patty: 'patty', link: 'piece', links: 'piece',
  oz: 'oz', small: 'small', medium: 'medium', large: 'large', fillet: 'fillet', stick: 'stick', pouch: 'packet', tub: 'tub',
};

const NUM = (s) => {
  const t = String(s ?? '').trim();
  const mixed = t.match(/^(\d+)\s+(\d+)\/(\d+)/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = t.match(/^(\d+)\/(\d+)/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const n = t.match(/^\d*\.?\d+/);
  return n ? Number(n[0]) : null;
};

export function searchUrl(query, key = 'DEMO_KEY', pageSize = 50) {
  const q = new URLSearchParams({ api_key: key || 'DEMO_KEY', query, pageSize: String(pageSize) });
  q.append('dataType', [...GENERIC, 'Branded'].join(','));
  return `${API}/foods/search?${q}`;
}

export function detailUrl(fdcId, key = 'DEMO_KEY') {
  return `${API}/food/${encodeURIComponent(fdcId)}?api_key=${encodeURIComponent(key || 'DEMO_KEY')}`;
}

/** "BAKED BEANS, ORIGINAL" -> "Baked beans, original" (branded names come in capitals). */
function tidy(text) {
  const s = String(text ?? '').trim().replace(/\s+/g, ' ');
  if (s !== s.toUpperCase()) return s;
  const lower = s.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function nutrient(list, numbers) {
  for (const num of numbers) {
    const hit = list.find((n) => String(n.nutrientNumber ?? n.nutrient?.number) === num);
    const v = hit?.value ?? hit?.amount;
    if (v !== undefined && v !== null && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

/** "2 Tbsp (32 g)" with a 32 g serving -> portions per tbsp and per serving. */
function brandedPortions(item) {
  const unitName = String(item.servingSizeUnit ?? '').toLowerCase();
  if (!['g', 'grm', 'ml', 'mlt'].includes(unitName) || !(item.servingSize > 0)) return [];
  const grams = Math.round(item.servingSize * 10) / 10;
  const household = String(item.householdServingFullText ?? '').trim();
  const portions = [{ unit: 'serving', grams, note: household.slice(0, 30) }];
  const qty = NUM(household);
  const word = household.replace(/^[\d\s./]+/, '').split(/[\s(,]/)[0]?.toLowerCase();
  const unit = UNIT_WORDS[word];
  if (qty > 0 && unit && unit !== 'serving') portions.unshift({ unit, grams: Math.round((grams / qty) * 10) / 10, note: '' });
  return portions;
}

/** One FDC search hit -> the app's food shape, or null if its numbers don't add up. */
export function fdcToFood(item) {
  const list = item?.foodNutrients ?? [];
  // Foundation foods may only report Atwater energy (957/958), not 208.
  const kcal = nutrient(list, ['208', '958', '957']);
  const protein = nutrient(list, ['203']) ?? 0;
  const carbs = nutrient(list, ['205']) ?? 0;
  const fat = nutrient(list, ['204']) ?? 0;
  const alcohol = nutrient(list, ['221']) ?? 0;
  if (kcal === null || !item.description) return null;
  if (kcal < 0 || kcal > 900 || protein > 100 || carbs > 100 || fat > 100) return null;
  const fromMacros = 4 * protein + 4 * carbs + 9 * fat + 7 * alcohol;
  if (Math.abs(kcal - fromMacros) > Math.max(30, kcal * 0.25)) return null;

  const branded = item.dataType === 'Branded';
  const brand = tidy(item.brandName || item.brandOwner || '');
  let name = tidy(item.description);
  if (branded && brand && !name.toLowerCase().includes(brand.toLowerCase())) name = `${name} (${brand})`;
  const r2 = (x) => Math.round(x * 100) / 100;

  return {
    id: `fdc-${item.fdcId}`,
    name: name.slice(0, 70),
    aliases: [],
    kcal: Math.round(kcal),
    protein: r2(protein),
    carbs: r2(carbs),
    fat: r2(fat),
    density: 1,
    portions: branded ? brandedPortions(item) : [],
    source: { kind: 'fdc', fdcId: item.fdcId, dataType: item.dataType, gtin: item.gtinUpc ?? null },
  };
}

/**
 * Household portions from a food's detail record ("1 cup" = 254 g), one per
 * unit, weights per single unit.
 */
export function fdcPortions(detail) {
  const out = [];
  for (const p of detail?.foodPortions ?? []) {
    const grams = Number(p.gramWeight);
    if (!(grams > 0)) continue;
    const measure = p.measureUnit?.name && p.measureUnit.name !== 'undetermined' ? p.measureUnit.name : '';
    const text = String(p.portionDescription || `${p.amount ?? 1} ${measure} ${p.modifier ?? ''}`).trim();
    if (/quantity not specified/i.test(text)) continue;
    const qty = NUM(text) ?? Number(p.amount) ?? 1;
    const rest = text.replace(/^[\d\s./]+/, '').trim();
    const word = rest.split(/[\s(,]/)[0]?.toLowerCase();
    const unit = UNIT_WORDS[word] ?? 'serving';
    if (out.some((x) => x.unit === unit)) continue;
    const note = rest.slice(word.length).replace(/^[\s,]+/, '').slice(0, 30);
    out.push({ unit, grams: Math.round((grams / (qty > 0 ? qty : 1)) * 10) / 10, note });
  }
  return out;
}

/** Generic foods first (most useful when logging by amount), then brands. */
export function rankResults(foods) {
  const seen = new Set();
  const unique = foods.filter((f) => {
    const k = `${f.name.toLowerCase()}|${f.kcal}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const generic = unique.filter((f) => f.source.dataType !== 'Branded').slice(0, 6);
  const branded = unique.filter((f) => f.source.dataType === 'Branded').slice(0, 8);
  return [...generic, ...branded];
}

async function getJson(f, url, retry = true) {
  const res = await f(url);
  // FDC now and then answers a valid request with a 400 or 5xx; one retry fixes it.
  if (retry && !res.ok && ![404, 429].includes(res.status)) {
    await new Promise((r) => setTimeout(r, 600));
    return getJson(f, url, false);
  }
  if (res.status === 429) throw new Error('USDA search limit reached for now. Add a free USDA key in Settings for more searches.');
  if (!res.ok) throw new Error(`USDA search failed (HTTP ${res.status}). Try again in a minute.`);
  try {
    return await res.json();
  } catch {
    // Over the limit, the gateway sometimes answers with an HTML page.
    throw new Error('USDA search is busy or over its limit. Try again in a minute, or add a free USDA key in Settings.');
  }
}

export async function searchFdc(query, { key, fetch: f = fetch } = {}) {
  const j = await getJson(f, searchUrl(query, key));
  return rankResults((j.foods ?? []).map(fdcToFood).filter(Boolean));
}

/** Add household portions to a generic food (one extra request). */
export async function withPortions(food, { key, fetch: f = fetch } = {}) {
  if (food.source.kind !== 'fdc' || food.portions.length) return food;
  const detail = await getJson(f, detailUrl(food.source.fdcId, key));
  return { ...food, portions: fdcPortions(detail) };
}

/** Find a branded product by its barcode. */
export async function fdcBarcode(code, { key, fetch: f = fetch } = {}) {
  const url = `${API}/foods/search?${new URLSearchParams({ api_key: key || 'DEMO_KEY', query: code, dataType: 'Branded', pageSize: '5' })}`;
  const j = await getJson(f, url);
  const strip = (s) => String(s ?? '').replace(/^0+/, '');
  const hit = (j.foods ?? []).find((x) => strip(x.gtinUpc) === strip(code));
  return hit ? fdcToFood(hit) : null;
}
