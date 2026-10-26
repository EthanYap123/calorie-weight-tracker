import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isBarcode, lookupBarcode, offProductToFood, searchOnline } from '../core/off.js';
import { applyEntry } from '../core/parse.js';

// Shaped like real Open Food Facts records (Marigold HL milk, barcode 8888026520014).
const HL_MILK = {
  code: '8888026520014',
  product_name: 'HL MILK',
  brands: 'Marigold',
  serving_size: '200 ml',
  serving_quantity: 200,
  nutriments: { 'energy-kcal_100g': 49, proteins_100g: 5, carbohydrates_100g: 5.5, fat_100g: 1 },
};

const json = (body, status = 200) => async () => ({ ok: status < 400, status, json: async () => body });

describe('Open Food Facts products', () => {
  test('become foods per 100 g with the label serving', () => {
    const f = offProductToFood(HL_MILK);
    assert.equal(f.id, 'off-8888026520014');
    assert.equal(f.name, 'HL MILK (Marigold)');
    assert.equal(f.kcal, 49);
    assert.deepEqual(f.portions, [{ unit: 'serving', grams: 200, note: '200 ml' }]);
    assert.equal(applyEntry(f, { qty: 1, unit: null }).kcal, 98);
  });

  test('energy in kJ only is converted to kcal', () => {
    const f = offProductToFood({ ...HL_MILK, nutriments: { energy_100g: 205, proteins_100g: 5, carbohydrates_100g: 5.5, fat_100g: 1 } });
    assert.equal(f.kcal, 49);
  });

  test('labels that do not add up are skipped, not guessed', () => {
    const noName = { ...HL_MILK, product_name: '' };
    const noEnergy = { ...HL_MILK, nutriments: { proteins_100g: 5 } };
    const kjAsKcal = { ...HL_MILK, nutriments: { ...HL_MILK.nutriments, 'energy-kcal_100g': 205 } };
    for (const p of [noName, noEnergy, kjAsKcal]) assert.equal(offProductToFood(p), null);
  });

  test('barcodes are 8 to 14 digits', () => {
    assert.ok(isBarcode('8888026520014'));
    assert.ok(!isBarcode('1 bowl rice'));
    assert.ok(!isBarcode('1234'));
  });
});

describe('Open Food Facts requests', () => {
  test('search falls back to the second service when the first fails', async () => {
    const calls = [];
    const fake = async (url) => {
      calls.push(url);
      if (url.includes('search.openfoodfacts.org')) throw new TypeError('Failed to fetch');
      return json({ products: [HL_MILK, { code: '1', product_name: 'Broken' }] })();
    };
    const foods = await searchOnline('hl milk', { fetch: fake, server: true });
    assert.equal(calls.length, 2);
    assert.deepEqual(foods.map((f) => f.id), ['off-8888026520014']);
  });

  test('browsers skip the service that blocks them', async () => {
    const calls = [];
    const fake = async (url) => (calls.push(url), json({ products: [HL_MILK] })());
    await searchOnline('hl milk', { fetch: fake });
    assert.equal(calls.length, 1);
    assert.match(calls[0], /world\.openfoodfacts\.org/);
  });

  test('search reports when no service answers', async () => {
    const down = async () => ({ ok: false, status: 503 });
    await assert.rejects(searchOnline('hl milk', { fetch: down }), /barcode instead/);
  });

  test('barcode lookup returns the product, or null when unknown', async () => {
    assert.equal((await lookupBarcode('8888026520014', { fetch: json({ status: 1, product: HL_MILK }) })).kcal, 49);
    assert.equal(await lookupBarcode('0000000000000', { fetch: json({ status: 0 }, 404) }), null);
  });
});
