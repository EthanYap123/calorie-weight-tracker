// Data source backed by the Express API. Each account's data lives on the
// server, so it is the same on every device that logs in.

const TOKEN_KEY = 'steady-token';
const EMAIL_KEY = 'steady-email';

const saved = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

let token = saved(TOKEN_KEY);

function remember(session) {
  token = session?.token ?? null;
  try {
    if (session) {
      localStorage.setItem(TOKEN_KEY, session.token);
      localStorage.setItem(EMAIL_KEY, session.user.email);
    } else {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(EMAIL_KEY);
    }
  } catch {
    // Not saved: still logged in until the tab closes.
  }
}

async function call(method, path, body) {
  const res = await fetch(`api${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // An expired or revoked login: forget it so the app shows the login screen.
    if (res.status === 401 && token && !path.startsWith('/auth/')) remember(null);
    const err = new Error(data?.error ?? `Request failed (${res.status}).`);
    err.status = res.status;
    err.errors = data?.errors;
    throw err;
  }
  return data;
}

const q = encodeURIComponent;

export const source = {
  mode: 'api',
  account: {
    loggedIn: () => Boolean(token),
    email: () => saved(EMAIL_KEY),
    async login(email, password) {
      remember(await call('POST', '/auth/login', { email, password }));
    },
    async register(email, password) {
      remember(await call('POST', '/auth/register', { email, password }));
    },
    logout: () => remember(null),
    async deleteAccount(password) {
      await call('POST', '/account/delete', { password });
      remember(null);
    },
  },
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
