// Pull per-100 g nutrition for the generic foods from USDA FoodData Central
// (SR Legacy dataset) and write core/usda-data.js. Each food is matched by its
// exact USDA description, so every value can be traced to an FDC ID.
//
//   FDC_API_KEY=your-key node scripts/fetch-usda.js
//
// Without a key it uses the shared DEMO_KEY, which allows about 30 requests an
// hour; foods are fetched in batches of related words to stay well under that.
import { writeFileSync } from 'node:fs';

const KEY = process.env.FDC_API_KEY ?? 'DEMO_KEY';

// [id used in core/foods.js, exact SR Legacy description]
export const USDA_FOODS = [
  // grains and starches
  ['rice-white', 'Rice, white, long-grain, regular, enriched, cooked'],
  ['rice-brown', 'Rice, brown, long-grain, cooked'],
  ['rice-glutinous', 'Rice, white, glutinous, unenriched, cooked'],
  ['oats', 'Cereals, oats, regular and quick, not fortified, dry'],
  ['bread-white', 'Bread, white, commercially prepared (includes soft bread crumbs)'],
  ['bread-wholemeal', 'Bread, whole-wheat, commercially prepared'],
  ['pasta', 'Pasta, cooked, enriched, without added salt'],
  ['noodles-egg', 'Noodles, egg, cooked, enriched'],
  ['noodles-rice', 'Rice noodles, cooked'],
  ['sweet-potato', 'Sweet potato, cooked, boiled, without skin'],
  ['potato', 'Potatoes, boiled, cooked in skin, flesh, without salt'],
  ['corn', 'Corn, sweet, yellow, cooked, boiled, drained, without salt'],
  // protein
  ['egg-boiled', 'Egg, whole, cooked, hard-boiled'],
  ['egg-fried', 'Egg, whole, cooked, fried'],
  ['egg-scrambled', 'Egg, whole, cooked, scrambled'],
  ['chicken-breast', 'Chicken, broilers or fryers, breast, meat only, cooked, roasted'],
  ['chicken-thigh', 'Chicken, broilers or fryers, thigh, meat only, cooked, roasted'],
  ['salmon', 'Fish, salmon, Atlantic, farmed, cooked, dry heat'],
  ['tuna-can', 'Fish, tuna, light, canned in water, drained solids'],
  ['tilapia', 'Fish, tilapia, cooked, dry heat'],
  ['shrimp', 'Crustaceans, shrimp, mixed species, cooked, moist heat'],
  ['beef-lean', 'Beef, ground, 90% lean meat / 10% fat, patty, cooked, broiled'],
  ['pork-loin', 'Pork, fresh, loin, whole, separable lean and fat, cooked, roasted'],
  ['tofu-firm', 'Tofu, firm, prepared with calcium sulfate'],
  ['tofu-soft', 'Tofu, soft, prepared with calcium sulfate and magnesium chloride (nigari)'],
  // dairy and drinks (per 100 g; 100 ml of these weighs 100-103 g)
  ['milk-whole', 'Milk, whole, 3.25% milkfat, with added vitamin D'],
  ['milk-lowfat', 'Milk, lowfat, fluid, 1% milkfat, with added vitamin A and vitamin D'],
  ['milk-skim', 'Milk, nonfat, fluid, with added vitamin A and vitamin D (fat free or skim)'],
  ['soy-milk', 'Soymilk, original and vanilla, unfortified'],
  ['yogurt-greek', 'Yogurt, Greek, plain, nonfat'],
  ['yogurt-plain', 'Yogurt, plain, whole milk'],
  ['cheddar', 'Cheese, cheddar'],
  ['orange-juice', 'Orange juice, raw'],
  ['cola', 'Beverages, carbonated, cola, regular'],
  ['beer', 'Alcoholic beverage, beer, regular, all'],
  ['condensed-milk', 'Milk, canned, condensed, sweetened'],
  // fruit
  ['banana', 'Bananas, raw'],
  ['apple', 'Apples, raw, with skin'],
  ['orange', 'Oranges, raw, all commercial varieties'],
  ['papaya', 'Papayas, raw'],
  ['watermelon', 'Watermelon, raw'],
  ['mango', 'Mangos, raw'],
  ['grapes', 'Grapes, red or green (European type, such as Thompson seedless), raw'],
  ['pineapple', 'Pineapple, raw, all varieties'],
  ['durian', 'Durian, raw or frozen'],
  ['avocado', 'Avocados, raw, all commercial varieties'],
  ['guava', 'Guavas, common, raw'],
  // vegetables
  ['broccoli', 'Broccoli, cooked, boiled, drained, without salt'],
  ['chinese-broccoli', 'Broccoli, chinese, cooked'],
  ['spinach', 'Spinach, cooked, boiled, drained, without salt'],
  ['cucumber', 'Cucumber, with peel, raw'],
  ['tomato', 'Tomatoes, red, ripe, raw, year round average'],
  ['carrot', 'Carrots, raw'],
  ['lettuce', 'Lettuce, green leaf, raw'],
  // fats, spreads, sugars
  ['oil', 'Oil, canola'],
  ['butter', 'Butter, salted'],
  ['peanut-butter', 'Peanut butter, smooth style, without salt'],
  ['almonds', 'Nuts, almonds'],
  ['peanuts', 'Peanuts, all types, dry-roasted, without salt'],
  ['sugar', 'Sugars, granulated'],
  ['honey', 'Honey'],
  ['mayonnaise', 'Salad dressing, mayonnaise, regular'],
  ['ketchup', 'Catsup'],
  ['chocolate', 'Candies, milk chocolate'],
  ['chips', 'Snacks, potato chips, plain, salted'],
  ['ice-cream', 'Ice creams, vanilla'],
  ['fries', 'McDONALD\'S, french fries'],
  // added with the bigger food list
  ['croissant', 'Croissants, butter'],
  ['couscous', 'Couscous, cooked'],
  ['quinoa', 'Quinoa, cooked'],
  ['granola', 'Cereals ready-to-eat, granola, homemade'],
  ['popcorn', 'Snacks, popcorn, air-popped'],
  ['chicken-wing-fried', 'Chicken, broilers or fryers, wing, meat and skin, cooked, fried, flour'],
  ['chicken-drumstick', 'Chicken, broilers or fryers, drumstick, meat and skin, cooked, roasted'],
  ['chicken-breast-skin', 'Chicken, broilers or fryers, breast, meat and skin, cooked, roasted'],
  ['cod', 'Fish, cod, Atlantic, cooked, dry heat'],
  ['mackerel', 'Fish, mackerel, Atlantic, cooked, dry heat'],
  ['sardines', 'Fish, sardine, Atlantic, canned in oil, drained solids with bone'],
  ['salmon-raw', 'Fish, salmon, Atlantic, farmed, raw'],
  ['crab', 'Crustaceans, crab, blue, cooked, moist heat'],
  ['bacon', 'Pork, cured, bacon, pre-sliced, cooked, pan-fried'],
  ['lamb', 'Lamb, ground, cooked, broiled'],
  ['tempeh', 'Tempeh'],
  ['edamame', 'Edamame, frozen, prepared'],
  ['black-beans', 'Beans, black, mature seeds, cooked, boiled, without salt'],
  ['chickpeas', 'Chickpeas (garbanzo beans, bengal gram), mature seeds, cooked, boiled, without salt'],
  ['lentils', 'Lentils, mature seeds, cooked, boiled, without salt'],
  ['cottage-cheese', 'Cheese, cottage, lowfat, 2% milkfat'],
  ['mozzarella', 'Cheese, mozzarella, whole milk'],
  ['egg-white', 'Egg, white, raw, fresh'],
  ['wine-red', 'Alcoholic beverage, wine, table, red'],
  ['spirits', 'Alcoholic beverage, distilled, all (gin, rum, vodka, whiskey) 80 proof'],
  ['coconut-water', 'Nuts, coconut water (liquid from coconuts)'],
  ['strawberries', 'Strawberries, raw'],
  ['blueberries', 'Blueberries, raw'],
  ['pear', 'Pears, raw'],
  ['kiwi', 'Kiwifruit, green, raw'],
  ['longan', 'Longans, raw'],
  ['lychee', 'Litchis, raw'],
  ['jackfruit', 'Jackfruit, raw'],
  ['dates', 'Dates, medjool'],
  ['raisins', "Raisins, dark, seedless (Includes foods for USDA's Food Distribution Program)"],
  ['peach', 'Peaches, yellow, raw'],
  ['cherries', 'Cherries, sweet, raw'],
  ['coconut-flesh', 'Nuts, coconut meat, raw'],
  ['bok-choy', 'Cabbage, chinese (pak-choi), cooked, boiled, drained, without salt'],
  ['cabbage', 'Cabbage, cooked, boiled, drained, without salt'],
  ['green-beans', 'Beans, snap, green, cooked, boiled, drained, without salt'],
  ['mushrooms', 'Mushrooms, white, cooked, boiled, drained, without salt'],
  ['shiitake', 'Mushrooms, shiitake, cooked, without salt'],
  ['eggplant', 'Eggplant, cooked, boiled, drained, without salt'],
  ['bean-sprouts', 'Mung beans, mature seeds, sprouted, raw'],
  ['onion', 'Onions, raw'],
  ['bell-pepper', 'Peppers, sweet, red, raw'],
  ['pumpkin', 'Pumpkin, cooked, boiled, drained, without salt'],
  ['peas', 'Peas, green, frozen, cooked, boiled, drained, without salt'],
  ['cauliflower', 'Cauliflower, cooked, boiled, drained, without salt'],
  ['okra', 'Okra, cooked, boiled, drained, without salt'],
  ['cashews', 'Nuts, cashew nuts, dry roasted, without salt added'],
  ['walnuts', 'Nuts, walnuts, english'],
  ['chia', 'Seeds, chia seeds, dried'],
  ['jam', 'Jams and preserves'],
  ['soy-sauce', 'Soy sauce made from soy and wheat (shoyu)'],
  ['oyster-sauce', 'Sauce, oyster, ready-to-serve'],
  ['baked-beans', 'Beans, baked, canned, plain or vegetarian'],
];

const NUTRIENTS = { 208: 'kcal', 203: 'protein', 205: 'carbs', 204: 'fat' };
const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();

async function search(query) {
  const url = new URL('https://api.nal.usda.gov/fdc/v1/foods/search');
  url.search = new URLSearchParams({
    api_key: KEY,
    query,
    dataType: 'SR Legacy',
    pageSize: '200',
    requireAllWords: 'false',
  });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FDC ${res.status}: ${await res.text()}`);
  return (await res.json()).foods ?? [];
}

function values(food) {
  const out = {};
  for (const n of food.foodNutrients) {
    const key = NUTRIENTS[n.nutrientNumber];
    if (key) out[key] = n.value;
  }
  return out;
}

const pending = new Map(USDA_FOODS.map(([id, desc]) => [norm(desc), id]));
const found = {};
let requests = 0;
const BUDGET = Number(process.env.FDC_BUDGET ?? 28);

let limited = false;
async function collect(query) {
  if (requests >= BUDGET || limited) return;
  requests += 1;
  let foods;
  try {
    foods = await search(query);
  } catch (err) {
    console.error(err.message.split('\n')[0]);
    limited = true;
    return;
  }
  for (const f of foods) {
    const key = pending.get(norm(f.description));
    if (key && !found[key]) found[key] = { fdcId: f.fdcId, description: f.description, ...values(f) };
  }
}

const words = (desc) => desc.split(',')[0].replace(/[()%/']/g, ' ').trim();

// First pass: the leading word of several foods OR-ed into one search.
for (let i = 0; i < USDA_FOODS.length; i += 6) {
  const batch = USDA_FOODS.slice(i, i + 6).filter(([id]) => !found[id]);
  if (batch.length) await collect(batch.map(([, d]) => words(d)).join(' '));
}
// Second pass: the full description of anything still missing.
for (const [id, desc] of USDA_FOODS) {
  if (!found[id]) await collect(desc.replace(/[(),%/']/g, ' '));
}
console.log(`${requests} requests used`);

const missing = USDA_FOODS.filter(([id]) => !found[id]);
if (missing.length) {
  console.error('Not found this run (kept the existing values):');
  for (const [id, desc] of missing) console.error(`  ${id}: ${desc}`);
}

// Report every value that changed against the current file, then merge.
const { USDA: current } = await import('../core/usda-data.js');
for (const [id, f] of Object.entries(found)) {
  const old = current[id];
  const diffs = ['kcal', 'protein', 'carbs', 'fat'].filter((k) => !old || Math.abs(old[k] - f[k]) > 0.05);
  if (diffs.length) console.log(`changed ${id}: ${diffs.map((k) => `${k} ${old?.[k]} -> ${f[k]}`).join(', ')}`);
}

const lines = USDA_FOODS.filter(([id]) => found[id] || current[id]).map(([id, desc]) => {
  const f = found[id] ?? current[id];
  return `  '${id}': { fdcId: ${f.fdcId}, kcal: ${f.kcal}, protein: ${f.protein}, carbs: ${f.carbs}, fat: ${f.fat} }, // ${f.description ?? desc}`;
});
writeFileSync(
  new URL('../core/usda-data.js', import.meta.url),
  `// Generated by scripts/fetch-usda.js from USDA FoodData Central (SR Legacy).
// Values per 100 g. Do not edit by hand; re-run the script instead.
export const USDA = {
${lines.join('\n')}
};
`,
);
console.log(`Wrote ${lines.length} foods to core/usda-data.js`);
