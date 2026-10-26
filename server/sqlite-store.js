// SQLite store for the server, using Node's built-in node:sqlite driver.
// Same methods as core/store-memory.js.
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS profile (
    id          INTEGER PRIMARY KEY CHECK (id = 1),
    data        TEXT    NOT NULL
  );
  CREATE TABLE IF NOT EXISTS weights (
    date        TEXT    PRIMARY KEY,
    kg          REAL    NOT NULL CHECK (kg BETWEEN 30 AND 300)
  );
  CREATE TABLE IF NOT EXISTS meals (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    date        TEXT    NOT NULL,
    slot        TEXT    NOT NULL CHECK (slot IN ('breakfast', 'lunch', 'dinner', 'snacks')),
    name        TEXT    NOT NULL,
    amount      TEXT    NOT NULL DEFAULT '',
    grams       REAL,
    kcal        REAL    NOT NULL,
    protein     REAL    NOT NULL,
    carbs       REAL    NOT NULL,
    fat         REAL    NOT NULL
  );
  CREATE INDEX IF NOT EXISTS meals_by_date ON meals (date);
  -- The user's own foods, per 100 g.
  CREATE TABLE IF NOT EXISTS foods (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    kcal          REAL    NOT NULL,
    protein       REAL    NOT NULL,
    carbs         REAL    NOT NULL,
    fat           REAL    NOT NULL,
    serving_unit  TEXT,
    serving_grams REAL
  );
  CREATE TABLE IF NOT EXISTS water (
    date        TEXT    PRIMARY KEY,
    ml          REAL    NOT NULL CHECK (ml > 0)
  );
  CREATE TABLE IF NOT EXISTS exercises (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    date        TEXT    NOT NULL,
    activity    TEXT    NOT NULL,
    name        TEXT    NOT NULL,
    minutes     REAL,
    steps       INTEGER,
    kcal        REAL    NOT NULL
  );
  CREATE INDEX IF NOT EXISTS exercises_by_date ON exercises (date);
  CREATE TABLE IF NOT EXISTS measurements (
    date        TEXT    PRIMARY KEY,
    waist_cm    REAL,
    neck_cm     REAL,
    hip_cm      REAL
  );
  -- Daily check-in: sleep (hours, quality 1-5), mood 1-5 and a note.
  CREATE TABLE IF NOT EXISTS checkins (
    date          TEXT    PRIMARY KEY,
    sleep_hours   REAL,
    sleep_quality INTEGER,
    mood          INTEGER,
    note          TEXT    NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS fasts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    start       TEXT    NOT NULL,
    "end"       TEXT
  );
`;

const MEAL_COLUMNS = 'id, date, slot, name, amount, grams, kcal, protein, carbs, fat';
const FOOD_COLUMNS =
  'id, name, kcal, protein, carbs, fat, serving_unit AS servingUnit, serving_grams AS servingGrams';
const EXERCISE_COLUMNS = 'id, date, activity, name, minutes, steps, kcal';
const MEASUREMENT_COLUMNS = 'date, waist_cm AS waistCm, neck_cm AS neckCm, hip_cm AS hipCm';
const FAST_COLUMNS = 'id, start, "end"';
const CHECKIN_COLUMNS = 'date, sleep_hours AS sleepHours, sleep_quality AS sleepQuality, mood, note';

export function createSqliteStore(file = ':memory:') {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);

  const q = {
    getProfile: db.prepare('SELECT data FROM profile WHERE id = 1'),
    setProfile: db.prepare(
      'INSERT INTO profile (id, data) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET data = excluded.data',
    ),
    listWeights: db.prepare('SELECT date, kg FROM weights ORDER BY date'),
    upsertWeight: db.prepare(
      'INSERT INTO weights (date, kg) VALUES (?, ?) ON CONFLICT (date) DO UPDATE SET kg = excluded.kg',
    ),
    deleteWeight: db.prepare('DELETE FROM weights WHERE date = ?'),

    listMeals: db.prepare(`SELECT ${MEAL_COLUMNS} FROM meals WHERE date BETWEEN ? AND ? ORDER BY date, id`),
    getMeal: db.prepare(`SELECT ${MEAL_COLUMNS} FROM meals WHERE id = ?`),
    addMeal: db.prepare(
      `INSERT INTO meals (date, slot, name, amount, grams, kcal, protein, carbs, fat)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING ${MEAL_COLUMNS}`,
    ),
    updateMeal: db.prepare(
      `UPDATE meals SET date = ?, slot = ?, name = ?, amount = ?, grams = ?, kcal = ?, protein = ?, carbs = ?, fat = ?
       WHERE id = ? RETURNING ${MEAL_COLUMNS}`,
    ),
    deleteMeal: db.prepare('DELETE FROM meals WHERE id = ?'),

    listFoods: db.prepare(`SELECT ${FOOD_COLUMNS} FROM foods ORDER BY name, id`),
    addFood: db.prepare(
      `INSERT INTO foods (name, kcal, protein, carbs, fat, serving_unit, serving_grams)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING ${FOOD_COLUMNS}`,
    ),
    deleteFood: db.prepare('DELETE FROM foods WHERE id = ?'),

    listWater: db.prepare('SELECT date, ml FROM water WHERE date BETWEEN ? AND ? ORDER BY date'),
    setWater: db.prepare('INSERT INTO water (date, ml) VALUES (?, ?) ON CONFLICT (date) DO UPDATE SET ml = excluded.ml'),
    clearWater: db.prepare('DELETE FROM water WHERE date = ?'),

    listExercises: db.prepare(`SELECT ${EXERCISE_COLUMNS} FROM exercises WHERE date BETWEEN ? AND ? ORDER BY date, id`),
    addExercise: db.prepare(
      `INSERT INTO exercises (date, activity, name, minutes, steps, kcal) VALUES (?, ?, ?, ?, ?, ?) RETURNING ${EXERCISE_COLUMNS}`,
    ),
    deleteExercise: db.prepare('DELETE FROM exercises WHERE id = ?'),

    listMeasurements: db.prepare(`SELECT ${MEASUREMENT_COLUMNS} FROM measurements ORDER BY date`),
    upsertMeasurement: db.prepare(
      `INSERT INTO measurements (date, waist_cm, neck_cm, hip_cm) VALUES (?, ?, ?, ?)
       ON CONFLICT (date) DO UPDATE SET waist_cm = excluded.waist_cm, neck_cm = excluded.neck_cm, hip_cm = excluded.hip_cm`,
    ),
    deleteMeasurement: db.prepare('DELETE FROM measurements WHERE date = ?'),

    listCheckins: db.prepare(`SELECT ${CHECKIN_COLUMNS} FROM checkins WHERE date BETWEEN ? AND ? ORDER BY date`),
    upsertCheckin: db.prepare(
      `INSERT INTO checkins (date, sleep_hours, sleep_quality, mood, note) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (date) DO UPDATE SET sleep_hours = excluded.sleep_hours, sleep_quality = excluded.sleep_quality,
         mood = excluded.mood, note = excluded.note`,
    ),
    deleteCheckin: db.prepare('DELETE FROM checkins WHERE date = ?'),

    listFasts: db.prepare(`SELECT ${FAST_COLUMNS} FROM fasts ORDER BY start, id`),
    addFast: db.prepare(`INSERT INTO fasts (start, "end") VALUES (?, ?) RETURNING ${FAST_COLUMNS}`),
    updateFast: db.prepare(`UPDATE fasts SET "end" = ? WHERE id = ? RETURNING ${FAST_COLUMNS}`),
    deleteFast: db.prepare('DELETE FROM fasts WHERE id = ?'),
  };

  const plain = (row) => (row ? { ...row } : null);
  const range = ({ from = '0000-00-00', to = '9999-99-99' } = {}) => [from, to];
  const insertMeal = (m) =>
    plain(q.addMeal.get(m.date, m.slot, m.name, m.amount ?? '', m.grams ?? null, m.kcal, m.protein, m.carbs, m.fat));
  const insertFood = (f) =>
    plain(q.addFood.get(f.name, f.kcal, f.protein, f.carbs, f.fat, f.servingUnit ?? null, f.servingGrams ?? null));
  const insertExercise = (e) =>
    plain(q.addExercise.get(e.date, e.activity, e.name, e.minutes ?? null, e.steps ?? null, e.kcal));
  const upsertCheckin = (c) =>
    q.upsertCheckin.run(c.date, c.sleepHours ?? null, c.sleepQuality ?? null, c.mood ?? null, c.note ?? '');
  const upsertMeasurement = (m) => q.upsertMeasurement.run(m.date, m.waistCm ?? null, m.neckCm ?? null, m.hipCm ?? null);

  return {
    db,

    getProfile() {
      const row = q.getProfile.get();
      return row ? JSON.parse(row.data) : null;
    },
    setProfile(profile) {
      q.setProfile.run(JSON.stringify(profile));
    },

    listWeights: () => q.listWeights.all().map(plain),
    upsertWeight({ date, kg }) {
      q.upsertWeight.run(date, kg);
    },
    deleteWeight: (date) => q.deleteWeight.run(date).changes > 0,

    listMeals: (opts) => q.listMeals.all(...range(opts)).map(plain),
    addMeal: insertMeal,
    updateMeal(id, fields) {
      const row = q.getMeal.get(id);
      if (!row) return null;
      const m = { ...row, ...fields };
      return plain(q.updateMeal.get(m.date, m.slot, m.name, m.amount, m.grams, m.kcal, m.protein, m.carbs, m.fat, id));
    },
    deleteMeal: (id) => q.deleteMeal.run(id).changes > 0,

    listFoods: () => q.listFoods.all().map(plain),
    addFood: insertFood,
    deleteFood: (id) => q.deleteFood.run(id).changes > 0,

    listWater: (opts) => q.listWater.all(...range(opts)).map(plain),
    setWater({ date, ml }) {
      if (ml > 0) q.setWater.run(date, ml);
      else q.clearWater.run(date);
    },

    listExercises: (opts) => q.listExercises.all(...range(opts)).map(plain),
    addExercise: insertExercise,
    deleteExercise: (id) => q.deleteExercise.run(id).changes > 0,

    listMeasurements: () => q.listMeasurements.all().map(plain),
    upsertMeasurement,
    deleteMeasurement: (date) => q.deleteMeasurement.run(date).changes > 0,

    listCheckins: (opts) => q.listCheckins.all(...range(opts)).map(plain),
    upsertCheckin,
    deleteCheckin: (date) => q.deleteCheckin.run(date).changes > 0,

    listFasts: () => q.listFasts.all().map(plain),
    addFast: (f) => plain(q.addFast.get(f.start, f.end ?? null)),
    updateFast: (id, fields) => plain(q.updateFast.get(fields.end ?? null, id)),
    deleteFast: (id) => q.deleteFast.run(id).changes > 0,

    replaceAll(all) {
      db.exec('BEGIN');
      try {
        db.exec(`DELETE FROM profile; DELETE FROM weights; DELETE FROM meals; DELETE FROM foods; DELETE FROM water;
                 DELETE FROM exercises; DELETE FROM measurements; DELETE FROM fasts; DELETE FROM checkins;
                 DELETE FROM sqlite_sequence;`);
        if (all.profile) q.setProfile.run(JSON.stringify(all.profile));
        for (const w of all.weights ?? []) q.upsertWeight.run(w.date, w.kg);
        for (const m of all.meals ?? []) insertMeal(m);
        for (const f of all.foods ?? []) insertFood(f);
        for (const w of all.water ?? []) if (w.ml > 0) q.setWater.run(w.date, w.ml);
        for (const e of all.exercises ?? []) insertExercise(e);
        for (const m of all.measurements ?? []) upsertMeasurement(m);
        for (const f of all.fasts ?? []) q.addFast.get(f.start, f.end ?? null);
        for (const c of all.checkins ?? []) upsertCheckin(c);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },

    close: () => db.close(),
  };
}
