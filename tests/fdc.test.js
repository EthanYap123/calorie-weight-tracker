import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { fdcBarcode, fdcPortions, fdcToFood, rankResults, searchFdc, withPortions } from '../core/fdc.js';
import { relevance, searchFoods } from '../core/foods.js';
import { applyEntry, interpret } from '../core/parse.js';

// Shaped like real FoodData Central search hits.
const nutrients = (kcal, protein, carbs, fat) => [
  { nutrientNumber: '208', value: kcal },
  { nutrientNumber: '203', value: protein },
  { nutrientNumber: '205', value: carbs },
  { nutrientNumber: '204', value: fat },
];
const BAKED_BEANS = { fdcId: 2341778, dataType: 'Survey (FNDDS)', description: 'Baked beans', foodNutrients: nutrients(105, 4.8, 20.9, 0.4) };
const GOOBER = {
  fdcId: 2100001,
  dataType: 'Branded',
  description: 'PEANUT BUTTER & GRAPE JELLY STRIPES',
  brandName: 'GOOBER',
  gtinUpc: '051500241493',
  servingSize: 37,
  servingSizeUnit: 'g',
  householdServingFullText: '2 Tbsp',
  foodNutrients: nutrients(405, 10.8, 48.6, 18.9),
};
const BAKED_BEANS_DETAIL = {
  foodPortions: [
    { portionDescription: '1 cup', gramWeight: 254 },
    { portionDescription: '1 can (16 oz)', gramWeight: 445 },
    { portionDescription: 'Quantity not specified', gramWeight: 254 },
  ],
};

const respond = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

describe('USDA FoodData Central foods', () => {
  test('generic dishes keep USDA values per 100 g', () => {
    const f = fdcToFood(BAKED_BEANS);
    assert.equal(f.id, 'fdc-2341778');
    assert.equal(f.name, 'Baked beans');
    assert.equal(f.kcal, 105);
    assert.deepEqual(f.portions, []);
  });

  test('brand labels get a tidy name and per-unit portions from the serving', () => {
    const f = fdcToFood(GOOBER);
    assert.equal(f.name, 'Peanut butter & grape jelly stripes (Goober)');
    assert.deepEqual(f.portions.map((p) => [p.unit, p.grams]), [['tbsp', 18.5], ['serving', 37]]);
    assert.equal(applyEntry(f, { qty: 2, unit: 'tbsp' }).kcal, 150);
  });

  test('records whose calories do not fit their macros are dropped', () => {
    assert.equal(fdcToFood({ ...BAKED_BEANS, foodNutrients: nutrients(440, 4.8, 20.9, 0.4) }), null);
    assert.equal(fdcToFood({ ...BAKED_BEANS, foodNutrients: [] }), null);
  });

  test('household portions come from the detail record, per single unit', () => {
    assert.deepEqual(fdcPortions(BAKED_BEANS_DETAIL), [
      { unit: 'cup', grams: 254, note: '' },
      { unit: 'can', grams: 445, note: '(16 oz)' },
    ]);
  });

  test('generic foods are listed before brands, duplicates removed', () => {
    const generic = fdcToFood(BAKED_BEANS);
    const brand = fdcToFood(GOOBER);
    assert.deepEqual(rankResults([brand, generic, { ...generic }]).map((f) => f.id), [generic.id, brand.id]);
  });
});

describe('USDA FoodData Central requests', () => {
  test('search maps the hits', async () => {
    const foods = await searchFdc('baked beans', { fetch: async () => respond({ foods: [BAKED_BEANS, GOOBER] }) });
    assert.deepEqual(foods.map((f) => f.name), ['Baked beans', 'Peanut butter & grape jelly stripes (Goober)']);
  });

  test('a one-off error is retried once', async () => {
    let calls = 0;
    const flaky = async () => (++calls === 1 ? respond({}, 400) : respond({ foods: [BAKED_BEANS] }));
    assert.equal((await searchFdc('baked beans', { fetch: flaky })).length, 1);
    assert.equal(calls, 2);
  });

  test('the rate limit says how to get more searches', async () => {
    await assert.rejects(searchFdc('x', { fetch: async () => respond({}, 429) }), /free USDA key/);
  });

  test('an HTML error page is reported, not thrown as a JSON error', async () => {
    const html = async () => ({ ok: true, status: 200, json: async () => JSON.parse('<html>') });
    await assert.rejects(searchFdc('x', { fetch: html }), /busy or over its limit/);
  });

  test('picking a generic food loads its portions', async () => {
    const f = await withPortions(fdcToFood(BAKED_BEANS), { fetch: async () => respond(BAKED_BEANS_DETAIL) });
    assert.equal(applyEntry(f, { qty: 1, unit: 'cup' }).kcal, 267);
  });

  test('barcodes match the UPC, ignoring leading zeros', async () => {
    const f = await fdcBarcode('51500241493', { fetch: async () => respond({ foods: [GOOBER] }) });
    assert.equal(f.id, 'fdc-2100001');
    assert.equal(await fdcBarcode('999', { fetch: async () => respond({ foods: [GOOBER] }) }), null);
  });
});

describe('forgiving search', () => {
  test('one typo per word is forgiven', () => {
    assert.equal(searchFoods('ebans')[0].id, 'baked-beans');
    assert.equal(searchFoods('chiken rice')[0].id, 'chicken-rice');
    assert.equal(searchFoods('laska')[0].id, 'laksa');
  });

  test('short words must still match exactly', () => {
    assert.ok(!searchFoods('tex').some((f) => f.id === 'teh'));
  });

  test('ounces and pounds convert to grams', () => {
    assert.equal(interpret('4 oz chicken breast').results[0].amount, '4 oz (113.4 g)');
  });

  test('online results are ordered by how many words match', () => {
    const goober = fdcToFood(GOOBER);
    assert.equal(relevance(goober, 'goober peanut butter'), 1);
    assert.equal(relevance(fdcToFood(BAKED_BEANS), 'goober peanut butter'), 0);
  });
});
