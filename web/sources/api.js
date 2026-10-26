// Data source backed by the Express API.

async function call(method, path, body) {
  const res = await fetch(`api${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.error ?? `Request failed (${res.status}).`);
    err.errors = data?.errors;
    throw err;
  }
  return data;
}

const q = encodeURIComponent;

export const source = {
  mode: 'api',
  dashboard: (date) => call('GET', `/dashboard?date=${q(date)}`),
  saveProfile: (profile) => call('PUT', '/profile', profile),
  logWeight: (entry) => call('POST', '/weights', entry),
  deleteWeight: (date) => call('DELETE', `/weights/${q(date)}`),
  addMeal: (meal) => call('POST', '/meals', meal),
  deleteMeal: (id) => call('DELETE', `/meals/${q(id)}`),
  updateMeal: (id, meal) => call('PUT', `/meals/${q(id)}`, meal),
  copyMeals: (args) => call('POST', '/meals/copy', args),
  recentFoods: (date) => call('GET', `/recent-foods?date=${q(date)}`),
  setWater: (entry) => call('PUT', '/water', entry),
  addExercise: (entry) => call('POST', '/exercises', entry),
  deleteExercise: (id) => call('DELETE', `/exercises/${q(id)}`),
  logMeasurement: (entry) => call('POST', '/measurements', entry),
  deleteMeasurement: (date) => call('DELETE', `/measurements/${q(date)}`),
  logCheckin: (entry) => call('PUT', '/checkins', entry),
  deleteCheckin: (date) => call('DELETE', `/checkins/${q(date)}`),
  startFast: (time) => call('POST', '/fasts/start', { time }),
  endFast: (time) => call('POST', '/fasts/end', { time }),
  deleteFast: (id) => call('DELETE', `/fasts/${q(id)}`),
  searchFoods: (text) => call('GET', `/foods?q=${q(text)}`),
  searchOnline: (text) => call('GET', `/online-foods?q=${q(text)}`),
  listFoods: () => call('GET', '/my-foods'),
  addFood: (food) => call('POST', '/my-foods', food),
  deleteFood: (id) => call('DELETE', `/my-foods/${q(id)}`),
  exportData: () => call('GET', '/export'),
  importData: (data) => call('POST', '/import', data),
  loadDemo: (today) => call('POST', '/demo', { today }),
  reset: () => call('POST', '/reset', {}),
};
