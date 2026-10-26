// Open Food Facts: a free, crowd-sourced database of packaged-food labels.
// Used for brands and products that aren't in the built-in list. Values are
// per 100 g from the label; products with missing or impossible numbers are
// skipped rather than guessed.

const FIELDS = 'code,product_name,product_name_en,brands,serving_size,serving_quantity,nutriments';
const USER_AGENT = 'SteadyTracker/1.0 (https://github.com/EthanYap123/calorie-weight-tracker)';

export const isBarcode = (text) => /^\d{8,14}$/.test(String(text).trim());

/** Full-text search, newest service first. Each URL returns a different JSON shape. */
export function searchUrls(query, size = 10) {
  const q = encodeURIComponent(query);
  return [
    { url: `https://search.openfoodfacts.org/search?q=${q}&page_size=${size}&fields=${FIELDS}`, list: (j) => j.hits },
    {
      url: `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${q}&search_simple=1&action=process&json=1&page_size=${size}&fields=${FIELDS}`,
      list: (j) => j.products,
    },
  ];
}

export function productUrl(code) {
  return `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${FIELDS}`;
}

/**
 * Turn an Open Food Facts product into the app's food shape, or null when
 * its label data is missing or doesn't add up.
 */
export function offProductToFood(p) {
  const n = p?.nutriments ?? {};
  const name = String(p?.product_name_en || p?.product_name || '').trim();
  if (!name || !p.code) return null;

  let kcal = Number(n['energy-kcal_100g']);
  if (!Number.isFinite(kcal) && Number.isFinite(Number(n.energy_100g))) kcal = Number(n.energy_100g) / 4.184;
  const protein = Number(n.proteins_100g ?? 0);
  const carbs = Number(n.carbohydrates_100g ?? 0);
  const fat = Number(n.fat_100g ?? 0);
  if (![kcal, protein, carbs, fat].every(Number.isFinite)) return null;
  if (kcal < 0 || kcal > 900 || protein > 100 || carbs > 100 || fat > 100) return null;
  // Reject labels whose calories don't fit their macros (typos, kJ entered as kcal).
  const fromMacros = 4 * protein + 4 * carbs + 9 * fat;
  if (Math.abs(kcal - fromMacros) > Math.max(30, kcal * 0.25)) return null;

  const brand = Array.isArray(p.brands) ? p.brands[0] : String(p.brands ?? '').split(',')[0];
  const label = brand && !name.toLowerCase().includes(brand.trim().toLowerCase()) ? `${name} (${brand.trim()})` : name;
  const serving = Number(p.serving_quantity);
  const r2 = (x) => Math.round(x * 100) / 100;

  return {
    id: `off-${p.code}`,
    name: label.slice(0, 60),
    aliases: [],
    kcal: Math.round(kcal),
    protein: r2(protein),
    carbs: r2(carbs),
    fat: r2(fat),
    density: 1,
    portions: serving > 0 && serving <= 2000 ? [{ unit: 'serving', grams: r2(serving), note: String(p.serving_size ?? '').slice(0, 30) }] : [],
    source: { kind: 'off', code: String(p.code) },
  };
}

/** Search by name. Tries each service in turn; throws if none answers. */
export async function searchOnline(query, { fetch: f = fetch, size = 10, server = false } = {}) {
  const headers = server ? { 'user-agent': USER_AGENT } : {};
  let lastError;
  // The newer search service blocks browser requests (CORS), so browsers
  // only try the older one.
  const urls = server ? searchUrls(query, size) : searchUrls(query, size).slice(1);
  for (const { url, list } of urls) {
    try {
      const res = await f(url, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const items = list(await res.json()) ?? [];
      return items.map(offProductToFood).filter(Boolean);
    } catch (err) {
      lastError = err;
    }
  }
  const err = new Error('Online search by name is unavailable right now. Type or scan the barcode instead.');
  err.cause = lastError;
  throw err;
}

/** Look up one product by barcode. Returns null when it isn't in the database. */
export async function lookupBarcode(code, { fetch: f = fetch, server = false } = {}) {
  const res = await f(productUrl(code), { headers: server ? { 'user-agent': USER_AGENT } : {} });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Barcode lookup failed (HTTP ${res.status}).`);
  const j = await res.json();
  return j.status === 1 || j.product ? offProductToFood({ code, ...j.product }) : null;
}
