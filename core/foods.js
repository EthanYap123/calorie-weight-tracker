// Food database. Every food stores nutrition per 100 g, plus named portions
// with real weights, so "1 bowl white rice" and "200g white rice" log the
// same 260 kcal.
//
// Generic foods come from USDA FoodData Central (core/usda-data.js).
// Hawker dishes and drinks are typical stall portions: plates vary, so they
// are marked as estimates and can always be logged by weight instead.
import { USDA } from './usda-data.js';

/**
 * A portion. `grams` is its weight; drinks may give `ml` instead, which is
 * turned into grams with the food's density.
 */
const p = (unit, amount, note = '') =>
  typeof amount === 'number' ? { unit, grams: amount, note } : { unit, note, ...amount };

function usda(id, name, aliases, portions, density = 1) {
  const v = USDA[id];
  if (!v) throw new Error(`Missing USDA values for ${id}`);
  return {
    id,
    name,
    aliases,
    kcal: v.kcal,
    protein: v.protein,
    carbs: v.carbs,
    fat: v.fat,
    density,
    portions: withGrams(portions, density),
    source: { kind: 'usda', fdcId: v.fdcId },
  };
}

/** A dish given per portion; per-100 g values are worked out from its weight. */
function dish(id, name, aliases, portion, kcal, protein, carbs, fat, more = [], density = 1) {
  const [first] = withGrams([portion], density);
  const per100 = (x) => Math.round((x / first.grams) * 10000) / 100;
  return {
    id,
    name,
    aliases,
    kcal: per100(kcal),
    protein: per100(protein),
    carbs: per100(carbs),
    fat: per100(fat),
    density,
    portions: withGrams([portion, ...more], density),
    source: { kind: 'typical' },
  };
}

function withGrams(portions, density) {
  return portions.map((x) => (x.ml ? { ...x, grams: Math.round(x.ml * density) } : x));
}

const glass = (ml = 250) => p('glass', { ml });
const cup = (ml = 240) => p('cup', { ml });

export const FOODS = [
  // ---------- rice, noodles, bread ----------
  usda('rice-white', 'White rice (cooked)', ['rice', 'white rice', 'steamed rice', 'plain rice'], [
    p('bowl', 200, 'Chinese rice bowl, filled'), p('cup', 158), p('scoop', 120, 'hawker rice scoop'),
  ]),
  usda('rice-brown', 'Brown rice (cooked)', ['brown rice'], [p('bowl', 200), p('cup', 195)]),
  usda('rice-glutinous', 'Glutinous rice (cooked)', ['glutinous rice', 'sticky rice', 'pulut'], [p('bowl', 200), p('cup', 174)]),
  usda('oats', 'Oats (rolled, dry)', ['oats', 'oatmeal', 'rolled oats', 'porridge oats', 'quick oats'], [
    p('serving', 40, 'half a cup'), p('cup', 81), p('tbsp', 5),
  ]),
  usda('bread-white', 'White bread', ['bread', 'white bread', 'toast'], [p('slice', 28)]),
  usda('bread-wholemeal', 'Wholemeal bread', ['wholemeal bread', 'whole wheat bread', 'brown bread', 'wholegrain bread'], [p('slice', 32)]),
  usda('pasta', 'Pasta / spaghetti (cooked)', ['pasta', 'spaghetti', 'penne', 'macaroni'], [p('cup', 140), p('plate', 250)]),
  usda('noodles-egg', 'Egg noodles / yellow mee (cooked)', ['egg noodles', 'yellow noodles', 'mee', 'noodles', 'ramen noodles'], [p('bowl', 200), p('cup', 160)]),
  usda('noodles-rice', 'Rice noodles: bee hoon, kway teow (cooked)', ['bee hoon', 'beehoon', 'kway teow', 'rice noodles', 'vermicelli', 'rice vermicelli', 'pho noodles'], [p('bowl', 200), p('cup', 176)]),
  usda('sweet-potato', 'Sweet potato (boiled)', ['sweet potato', 'sweet potatoes'], [p('medium', 150), p('small', 100), p('large', 200)]),
  usda('potato', 'Potato (boiled)', ['potato', 'potatoes'], [p('medium', 170), p('small', 120), p('large', 300)]),
  usda('corn', 'Sweet corn (cooked)', ['corn', 'sweet corn', 'corn on the cob'], [p('cob', 90), p('cup', 164)]),

  // ---------- eggs, meat, fish, tofu ----------
  usda('egg-boiled', 'Egg (boiled)', ['egg', 'boiled egg', 'hard boiled egg', 'soft boiled egg', 'half boiled egg', 'hard-boiled egg'], [
    p('large', 50), p('medium', 44), p('small', 38),
  ]),
  usda('egg-fried', 'Egg (fried)', ['fried egg', 'sunny side up', 'telur mata'], [p('large', 46), p('medium', 40)]),
  usda('egg-scrambled', 'Scrambled eggs', ['scrambled egg', 'scrambled eggs', 'omelette'], [p('serving', 120, '2 eggs'), p('cup', 220)]),
  usda('chicken-breast', 'Chicken breast (skinless, roasted or grilled)', ['chicken breast', 'grilled chicken', 'chicken'], [
    p('piece', 120, 'palm-sized fillet'), p('breast', 172, 'half a breast'),
  ]),
  usda('chicken-thigh', 'Chicken thigh (skinless, roasted)', ['chicken thigh', 'chicken leg'], [p('piece', 100, 'boneless thigh')]),
  usda('salmon', 'Salmon (baked or grilled)', ['salmon', 'salmon fillet'], [p('fillet', 150)]),
  usda('tuna-can', 'Tuna, canned in water (drained)', ['tuna', 'canned tuna', 'tuna in water'], [p('can', 120, '150 g can, drained')]),
  usda('tilapia', 'White fish, e.g. tilapia (cooked)', ['fish', 'white fish', 'tilapia', 'fish fillet'], [p('fillet', 120)]),
  usda('shrimp', 'Prawns (cooked)', ['prawns', 'prawn', 'shrimp', 'shrimps'], [p('piece', 15, 'large prawn, peeled'), p('cup', 145)]),
  usda('beef-lean', 'Beef, lean mince (cooked)', ['beef', 'minced beef', 'ground beef', 'beef patty', 'mince'], [p('patty', 90), p('serving', 100)]),
  usda('pork-loin', 'Pork loin (cooked)', ['pork', 'pork chop', 'pork loin'], [p('piece', 100), p('chop', 150)]),
  usda('tofu-firm', 'Tofu, firm (tau kwa)', ['tofu', 'firm tofu', 'tau kwa', 'taukwa', 'beancurd', 'bean curd'], [p('piece', 100), p('block', 300)]),
  usda('tofu-soft', 'Tofu, soft or silken', ['soft tofu', 'silken tofu', 'tau hu'], [p('block', 300), p('cup', 250)]),

  // ---------- dairy and drinks ----------
  usda('milk-whole', 'Milk, full cream', ['milk', 'full cream milk', 'whole milk', 'fresh milk'], [glass(), cup(), p('carton', { ml: 1000 })], 1.03),
  usda('milk-lowfat', 'Milk, low fat (1%)', ['low fat milk', 'lowfat milk', 'light milk', 'hi-lo milk'], [glass(), cup()], 1.03),
  usda('milk-skim', 'Milk, skim', ['skim milk', 'skimmed milk', 'fat free milk', 'non fat milk'], [glass(), cup()], 1.03),
  usda('soy-milk', 'Soy milk (original)', ['soy milk', 'soya milk', 'soya bean milk', 'soybean milk', 'tau huay chui'], [glass(), cup(), p('packet', { ml: 250 })], 1.03),
  usda('yogurt-greek', 'Greek yoghurt (plain, non-fat)', ['greek yogurt', 'greek yoghurt', 'yoghurt', 'yogurt'], [p('tub', 170), p('cup', 245), p('tbsp', 15)]),
  usda('yogurt-plain', 'Yoghurt (plain, whole milk)', ['plain yogurt', 'plain yoghurt', 'natural yogurt'], [p('cup', 245), p('tub', 150)]),
  usda('cheddar', 'Cheddar cheese', ['cheese', 'cheddar', 'cheese slice'], [p('slice', 21)]),
  usda('orange-juice', 'Orange juice', ['orange juice', 'oj', 'juice'], [glass(), cup(), p('bottle', { ml: 350 })], 1.04),
  usda('cola', 'Soft drink, cola (regular)', ['coke', 'coca cola', 'cola', 'pepsi', 'soft drink', 'soda'], [p('can', { ml: 330 }), p('bottle', { ml: 500 }), glass()], 1.04),
  usda('beer', 'Beer (regular)', ['beer', 'tiger', 'lager'], [p('can', { ml: 330 }), p('bottle', { ml: 640, note: 'large' }), p('pint', { ml: 568 }), glass()], 1.01),
  usda('condensed-milk', 'Sweetened condensed milk', ['condensed milk'], [p('tbsp', 19), p('tsp', 6)]),

  // ---------- fruit ----------
  usda('banana', 'Banana', ['banana', 'bananas'], [p('medium', 118), p('small', 101), p('large', 136)]),
  usda('apple', 'Apple', ['apple', 'apples'], [p('medium', 182), p('small', 149), p('large', 223)]),
  usda('orange', 'Orange', ['orange', 'oranges', 'mandarin'], [p('medium', 131), p('large', 184)]),
  usda('papaya', 'Papaya', ['papaya'], [p('slice', 150), p('cup', 145, 'cubed')]),
  usda('watermelon', 'Watermelon', ['watermelon'], [p('slice', 280, 'wedge'), p('cup', 152, 'diced')]),
  usda('mango', 'Mango', ['mango', 'mangoes'], [p('whole', 200, 'flesh of a medium mango'), p('cup', 165)]),
  usda('grapes', 'Grapes', ['grapes', 'grape'], [p('cup', 151), p('piece', 5)]),
  usda('pineapple', 'Pineapple', ['pineapple'], [p('slice', 84), p('cup', 165)]),
  usda('durian', 'Durian', ['durian'], [p('seed', 30, 'one pod of flesh')]),
  usda('avocado', 'Avocado', ['avocado'], [p('half', 100), p('whole', 200)]),
  usda('guava', 'Guava', ['guava'], [p('medium', 150)]),

  // ---------- vegetables ----------
  usda('broccoli', 'Broccoli (boiled)', ['broccoli'], [p('cup', 156), p('plate', 150)]),
  usda('chinese-broccoli', 'Kai lan (boiled, no oil)', ['kai lan', 'kailan', 'chinese broccoli'], [p('plate', 150), p('cup', 88)]),
  usda('spinach', 'Spinach (boiled)', ['spinach', 'bayam'], [p('cup', 180), p('plate', 150)]),
  usda('cucumber', 'Cucumber', ['cucumber'], [p('cup', 104, 'sliced'), p('whole', 300)]),
  usda('tomato', 'Tomato', ['tomato', 'tomatoes'], [p('medium', 123), p('cup', 180)]),
  usda('carrot', 'Carrot', ['carrot', 'carrots'], [p('medium', 61), p('cup', 128)]),
  usda('lettuce', 'Lettuce / salad leaves', ['lettuce', 'salad', 'salad leaves', 'greens'], [p('bowl', 85), p('cup', 36)]),
  dish('stirfry-greens', 'Stir-fried greens (with oil)', ['stir fried vegetables', 'stir-fried vegetables', 'vegetables', 'veg', 'cai xin', 'xiao bai cai', 'kangkong'],
    p('plate', 150), 105, 3, 6, 7.5),

  // ---------- fats, spreads, sugar, snacks ----------
  usda('oil', 'Cooking oil', ['oil', 'cooking oil', 'vegetable oil', 'canola oil', 'olive oil'], [p('tbsp', 14), p('tsp', 4.5)]),
  usda('butter', 'Butter', ['butter'], [p('tbsp', 14), p('tsp', 5)]),
  usda('peanut-butter', 'Peanut butter', ['peanut butter', 'pb'], [p('tbsp', 16), p('tsp', 5)]),
  usda('almonds', 'Almonds', ['almonds', 'almond', 'nuts'], [p('handful', 28, 'about 23 almonds'), p('piece', 1.2)]),
  usda('peanuts', 'Peanuts (roasted)', ['peanuts', 'peanut', 'groundnuts'], [p('handful', 28), p('tbsp', 9)]),
  usda('sugar', 'Sugar', ['sugar', 'white sugar'], [p('tsp', 4), p('tbsp', 12.5)]),
  usda('honey', 'Honey', ['honey'], [p('tbsp', 21), p('tsp', 7)]),
  usda('mayonnaise', 'Mayonnaise', ['mayonnaise', 'mayo'], [p('tbsp', 14)]),
  usda('ketchup', 'Ketchup', ['ketchup', 'tomato sauce', 'catsup'], [p('tbsp', 17), p('sachet', 9)]),
  dish('kaya', 'Kaya (coconut jam)', ['kaya', 'coconut jam'], p('tbsp', 20), 61, 0.6, 11, 1.6),
  usda('chocolate', 'Milk chocolate', ['chocolate', 'milk chocolate', 'chocolate bar'], [p('bar', 44), p('square', 7)]),
  usda('chips', 'Potato chips', ['chips', 'potato chips', 'crisps'], [p('packet', 30, 'small'), p('bag', 150, 'large')]),
  usda('ice-cream', 'Ice cream (vanilla)', ['ice cream', 'vanilla ice cream'], [p('scoop', 66), p('cup', 132)]),
  usda('fries', 'French fries (fast food)', ['fries', 'french fries', 'mcdonalds fries'], [p('medium', 117), p('small', 71), p('large', 154)]),
  dish('pizza', 'Pizza, pepperoni', ['pizza', 'pepperoni pizza'], p('slice', 107), 290, 12, 33, 12),
  dish('instant-noodles', 'Instant noodles (with seasoning)', ['instant noodles', 'maggi', 'maggi mee', 'cup noodles', 'indomie'], p('packet', 85), 380, 8, 52, 15),
  dish('whey', 'Whey protein powder', ['protein shake', 'whey', 'protein powder', 'whey protein'], p('scoop', 30), 120, 24, 3, 1.5),
  dish('fishball', 'Fishball', ['fishball', 'fish ball', 'fishballs', 'fish balls'], p('piece', 12), 11, 1.2, 1, 0.25),

  // ---------- hawker dishes (typical portions, estimates) ----------
  dish('chicken-rice', 'Chicken rice (steamed)', ['chicken rice', 'hainanese chicken rice', 'steamed chicken rice'], p('plate', 380), 607, 25, 75, 23),
  dish('chicken-rice-roasted', 'Chicken rice (roasted)', ['roasted chicken rice', 'roast chicken rice'], p('plate', 380), 650, 28, 75, 27),
  dish('nasi-lemak', 'Nasi lemak (chicken wing, egg, ikan bilis)', ['nasi lemak'], p('plate', 400), 760, 26, 80, 37),
  dish('char-kway-teow', 'Char kway teow', ['char kway teow', 'ckt', 'fried kway teow'], p('plate', 384), 744, 23, 76, 38),
  dish('hokkien-mee', 'Fried Hokkien prawn mee', ['hokkien mee', 'fried hokkien mee', 'hokkien prawn mee'], p('plate', 380), 617, 18, 69, 30),
  dish('laksa', 'Laksa', ['laksa', 'curry laksa'], p('bowl', 520), 589, 22, 55, 32),
  dish('mee-rebus', 'Mee rebus', ['mee rebus'], p('bowl', 500), 556, 20, 82, 16),
  dish('mee-siam', 'Mee siam', ['mee siam'], p('plate', 450), 519, 17, 75, 17),
  dish('wanton-mee', 'Wanton mee (dry)', ['wanton mee', 'wonton noodles', 'wanton noodles'], p('plate', 300), 409, 15, 58, 13),
  dish('fishball-noodles', 'Fishball noodles (soup)', ['fishball noodles', 'fishball noodle soup', 'fishball mee'], p('bowl', 550), 360, 18, 60, 5),
  dish('bak-chor-mee', 'Bak chor mee (dry)', ['bak chor mee', 'minced meat noodles', 'bcm'], p('bowl', 330), 511, 24, 60, 19),
  dish('fish-soup', 'Sliced fish soup (no rice)', ['fish soup', 'sliced fish soup'], p('bowl', 500), 198, 28, 8, 6),
  dish('yong-tau-foo', 'Yong tau foo (soup, 6 pieces)', ['yong tau foo', 'ytf'], p('bowl', 500), 343, 22, 30, 15),
  dish('economy-rice', 'Economy rice (1 meat, 2 veg)', ['economy rice', 'cai fan', 'chap chye png', 'mixed rice'], p('plate', 450), 638, 25, 85, 22),
  dish('duck-rice', 'Duck rice', ['duck rice', 'braised duck rice'], p('plate', 400), 665, 30, 80, 25),
  dish('char-siew-rice', 'Char siew rice', ['char siew rice', 'char siu rice', 'bbq pork rice'], p('plate', 370), 592, 24, 88, 16),
  dish('curry-rice', 'Hainanese curry rice', ['curry rice', 'hainanese curry rice'], p('plate', 450), 720, 25, 90, 28),
  dish('nasi-goreng', 'Nasi goreng', ['nasi goreng'], p('plate', 350), 637, 20, 82, 25),
  dish('mee-goreng', 'Mee goreng', ['mee goreng'], p('plate', 350), 664, 18, 85, 28),
  dish('fried-rice', 'Egg fried rice', ['fried rice', 'egg fried rice', 'yang chow fried rice'], p('plate', 350), 597, 17, 85, 21),
  dish('beef-hor-fun', 'Beef hor fun', ['hor fun', 'beef hor fun', 'wat dan hor'], p('plate', 450), 698, 27, 80, 30),
  dish('ban-mian', 'Ban mian (soup)', ['ban mian', 'pan mee'], p('bowl', 550), 470, 22, 64, 14),
  dish('thunder-tea-rice', 'Thunder tea rice', ['thunder tea rice', 'lei cha'], p('bowl', 450), 469, 18, 70, 13),
  dish('briyani', 'Chicken briyani', ['briyani', 'biryani', 'chicken briyani', 'nasi briyani'], p('plate', 500), 876, 38, 100, 36),
  dish('prata-plain', 'Roti prata (plain)', ['prata', 'roti prata', 'plain prata', 'roti canai'], p('piece', 60), 214, 4, 27, 10),
  dish('prata-egg', 'Roti prata (egg)', ['egg prata', 'prata telur'], p('piece', 90), 266, 8, 27, 14),
  dish('thosai', 'Thosai (plain)', ['thosai', 'dosa'], p('piece', 80), 181, 4, 30, 5),
  dish('satay', 'Chicken satay (no sauce)', ['satay', 'chicken satay'], p('stick', 12), 40, 4, 1, 2.2),
  dish('carrot-cake', 'Fried carrot cake (white)', ['carrot cake', 'chai tow kway', 'fried carrot cake'], p('plate', 300), 539, 10, 55, 31),
  dish('oyster-omelette', 'Oyster omelette', ['oyster omelette', 'orh luak'], p('plate', 250), 690, 20, 40, 50),
  dish('popiah', 'Popiah', ['popiah'], p('roll', 130), 188, 6, 30, 5),
  dish('chwee-kueh', 'Chwee kueh (with chye poh)', ['chwee kueh', 'chwee kway'], p('piece', 50), 75, 1.2, 12.5, 2.2),
  dish('curry-puff', 'Curry puff', ['curry puff', 'epok epok'], p('piece', 70), 246, 5, 25, 14),
  dish('kaya-toast', 'Kaya butter toast', ['kaya toast', 'kaya butter toast'], p('serving', 60, '2 half slices'), 193, 3, 25, 9),
  dish('ice-kachang', 'Ice kachang', ['ice kachang', 'ais kacang', 'abc'], p('bowl', 400), 260, 2, 60, 2),
  dish('chendol', 'Chendol', ['chendol', 'cendol'], p('bowl', 300), 340, 3, 55, 12),

  // ---------- kopitiam and bubble tea (typical cups, estimates) ----------
  dish('kopi', 'Kopi (with condensed milk)', ['kopi', 'coffee'], cup(240), 119, 2, 20, 3.5),
  dish('kopi-c', 'Kopi C (evaporated milk, sugar)', ['kopi c', 'kopi si'], cup(240), 95, 2, 15, 3),
  dish('kopi-o', 'Kopi O (black, with sugar)', ['kopi o', 'black coffee with sugar'], cup(240), 60, 0, 15, 0),
  dish('kopi-o-kosong', 'Kopi O kosong (black, no sugar)', ['kopi o kosong', 'black coffee', 'kopi kosong', 'americano'], cup(240), 5, 0.3, 0.8, 0),
  dish('teh', 'Teh (with condensed milk)', ['teh', 'milk tea', 'teh tarik'], cup(240), 111, 2, 19, 3),
  dish('teh-o-kosong', 'Teh O kosong (plain tea)', ['teh o kosong', 'plain tea', 'tea', 'green tea'], cup(240), 2, 0, 0.5, 0),
  dish('milo', 'Milo (kopitiam)', ['milo', 'milo peng', 'hot milo'], cup(240), 197, 5, 33, 5),
  dish('bubble-tea', 'Bubble milk tea (50% sugar, with pearls)', ['bubble tea', 'boba', 'pearl milk tea', 'bbt'], p('cup', { ml: 500, note: 'regular' }), 300, 2, 55, 8),
  dish('isotonic', 'Isotonic drink (e.g. 100PLUS)', ['100 plus', '100plus', 'isotonic', 'sports drink', 'pocari'], p('can', { ml: 325 }), 80, 0, 20, 0),
  dish('zero-soda', 'Zero-sugar soft drink', ['coke zero', 'diet coke', 'pepsi max', 'zero sugar'], p('can', { ml: 330 }), 1, 0, 0, 0),
  dish('water', 'Water', ['water', 'plain water'], glass(), 0, 0, 0, 0),

  // ---------- more generic foods (USDA) ----------
  usda('croissant', 'Croissant (butter)', ['croissant'], [p('piece', 57)]),
  usda('couscous', 'Couscous (cooked)', ['couscous'], [p('cup', 157)]),
  usda('quinoa', 'Quinoa (cooked)', ['quinoa'], [p('cup', 185), p('bowl', 200)]),
  usda('granola', 'Granola', ['granola', 'muesli'], [p('serving', 45, 'about half a cup'), p('cup', 122)]),
  usda('popcorn', 'Popcorn (air-popped, plain)', ['popcorn'], [p('cup', 8), p('bag', 30, 'small')]),
  usda('chicken-wing-fried', 'Chicken wing (fried, with skin)', ['chicken wing', 'fried chicken wing', 'wings'], [p('wing', 32, 'meat and skin, no bone')]),
  usda('chicken-drumstick', 'Chicken drumstick (roasted, with skin)', ['drumstick', 'chicken drumstick'], [p('drumstick', 75, 'meat and skin, no bone')]),
  usda('chicken-breast-skin', 'Chicken breast (roasted, with skin)', ['chicken breast with skin', 'roast chicken'], [p('piece', 120)]),
  usda('cod', 'Cod (cooked)', ['cod', 'cod fish'], [p('fillet', 150)]),
  usda('mackerel', 'Mackerel / saba (cooked)', ['mackerel', 'saba', 'saba fish'], [p('fillet', 110)]),
  usda('sardines', 'Sardines, canned in oil (drained)', ['sardines', 'sardine'], [p('can', 92, 'drained'), p('piece', 12)]),
  usda('salmon-raw', 'Salmon, raw (sashimi)', ['salmon sashimi', 'sashimi', 'raw salmon'], [p('slice', 15), p('serving', 75, '5 slices')]),
  usda('crab', 'Crab meat (cooked)', ['crab', 'crab meat'], [p('cup', 118), p('serving', 100)]),
  usda('bacon', 'Bacon (pan-fried)', ['bacon'], [p('slice', 8)]),
  usda('lamb', 'Lamb, minced (cooked)', ['lamb', 'mutton', 'minced lamb'], [p('serving', 100)]),
  usda('tempeh', 'Tempeh', ['tempeh'], [p('piece', 85), p('serving', 100)]),
  usda('edamame', 'Edamame (shelled, cooked)', ['edamame'], [p('cup', 155), p('bowl', 75, 'small side')]),
  usda('baked-beans', 'Baked beans (canned)', ['baked beans', 'heinz baked beans', 'beans'], [p('cup', 254), p('can', 415, 'standard 415 g can'), p('tbsp', 16)]),
  usda('black-beans', 'Black beans (cooked)', ['black beans'], [p('cup', 172)]),
  usda('chickpeas', 'Chickpeas (cooked)', ['chickpeas', 'garbanzo', 'chana'], [p('cup', 164)]),
  usda('lentils', 'Lentils (cooked)', ['lentils', 'dal', 'dhal lentils'], [p('cup', 198)]),
  usda('cottage-cheese', 'Cottage cheese (2% fat)', ['cottage cheese'], [p('cup', 226), p('tbsp', 15)]),
  usda('mozzarella', 'Mozzarella', ['mozzarella'], [p('slice', 28), p('cup', 113, 'shredded')]),
  usda('egg-white', 'Egg white', ['egg white', 'egg whites'], [p('large', 33)]),
  usda('wine-red', 'Wine, red', ['wine', 'red wine', 'white wine'], [p('glass', { ml: 150 })], 0.99),
  usda('spirits', 'Spirits (vodka, whisky, gin, rum)', ['vodka', 'whisky', 'whiskey', 'gin', 'rum', 'spirits'], [p('shot', { ml: 30 })], 0.95),
  usda('coconut-water', 'Coconut water', ['coconut water', 'coconut juice'], [p('coconut', { ml: 300, note: 'one young coconut' }), glass()], 1.02),
  usda('strawberries', 'Strawberries', ['strawberries', 'strawberry'], [p('cup', 152), p('piece', 12)]),
  usda('blueberries', 'Blueberries', ['blueberries', 'blueberry'], [p('cup', 148), p('punnet', 125)]),
  usda('pear', 'Pear', ['pear', 'pears', 'nashi pear'], [p('medium', 178)]),
  usda('kiwi', 'Kiwi fruit', ['kiwi', 'kiwifruit', 'kiwi fruit'], [p('piece', 69)]),
  usda('longan', 'Longan', ['longan', 'longans'], [p('piece', 3.2), p('cup', 100)]),
  usda('lychee', 'Lychee', ['lychee', 'lychees', 'litchi'], [p('piece', 10), p('cup', 190)]),
  usda('jackfruit', 'Jackfruit', ['jackfruit', 'nangka'], [p('pod', 20), p('cup', 165)]),
  usda('dates', 'Dates (medjool)', ['dates', 'date', 'kurma'], [p('piece', 24)]),
  usda('raisins', 'Raisins', ['raisins', 'raisin'], [p('box', 43, 'small box'), p('tbsp', 9)]),
  usda('peach', 'Peach', ['peach', 'peaches'], [p('medium', 150)]),
  usda('cherries', 'Cherries', ['cherries', 'cherry'], [p('cup', 154), p('piece', 8)]),
  usda('coconut-flesh', 'Coconut flesh', ['coconut flesh', 'coconut meat'], [p('cup', 80, 'shredded'), p('piece', 45)]),
  usda('bok-choy', 'Bok choy / xiao bai cai (boiled)', ['bok choy', 'pak choy', 'pak choi', 'nai bai'], [p('cup', 170), p('plate', 150)]),
  usda('cabbage', 'Cabbage (boiled)', ['cabbage'], [p('cup', 150), p('plate', 150)]),
  usda('green-beans', 'Green beans (boiled)', ['green beans', 'french beans', 'long beans'], [p('cup', 125)]),
  usda('mushrooms', 'Button mushrooms (cooked)', ['mushrooms', 'mushroom', 'button mushrooms'], [p('cup', 156)]),
  usda('shiitake', 'Shiitake mushrooms (cooked)', ['shiitake', 'chinese mushrooms', 'dried mushrooms'], [p('cup', 145), p('piece', 10)]),
  usda('eggplant', 'Eggplant / brinjal (boiled)', ['eggplant', 'brinjal', 'aubergine'], [p('cup', 99), p('plate', 150)]),
  usda('bean-sprouts', 'Bean sprouts (raw)', ['bean sprouts', 'taugeh', 'tauge'], [p('cup', 104)]),
  usda('onion', 'Onion', ['onion', 'onions'], [p('medium', 110)]),
  usda('bell-pepper', 'Capsicum / bell pepper', ['capsicum', 'bell pepper', 'red pepper'], [p('medium', 119)]),
  usda('pumpkin', 'Pumpkin (boiled)', ['pumpkin'], [p('cup', 245), p('plate', 150)]),
  usda('peas', 'Green peas (cooked)', ['peas', 'green peas'], [p('cup', 160), p('tbsp', 10)]),
  usda('cauliflower', 'Cauliflower (boiled)', ['cauliflower'], [p('cup', 124)]),
  usda('okra', "Okra / lady's finger (boiled)", ['okra', 'ladys finger', 'lady finger', 'ladies fingers'], [p('cup', 160), p('piece', 12)]),
  usda('cashews', 'Cashews (roasted)', ['cashews', 'cashew', 'cashew nuts'], [p('handful', 28), p('piece', 1.5)]),
  usda('walnuts', 'Walnuts', ['walnuts', 'walnut'], [p('handful', 28)]),
  usda('chia', 'Chia seeds', ['chia', 'chia seeds'], [p('tbsp', 12)]),
  usda('jam', 'Jam', ['jam', 'strawberry jam', 'fruit jam'], [p('tbsp', 20), p('tsp', 7)]),
  usda('soy-sauce', 'Soy sauce', ['soy sauce', 'light soy sauce', 'kicap'], [p('tbsp', 16), p('tsp', 5)]),
  usda('oyster-sauce', 'Oyster sauce', ['oyster sauce'], [p('tbsp', 18)]),

  // ---------- more hawker and restaurant dishes (typical portions, estimates) ----------
  dish('porridge-plain', 'Plain rice porridge (congee)', ['porridge', 'congee', 'plain porridge', 'mui'], p('bowl', 300), 138, 2.7, 30, 0.3),
  dish('chicken-porridge', 'Chicken porridge', ['chicken porridge', 'chicken congee'], p('bowl', 500), 256, 15, 40, 4),
  dish('fish-porridge', 'Fish porridge', ['fish porridge', 'fish congee'], p('bowl', 500), 230, 18, 35, 2),
  dish('lor-mee', 'Lor mee', ['lor mee'], p('bowl', 550), 382, 18, 55, 10),
  dish('prawn-noodles', 'Prawn noodle soup (har mee)', ['prawn noodles', 'prawn mee', 'har mee', 'prawn noodle soup'], p('bowl', 550), 294, 20, 40, 6),
  dish('mee-pok', 'Mee pok (dry, with fishballs)', ['mee pok', 'mee pok tah', 'fishball mee pok'], p('bowl', 300), 418, 18, 55, 14),
  dish('fried-bee-hoon', 'Fried bee hoon (plain)', ['fried bee hoon', 'fried beehoon', 'economy bee hoon'], p('plate', 200), 338, 7, 55, 10),
  dish('mee-soto', 'Mee soto', ['mee soto', 'soto ayam'], p('bowl', 500), 398, 22, 55, 10),
  dish('lontong', 'Lontong', ['lontong'], p('bowl', 450), 498, 15, 60, 22),
  dish('ayam-penyet', 'Ayam penyet (with rice)', ['ayam penyet'], p('plate', 450), 898, 45, 85, 42),
  dish('nasi-padang', 'Nasi padang (rice + 2 dishes)', ['nasi padang', 'malay rice', 'nasi campur'], p('plate', 450), 751, 30, 85, 32),
  dish('fried-chicken-hawker', 'Fried chicken wing (hawker)', ['hawker chicken wing', 'har cheong gai', 'prawn paste chicken'], p('piece', 60), 215, 14, 6, 15),
  dish('chicken-chop', 'Chicken chop with fries (western stall)', ['chicken chop', 'western chicken chop'], p('plate', 500), 894, 50, 70, 46),
  dish('fish-and-chips', 'Fish and chips', ['fish and chips', 'fish n chips'], p('plate', 450), 847, 35, 80, 43),
  dish('spaghetti-bolognese', 'Spaghetti bolognese', ['spaghetti bolognese', 'bolognese', 'spag bol'], p('plate', 400), 600, 25, 80, 20),
  dish('teriyaki-don', 'Chicken teriyaki don', ['teriyaki don', 'chicken teriyaki', 'teriyaki chicken rice'], p('bowl', 450), 738, 35, 100, 22),
  dish('ramen', 'Ramen (tonkotsu)', ['ramen', 'tonkotsu ramen'], p('bowl', 650), 896, 35, 90, 44),
  dish('bibimbap', 'Bibimbap', ['bibimbap'], p('bowl', 500), 593, 25, 85, 17),
  dish('salmon-nigiri', 'Salmon sushi (nigiri)', ['sushi', 'salmon sushi', 'nigiri'], p('piece', 35), 45, 2.5, 6, 1.2),
  dish('california-roll', 'California maki roll', ['california roll', 'maki', 'sushi roll'], p('piece', 30), 39, 1, 6.5, 1),
  dish('chapati', 'Chapati', ['chapati', 'chapatti', 'roti'], p('piece', 40), 119, 3.5, 18, 3.7),
  dish('naan', 'Naan (plain)', ['naan', 'nan'], p('piece', 90), 262, 8.7, 45, 5.1),
  dish('murtabak', 'Murtabak (chicken)', ['murtabak'], p('plate', 300), 697, 30, 70, 33),
  dish('curry-chicken', 'Chicken curry (no rice)', ['chicken curry', 'curry chicken', 'mutton curry', 'curry'], p('bowl', 250), 401, 25, 10, 29),
  dish('dhal-curry', 'Dhal curry', ['dhal curry', 'dal curry', 'dhal'], p('bowl', 200), 227, 11, 30, 7),
  dish('siew-mai', 'Siew mai', ['siew mai', 'siu mai', 'shumai'], p('piece', 20), 45, 2.5, 3, 2.5),
  dish('har-gow', 'Har gow (prawn dumpling)', ['har gow', 'prawn dumpling', 'har kau'], p('piece', 25), 41, 2, 6, 1),
  dish('char-siew-bao', 'Char siew bao', ['char siew bao', 'char siu bao', 'bao', 'pau', 'bun'], p('piece', 60), 160, 6, 25, 4),
  dish('xiao-long-bao', 'Xiao long bao', ['xiao long bao', 'xlb', 'soup dumpling'], p('piece', 25), 51, 2.5, 5, 2.3),
  dish('egg-tart', 'Egg tart', ['egg tart', 'dan tat'], p('piece', 50), 202, 3.5, 20, 12),
  dish('spring-roll', 'Spring roll (fried)', ['spring roll', 'spring rolls', 'popiah goreng'], p('piece', 30), 89, 2, 9, 5),
  dish('dumplings-boiled', 'Boiled dumplings (pork)', ['dumplings', 'jiaozi', 'boiled dumplings', 'shui jiao'], p('piece', 25), 55, 2.5, 5, 2.7),
  dish('ondeh-ondeh', 'Ondeh ondeh', ['ondeh ondeh', 'onde onde'], p('piece', 20), 60, 0.5, 11, 1.6),
  dish('kueh-lapis', 'Kueh lapis', ['kueh lapis', 'kuih lapis', 'kueh'], p('piece', 40), 141, 1, 22, 5.5),
  dish('tau-huay', 'Tau huay (sweet beancurd)', ['tau huay', 'douhua', 'beancurd dessert', 'tofu pudding'], p('bowl', 250), 159, 8, 25, 3),
  dish('bubur-cha-cha', 'Bubur cha cha', ['bubur cha cha'], p('bowl', 250), 233, 3, 35, 9),
  dish('goreng-pisang', 'Goreng pisang (banana fritter)', ['goreng pisang', 'banana fritter', 'pisang goreng'], p('piece', 70), 192, 1.5, 25, 9.5),
  dish('pineapple-tart', 'Pineapple tart', ['pineapple tart'], p('piece', 15), 70, 0.8, 9, 3.4),
  dish('muffin', 'Muffin (blueberry)', ['muffin', 'blueberry muffin'], p('piece', 100), 384, 5, 55, 16),
  dish('donut', 'Doughnut (glazed)', ['doughnut', 'donut'], p('piece', 60), 258, 3, 30, 14),
  dish('sausage-bun', 'Sausage bun', ['sausage bun', 'hotdog bun'], p('piece', 80), 260, 8, 30, 12),
  dish('cookie', 'Chocolate chip cookie', ['cookie', 'cookies', 'chocolate chip cookie'], p('piece', 16), 78, 0.9, 10, 3.8),
  dish('cream-crackers', 'Cream crackers', ['cream crackers', 'crackers', 'jacobs'], p('piece', 8.5), 36, 0.8, 5.6, 1.1),
  dish('cheeseburger', 'Cheeseburger (fast food)', ['cheeseburger', 'burger', 'hamburger'], p('burger', 120), 300, 15, 33, 12),
  dish('fried-chicken-ff', 'Fried chicken piece (fast food)', ['fried chicken', 'kfc', 'mcdonalds chicken'], p('piece', 90), 227, 16, 7, 15),
  dish('nuggets', 'Chicken nuggets', ['nuggets', 'chicken nuggets', 'mcnuggets'], p('piece', 16), 47, 2.6, 2.6, 2.9),
  dish('hash-brown', 'Hash brown', ['hash brown', 'hashbrown'], p('piece', 55), 151, 1.3, 15, 9.5),
  dish('nutella', 'Chocolate hazelnut spread', ['nutella', 'hazelnut spread', 'chocolate spread'], p('tbsp', 19), 102, 1.2, 10.9, 5.9),
  dish('chilli-sauce', 'Chilli sauce', ['chilli sauce', 'chili sauce', 'sambal'], p('tbsp', 17), 18, 0.3, 4, 0.1),
  dish('satay-sauce', 'Satay peanut sauce', ['satay sauce', 'peanut sauce'], p('tbsp', 20), 46, 1.5, 3, 3.2),

  // ---------- more drinks (typical cups, estimates) ----------
  dish('teh-c', 'Teh C (evaporated milk, sugar)', ['teh c', 'teh si'], cup(240), 99, 2, 16, 3),
  dish('teh-o', 'Teh O (with sugar)', ['teh o'], cup(240), 60, 0, 15, 0),
  dish('milo-dinosaur', 'Milo dinosaur', ['milo dinosaur', 'milo dino'], p('cup', { ml: 400 }), 300, 7, 50, 8),
  dish('bandung', 'Bandung (rose syrup with milk)', ['bandung', 'bandung drink'], cup(240), 151, 2, 30, 2.5),
  dish('sugar-cane', 'Sugar cane juice', ['sugar cane', 'sugarcane juice', 'sugar cane juice'], p('cup', { ml: 300 }), 200, 0, 50, 0),
  dish('barley', 'Barley drink (sweetened)', ['barley', 'barley water', 'barley drink'], cup(250), 98, 0.5, 24, 0),
  dish('chrysanthemum', 'Chrysanthemum tea (packet)', ['chrysanthemum tea', 'chrysanthemum'], p('packet', { ml: 250 }), 100, 0, 25, 0),
  dish('lemon-tea', 'Iced lemon tea (canned)', ['lemon tea', 'ice lemon tea', 'iced lemon tea'], p('can', { ml: 300 }), 120, 0, 30, 0),
  dish('soya-hawker', 'Soya bean drink (hawker, sweet)', ['soya bean drink', 'sweet soy milk', 'tau huay chui sweet'], cup(250), 130, 7, 17, 3.8),
  dish('latte', 'Caffe latte (full cream milk)', ['latte', 'cafe latte', 'flat white'], p('cup', { ml: 350, note: 'regular' }), 190, 10, 15, 10),
  dish('cappuccino', 'Cappuccino (full cream milk)', ['cappuccino'], p('cup', { ml: 350, note: 'regular' }), 120, 6.5, 10, 6),
  dish('yakult', 'Yakult', ['yakult', 'probiotic drink'], p('bottle', { ml: 80 }), 50, 0.9, 11.6, 0),
  dish('kopi-peng', 'Kopi peng (iced, condensed milk)', ['kopi peng', 'iced kopi', 'iced coffee'], p('cup', { ml: 350 }), 150, 2.5, 25, 4.5),
  dish('teh-peng', 'Teh peng (iced, condensed milk)', ['teh peng', 'iced teh', 'iced milk tea'], p('cup', { ml: 350 }), 140, 2.5, 24, 4),
];

/** A food the user saved (stored per 100 g) in the same shape as built-ins. */
export function customToFood(f) {
  return {
    id: `my-${f.id}`,
    name: f.name,
    aliases: [],
    kcal: f.kcal,
    protein: f.protein,
    carbs: f.carbs,
    fat: f.fat,
    density: 1,
    portions: f.servingGrams ? [{ unit: f.servingUnit || 'serving', grams: f.servingGrams, note: '' }] : [],
    source: { kind: 'mine' },
  };
}

// ---------- search ----------

const normalise = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Crude singular form so "eggs" finds "egg" and "potatoes" finds "potato". */
export function singular(word) {
  if (word.length <= 3 || word.endsWith('ss')) return word;
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (/(oes|ches|shes|xes)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s')) return word.slice(0, -1);
  return word;
}

const words = (s) => normalise(s).split(' ').filter(Boolean).map(singular);

/** Edit distance with swaps counted as one edit ("ebans" -> "beans" is 1). */
function typoDistance(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** One typo is forgiven in words of 4+ letters. */
const nearly = (w, t) => w.length >= 4 && t.length >= 4 && typoDistance(w, t) <= 1;

function score(food, qWords, qText) {
  const names = [food.name, ...food.aliases];
  // An alias typed exactly ("rice", "kopi o") is the strongest signal.
  if (food.aliases.some((a) => words(a).join(' ') === qText)) return 100;
  if (words(food.name).join(' ') === qText) return 90;

  const matchAll = (tokens) => {
    let s = 0;
    for (const w of qWords) {
      if (tokens.includes(w)) s += 3;
      else if (tokens.some((t) => t.startsWith(w))) s += 2;
      else if (tokens.some((t) => nearly(w, t))) s += 1;
      else return 0;
    }
    return s;
  };

  // Best single name or alias that holds every word; the fewer extra words
  // it has, the closer the match ("chick rice" -> chicken rice, not
  // teriyaki chicken rice).
  let best = 0;
  for (const n of names) {
    const tokens = words(n);
    const s = matchAll(tokens);
    if (s) best = Math.max(best, s + 4 - 0.5 * (tokens.length - qWords.length));
  }
  // Otherwise the words may be spread across the name and aliases.
  if (!best) best = matchAll([...new Set(names.flatMap(words))]);
  if (!best) return 0;

  if (food.aliases.some((a) => words(a).join(' ').startsWith(qText))) best += 4;
  if (words(food.name).join(' ').startsWith(qText)) best += 2;
  return best;
}

/**
 * Ranked search over the built-in foods plus the user's own foods.
 * Every query word must match a word of the food's name or aliases.
 */
export function searchFoods(query, extra = [], limit = 8) {
  const qWords = words(query);
  if (!qWords.length) return [];
  const qText = qWords.join(' ');
  return [...extra, ...FOODS]
    .map((food) => ({ food, s: score(food, qWords, qText) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.food.name.length - b.food.name.length)
    .slice(0, limit)
    .map((x) => x.food);
}

/**
 * Share of the query's words found in a food's name (0 to 1), forgiving one
 * typo per word. Used to order online results, which come from two sources.
 */
export function relevance(food, query) {
  const qWords = words(query);
  if (!qWords.length) return 0;
  const tokens = [food.name, ...food.aliases].flatMap(words);
  const hits = qWords.filter((w) => tokens.some((t) => t === w || t.startsWith(w) || nearly(w, t))).length;
  return hits / qWords.length;
}

export function findFood(id, extra = []) {
  return extra.find((f) => f.id === id) ?? FOODS.find((f) => f.id === id) ?? null;
}

/** Nutrition for a weight of a food, rounded for display and storage. */
export function nutritionFor(food, grams) {
  const r1 = (x) => Math.round(((x * grams) / 100) * 10) / 10;
  return {
    kcal: Math.round((food.kcal * grams) / 100),
    protein: r1(food.protein),
    carbs: r1(food.carbs),
    fat: r1(food.fat),
  };
}
