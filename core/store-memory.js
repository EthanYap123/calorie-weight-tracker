// In-memory store. The browser app wraps it with localStorage persistence;
// tests use it directly. It has the same methods as the SQLite store in
// server/sqlite-store.js, so the tracker service runs unchanged on either.

const inRange = (from = '0000-00-00', to = '9999-99-99') => (x) => x.date >= from && x.date <= to;
const byDateThenId = (a, b) => a.date.localeCompare(b.date) || a.id - b.id;
const copy = (x) => ({ ...x });

/** A list of rows with numeric ids, kept on `data[key]`. */
function rows(get, key, counter, save) {
  return {
    list: (filter = () => true, sort = byDateThenId) => get()[key].filter(filter).sort(sort).map(copy),
    add(row) {
      const d = get();
      const out = { id: d[counter]++, ...row };
      d[key].push(out);
      save();
      return copy(out);
    },
    update(id, fields) {
      const row = get()[key].find((r) => r.id === id);
      if (!row) return null;
      Object.assign(row, fields);
      save();
      return copy(row);
    },
    remove(id) {
      const d = get();
      const before = d[key].length;
      d[key] = d[key].filter((r) => r.id !== id);
      if (d[key].length === before) return false;
      save();
      return true;
    },
  };
}

export function createMemoryStore(initial = null, onChange = () => {}) {
  let data = normalise(initial);
  const get = () => data;
  const save = () => onChange(structuredClone(data));

  const meals = rows(get, 'meals', 'nextId', save);
  const foods = rows(get, 'foods', 'nextFoodId', save);
  const exercises = rows(get, 'exercises', 'nextExerciseId', save);
  const fasts = rows(get, 'fasts', 'nextFastId', save);
  // Plain code-point order, the same as SQLite's default collation.
  const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id - b.id);

  return {
    getProfile: () => (data.profile ? { ...data.profile } : null),
    setProfile(profile) {
      data.profile = { ...profile };
      save();
    },

    listWeights() {
      return Object.entries(data.weights)
        .map(([date, kg]) => ({ date, kg }))
        .sort((a, b) => a.date.localeCompare(b.date));
    },
    upsertWeight({ date, kg }) {
      data.weights[date] = kg;
      save();
    },
    deleteWeight(date) {
      if (!(date in data.weights)) return false;
      delete data.weights[date];
      save();
      return true;
    },

    listMeals: ({ from, to } = {}) => meals.list(inRange(from, to)),
    addMeal: (meal) => meals.add(meal),
    updateMeal: (id, fields) => meals.update(id, fields),
    deleteMeal: (id) => meals.remove(id),

    listFoods: () => foods.list(() => true, byName),
    addFood: (food) => foods.add(food),
    deleteFood: (id) => foods.remove(id),

    listWater({ from, to } = {}) {
      return Object.entries(data.water)
        .map(([date, ml]) => ({ date, ml }))
        .filter(inRange(from, to))
        .sort((a, b) => a.date.localeCompare(b.date));
    },
    setWater({ date, ml }) {
      if (ml > 0) data.water[date] = ml;
      else delete data.water[date];
      save();
    },

    listExercises: ({ from, to } = {}) => exercises.list(inRange(from, to)),
    addExercise: (e) => exercises.add(e),
    deleteExercise: (id) => exercises.remove(id),

    listMeasurements() {
      return Object.entries(data.measurements)
        .map(([date, m]) => ({ date, ...m }))
        .sort((a, b) => a.date.localeCompare(b.date));
    },
    upsertMeasurement({ date, ...m }) {
      data.measurements[date] = m;
      save();
    },
    deleteMeasurement(date) {
      if (!(date in data.measurements)) return false;
      delete data.measurements[date];
      save();
      return true;
    },

    listCheckins({ from, to } = {}) {
      return Object.entries(data.checkins)
        .map(([date, c]) => ({ date, ...c }))
        .filter(inRange(from, to))
        .sort((a, b) => a.date.localeCompare(b.date));
    },
    upsertCheckin({ date, ...c }) {
      data.checkins[date] = c;
      save();
    },
    deleteCheckin(date) {
      if (!(date in data.checkins)) return false;
      delete data.checkins[date];
      save();
      return true;
    },

    listFasts: () => fasts.list(() => true, (a, b) => a.start.localeCompare(b.start) || a.id - b.id),
    addFast: (f) => fasts.add(f),
    updateFast: (id, fields) => fasts.update(id, fields),
    deleteFast: (id) => fasts.remove(id),

    replaceAll(all) {
      const numbered = (list = []) => list.map((x, i) => ({ ...x, id: i + 1 }));
      data = normalise({
        profile: all.profile ?? null,
        weights: Object.fromEntries((all.weights ?? []).map((w) => [w.date, w.kg])),
        meals: numbered(all.meals),
        foods: numbered(all.foods),
        water: Object.fromEntries((all.water ?? []).map((w) => [w.date, w.ml])),
        exercises: numbered(all.exercises),
        measurements: Object.fromEntries((all.measurements ?? []).map(({ date, ...m }) => [date, m])),
        fasts: numbered(all.fasts),
        checkins: Object.fromEntries((all.checkins ?? []).map(({ date, ...c }) => [date, c])),
      });
      save();
    },
  };
}

function normalise(raw) {
  const list = (key) => [...(raw?.[key] ?? [])];
  const next = (items, key) => raw?.[key] ?? Math.max(0, ...items.map((x) => x.id ?? 0)) + 1;
  const meals = list('meals');
  const foods = list('foods');
  const exercises = list('exercises');
  const fasts = list('fasts');
  return {
    profile: raw?.profile ?? null,
    weights: { ...(raw?.weights ?? {}) },
    meals,
    foods,
    water: { ...(raw?.water ?? {}) },
    exercises,
    measurements: { ...(raw?.measurements ?? {}) },
    fasts,
    checkins: { ...(raw?.checkins ?? {}) },
    nextId: next(meals, 'nextId'),
    nextFoodId: next(foods, 'nextFoodId'),
    nextExerciseId: next(exercises, 'nextExerciseId'),
    nextFastId: next(fasts, 'nextFastId'),
  };
}
