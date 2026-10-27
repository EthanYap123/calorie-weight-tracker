// Postgres store for the server: the same methods as core/store-memory.js,
// scoped to one user. Every query filters on user_id = $1, so one account
// can never read, change or delete another account's rows, even by guessing ids.

const MEAL_COLUMNS = 'id, date, slot, name, amount, grams, kcal, protein, carbs, fat';
const FOOD_COLUMNS =
  'id, name, kcal, protein, carbs, fat, serving_unit AS "servingUnit", serving_grams AS "servingGrams"';
const EXERCISE_COLUMNS = 'id, date, activity, name, minutes, steps, kcal';
const MEASUREMENT_COLUMNS = 'date, waist_cm AS "waistCm", neck_cm AS "neckCm", hip_cm AS "hipCm"';
const FAST_COLUMNS = 'id, start, "end"';
const CHECKIN_COLUMNS =
  'date, sleep_hours AS "sleepHours", sleep_quality AS "sleepQuality", mood, note';

/** Tables with a delete-everything step in replaceAll, children of users. */
const USER_TABLES = ['profiles', 'weights', 'meals', 'foods', 'water', 'exercises', 'measurements', 'checkins', 'fasts', 'id_counters'];

/** INSERT that takes the user's next id for `table` in the same statement. */
const insertNumbered = (table, columns, returning) => {
  const params = columns.map((_, i) => `$${i + 2}`).join(', ');
  return `WITH n AS (
      INSERT INTO id_counters (user_id, ${table}) VALUES ($1, 1)
      ON CONFLICT (user_id) DO UPDATE SET ${table} = id_counters.${table} + 1
      RETURNING ${table} AS id
    )
    INSERT INTO ${table} (user_id, id, ${columns.join(', ')})
    VALUES ($1, (SELECT id FROM n), ${params}) RETURNING ${returning}`;
};

const SQL = {
  addMeal: insertNumbered('meals', ['date', 'slot', 'name', 'amount', 'grams', 'kcal', 'protein', 'carbs', 'fat'], MEAL_COLUMNS),
  addFood: insertNumbered('foods', ['name', 'kcal', 'protein', 'carbs', 'fat', 'serving_unit', 'serving_grams'], FOOD_COLUMNS),
  addExercise: insertNumbered('exercises', ['date', 'activity', 'name', 'minutes', 'steps', 'kcal'], EXERCISE_COLUMNS),
  addFast: insertNumbered('fasts', ['start', '"end"'], FAST_COLUMNS),
};

const range = ({ from = '0000-00-00', to = '9999-99-99' } = {}) => [from, to];

export function createPgStore(db, userId) {
  if (!Number.isInteger(userId)) throw new Error('A store needs a user id.');

  /** Run on `conn` (the pool, or a transaction) with the user id as $1. */
  const run = (conn, text, params = []) => conn.query(text, [userId, ...params]);
  const rows = async (text, params) => (await run(db, text, params)).rows;
  const one = async (text, params) => (await rows(text, params))[0] ?? null;
  const changed = async (text, params) => (await run(db, text, params)).rowCount > 0;

  const writes = (conn) => ({
    setProfile: (p) =>
      run(conn, `INSERT INTO profiles (user_id, data) VALUES ($1, $2::jsonb)
                 ON CONFLICT (user_id) DO UPDATE SET data = excluded.data`, [JSON.stringify(p)]),
    upsertWeight: (w) =>
      run(conn, `INSERT INTO weights (user_id, date, kg) VALUES ($1, $2, $3)
                 ON CONFLICT (user_id, date) DO UPDATE SET kg = excluded.kg`, [w.date, w.kg]),
    addMeal: async (m) =>
      (await run(conn, SQL.addMeal, [m.date, m.slot, m.name, m.amount ?? '', m.grams ?? null, m.kcal, m.protein, m.carbs, m.fat])).rows[0],
    addFood: async (f) =>
      (await run(conn, SQL.addFood, [f.name, f.kcal, f.protein, f.carbs, f.fat, f.servingUnit ?? null, f.servingGrams ?? null])).rows[0],
    setWater: ({ date, ml }) =>
      ml > 0
        ? run(conn, `INSERT INTO water (user_id, date, ml) VALUES ($1, $2, $3)
                     ON CONFLICT (user_id, date) DO UPDATE SET ml = excluded.ml`, [date, ml])
        : run(conn, 'DELETE FROM water WHERE user_id = $1 AND date = $2', [date]),
    addExercise: async (e) =>
      (await run(conn, SQL.addExercise, [e.date, e.activity, e.name, e.minutes ?? null, e.steps ?? null, e.kcal])).rows[0],
    upsertMeasurement: (m) =>
      run(conn, `INSERT INTO measurements (user_id, date, waist_cm, neck_cm, hip_cm) VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (user_id, date) DO UPDATE SET waist_cm = excluded.waist_cm, neck_cm = excluded.neck_cm,
                   hip_cm = excluded.hip_cm`, [m.date, m.waistCm ?? null, m.neckCm ?? null, m.hipCm ?? null]),
    upsertCheckin: (c) =>
      run(conn, `INSERT INTO checkins (user_id, date, sleep_hours, sleep_quality, mood, note) VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (user_id, date) DO UPDATE SET sleep_hours = excluded.sleep_hours,
                   sleep_quality = excluded.sleep_quality, mood = excluded.mood, note = excluded.note`,
        [c.date, c.sleepHours ?? null, c.sleepQuality ?? null, c.mood ?? null, c.note ?? '']),
    addFast: async (f) => (await run(conn, SQL.addFast, [f.start, f.end ?? null])).rows[0],
  });
  const w = writes(db);
  const done = async (promise) => {
    await promise;
  };

  return {
    async getProfile() {
      return (await one('SELECT data FROM profiles WHERE user_id = $1'))?.data ?? null;
    },
    setProfile: (p) => done(w.setProfile(p)),

    listWeights: () => rows('SELECT date, kg FROM weights WHERE user_id = $1 ORDER BY date'),
    upsertWeight: (entry) => done(w.upsertWeight(entry)),
    deleteWeight: (date) => changed('DELETE FROM weights WHERE user_id = $1 AND date = $2', [date]),

    listMeals: (opts) =>
      rows(`SELECT ${MEAL_COLUMNS} FROM meals WHERE user_id = $1 AND date BETWEEN $2 AND $3 ORDER BY date, id`, range(opts)),
    addMeal: w.addMeal,
    async updateMeal(id, fields) {
      const row = await one(`SELECT ${MEAL_COLUMNS} FROM meals WHERE user_id = $1 AND id = $2`, [id]);
      if (!row) return null;
      const m = { ...row, ...fields };
      return one(
        `UPDATE meals SET date = $3, slot = $4, name = $5, amount = $6, grams = $7, kcal = $8, protein = $9, carbs = $10, fat = $11
         WHERE user_id = $1 AND id = $2 RETURNING ${MEAL_COLUMNS}`,
        [id, m.date, m.slot, m.name, m.amount, m.grams, m.kcal, m.protein, m.carbs, m.fat],
      );
    },
    deleteMeal: (id) => changed('DELETE FROM meals WHERE user_id = $1 AND id = $2', [id]),

    // COLLATE "C" is plain code-point order, the same as the browser store.
    listFoods: () => rows(`SELECT ${FOOD_COLUMNS} FROM foods WHERE user_id = $1 ORDER BY name COLLATE "C", id`),
    addFood: w.addFood,
    deleteFood: (id) => changed('DELETE FROM foods WHERE user_id = $1 AND id = $2', [id]),

    listWater: (opts) =>
      rows('SELECT date, ml FROM water WHERE user_id = $1 AND date BETWEEN $2 AND $3 ORDER BY date', range(opts)),
    setWater: (entry) => done(w.setWater(entry)),

    listExercises: (opts) =>
      rows(`SELECT ${EXERCISE_COLUMNS} FROM exercises WHERE user_id = $1 AND date BETWEEN $2 AND $3 ORDER BY date, id`, range(opts)),
    addExercise: w.addExercise,
    deleteExercise: (id) => changed('DELETE FROM exercises WHERE user_id = $1 AND id = $2', [id]),

    listMeasurements: () => rows(`SELECT ${MEASUREMENT_COLUMNS} FROM measurements WHERE user_id = $1 ORDER BY date`),
    upsertMeasurement: (m) => done(w.upsertMeasurement(m)),
    deleteMeasurement: (date) => changed('DELETE FROM measurements WHERE user_id = $1 AND date = $2', [date]),

    listCheckins: (opts) =>
      rows(`SELECT ${CHECKIN_COLUMNS} FROM checkins WHERE user_id = $1 AND date BETWEEN $2 AND $3 ORDER BY date`, range(opts)),
    upsertCheckin: (c) => done(w.upsertCheckin(c)),
    deleteCheckin: (date) => changed('DELETE FROM checkins WHERE user_id = $1 AND date = $2', [date]),

    listFasts: () => rows(`SELECT ${FAST_COLUMNS} FROM fasts WHERE user_id = $1 ORDER BY start, id`),
    addFast: w.addFast,
    updateFast: (id, fields) =>
      one(`UPDATE fasts SET "end" = $3 WHERE user_id = $1 AND id = $2 RETURNING ${FAST_COLUMNS}`, [id, fields.end ?? null]),
    deleteFast: (id) => changed('DELETE FROM fasts WHERE user_id = $1 AND id = $2', [id]),

    /** Swap in a whole data set (import, sample data, start fresh) in one transaction. */
    replaceAll(all) {
      const meals = (all.meals ?? []).map((m) => ({
        date: m.date, slot: m.slot, name: m.name, amount: m.amount ?? '', grams: m.grams ?? null,
        kcal: m.kcal, protein: m.protein, carbs: m.carbs, fat: m.fat,
      }));
      const foods = (all.foods ?? []).map((f) => ({
        name: f.name, kcal: f.kcal, protein: f.protein, carbs: f.carbs, fat: f.fat,
        serving_unit: f.servingUnit ?? null, serving_grams: f.servingGrams ?? null,
      }));
      const exercises = (all.exercises ?? []).map((e) => ({
        date: e.date, activity: e.activity, name: e.name, minutes: e.minutes ?? null, steps: e.steps ?? null, kcal: e.kcal,
      }));
      const fasts = (all.fasts ?? []).map((f) => ({ start: f.start, end: f.end ?? null }));
      // One row per date, the last one winning, as repeated upserts would.
      const byDate = (list, pick) => [...new Map(list.map((x) => [x.date, pick(x)])).values()];
      const weights = byDate(all.weights ?? [], (x) => ({ date: x.date, kg: x.kg }));
      const water = byDate((all.water ?? []).filter((x) => x.ml > 0), (x) => ({ date: x.date, ml: x.ml }));
      const measurements = byDate(all.measurements ?? [], (m) => ({
        date: m.date, waist_cm: m.waistCm ?? null, neck_cm: m.neckCm ?? null, hip_cm: m.hipCm ?? null,
      }));
      const checkins = byDate(all.checkins ?? [], (c) => ({
        date: c.date, sleep_hours: c.sleepHours ?? null, sleep_quality: c.sleepQuality ?? null, mood: c.mood ?? null, note: c.note ?? '',
      }));

      // Every statement goes through `tx`, the transaction's own connection.
      return db.transaction(async (tx) => {
        for (const table of USER_TABLES) await run(tx, `DELETE FROM ${table} WHERE user_id = $1`);
        if (all.profile) await writes(tx).setProfile(all.profile);
        const bulk = (table, columns, items, numbered = false) =>
          bulkInsert(run, tx, table, columns, items, numbered);
        await bulk('weights', { date: 'text', kg: 'float8' }, weights);
        await bulk('meals', {
          date: 'text', slot: 'text', name: 'text', amount: 'text', grams: 'float8',
          kcal: 'float8', protein: 'float8', carbs: 'float8', fat: 'float8',
        }, meals, true);
        await bulk('foods', {
          name: 'text', kcal: 'float8', protein: 'float8', carbs: 'float8', fat: 'float8',
          serving_unit: 'text', serving_grams: 'float8',
        }, foods, true);
        await bulk('water', { date: 'text', ml: 'float8' }, water);
        await bulk('exercises', {
          date: 'text', activity: 'text', name: 'text', minutes: 'float8', steps: 'int', kcal: 'float8',
        }, exercises, true);
        await bulk('measurements', { date: 'text', waist_cm: 'float8', neck_cm: 'float8', hip_cm: 'float8' }, measurements);
        await bulk('fasts', { start: 'text', end: 'text' }, fasts, true);
        await bulk('checkins', {
          date: 'text', sleep_hours: 'float8', sleep_quality: 'int', mood: 'int', note: 'text',
        }, checkins);
        // The next id in each list carries on after the imported rows.
        await run(tx, 'INSERT INTO id_counters (user_id, meals, foods, exercises, fasts) VALUES ($1, $2, $3, $4, $5)',
          [meals.length, foods.length, exercises.length, fasts.length]);
      });
    },
  };
}

/**
 * Insert a whole list in one statement: the rows go in as one JSON array and
 * Postgres unpacks it. Numbered tables get ids 1..n in list order.
 */
async function bulkInsert(run, tx, table, columns, items, numbered) {
  if (!items.length) return;
  const all = numbered ? { id: 'int', ...columns } : columns;
  const names = Object.keys(all).map((c) => `"${c}"`).join(', ');
  const defs = Object.entries(all).map(([c, type]) => `"${c}" ${type}`).join(', ');
  const rows = numbered ? items.map((x, i) => ({ id: i + 1, ...x })) : items;
  await run(
    tx,
    `INSERT INTO ${table} (user_id, ${names})
     SELECT $1, ${names} FROM jsonb_to_recordset($2::jsonb) AS x(${defs})`,
    [JSON.stringify(rows)],
  );
}
