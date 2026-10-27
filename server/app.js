// JSON API plus the web UI. Every route is a thin wrapper around the
// tracker service in core/, which the browser demo also uses. Each request
// gets a tracker on a store scoped to the logged-in user.
import express from 'express';
import { fileURLToPath } from 'node:url';
import { searchOnline } from '../core/off.js';
import { createTracker } from '../core/service.js';
import { createAuth } from './auth.js';
import { createPgStore } from './pg-store.js';
import { getSettings, saveSettings } from './settings.js';

const root = (dir) => fileURLToPath(new URL(`../${dir}/`, import.meta.url));

/**
 * @param db        from server/db.js
 * @param options   jwtSecret; limits (see DEFAULT_LIMITS); trustProxy, true
 *                  behind Vercel, which sets x-forwarded-for itself
 */
export function createApp(db, { jwtSecret, limits, trustProxy = false } = {}) {
  const auth = createAuth(db, { jwtSecret, limits });
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '4mb' }));
  const clientIp = (req) =>
    (trustProxy && req.get('x-forwarded-for')?.split(',')[0].trim()) || req.socket.remoteAddress || 'unknown';

  const api = express.Router();
  api.use((req, res, next) => {
    // Personal data: never let a browser or proxy keep a copy.
    res.set('cache-control', 'no-store');
    next();
  });

  api.get('/health', async (req, res) => {
    await db.query('SELECT 1');
    res.json({ ok: true });
  });

  api.post('/auth/register', async (req, res) => res.status(201).json(await auth.register(req.body, clientIp(req))));
  api.post('/auth/login', async (req, res) => res.json(await auth.login(req.body, clientIp(req))));

  // Everything below needs a logged-in user.
  api.use(auth.requireUser);
  api.use(async (req, res, next) => {
    if (req.method !== 'GET') await auth.limit('writes', req.user.id);
    req.tracker = createTracker(createPgStore(db, req.user.id));
    next();
  });

  api.get('/auth/me', (req, res) => res.json({ email: req.user.email }));
  api.get('/settings', async (req, res) => res.json(await getSettings(db, req.user.id)));
  api.put('/settings', async (req, res) => res.json(await saveSettings(db, req.user.id, req.body)));
  api.post('/account/delete', async (req, res) => {
    await auth.deleteAccount(req.user.id, req.body?.password);
    res.status(204).end();
  });

  api.get('/dashboard', async (req, res) => res.json(await req.tracker.dashboard(req.query.date)));

  api.get('/profile', async (req, res) => res.json(await req.tracker.getProfile()));
  api.put('/profile', async (req, res) => res.json(await req.tracker.saveProfile(req.body)));

  api.post('/weights', async (req, res) => res.status(201).json(await req.tracker.logWeight(req.body)));
  api.delete('/weights/:date', async (req, res) => {
    await req.tracker.deleteWeight(req.params.date);
    res.status(204).end();
  });

  api.get('/meals', async (req, res) => res.json(await req.tracker.listMeals(req.query.date)));
  api.post('/meals', async (req, res) => res.status(201).json(await req.tracker.addMeal(req.body)));
  api.post('/meals/copy', async (req, res) => res.json(await req.tracker.copyMeals(req.body ?? {})));
  api.put('/meals/:id', async (req, res) => res.json(await req.tracker.updateMeal(req.params.id, req.body)));
  api.delete('/meals/:id', async (req, res) => {
    await req.tracker.deleteMeal(req.params.id);
    res.status(204).end();
  });
  api.get('/recent-foods', async (req, res) => res.json(await req.tracker.recentFoods(req.query.date)));

  api.put('/water', async (req, res) => res.json(await req.tracker.setWater(req.body)));

  api.post('/exercises', async (req, res) => res.status(201).json(await req.tracker.addExercise(req.body)));
  api.delete('/exercises/:id', async (req, res) => {
    await req.tracker.deleteExercise(req.params.id);
    res.status(204).end();
  });

  api.post('/measurements', async (req, res) => res.status(201).json(await req.tracker.logMeasurement(req.body)));
  api.delete('/measurements/:date', async (req, res) => {
    await req.tracker.deleteMeasurement(req.params.date);
    res.status(204).end();
  });

  api.put('/checkins', async (req, res) => res.json(await req.tracker.logCheckin(req.body)));
  api.delete('/checkins/:date', async (req, res) => {
    await req.tracker.deleteCheckin(req.params.date);
    res.status(204).end();
  });

  api.post('/fasts/start', async (req, res) => res.status(201).json(await req.tracker.startFast(req.body?.time)));
  api.post('/fasts/end', async (req, res) => res.json(await req.tracker.endFast(req.body?.time)));
  api.delete('/fasts/:id', async (req, res) => {
    await req.tracker.deleteFast(req.params.id);
    res.status(204).end();
  });

  api.get('/foods', async (req, res) => res.json(await req.tracker.searchFoods(req.query.q)));

  // Open Food Facts blocks name searches from browsers (CORS), so the
  // server asks on the page's behalf.
  api.get('/online-foods', async (req, res) => {
    const q = String(req.query.q ?? '').trim().slice(0, 80);
    if (!q) return res.json([]);
    try {
      res.json(await searchOnline(q, { server: true }));
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  api.get('/my-foods', async (req, res) => res.json(await req.tracker.listFoods()));
  api.post('/my-foods', async (req, res) => res.status(201).json(await req.tracker.addFood(req.body)));
  api.delete('/my-foods/:id', async (req, res) => {
    await req.tracker.deleteFood(req.params.id);
    res.status(204).end();
  });

  api.get('/export', async (req, res) => {
    res.attachment('tracker-export.json');
    res.json(await req.tracker.exportData());
  });
  api.post('/import', async (req, res) => res.json(await req.tracker.importData(req.body)));
  api.post('/demo', async (req, res) => {
    await req.tracker.loadDemo(req.body?.today);
    res.status(204).end();
  });
  api.post('/reset', async (req, res) => {
    await req.tracker.reset();
    res.status(204).end();
  });

  api.use((req, res) => res.status(404).json({ error: 'Not found.' }));
  // Express 5 forwards rejected promises here.
  api.use((err, req, res, next) => {
    const status = err.status ?? err.statusCode ?? 500;
    if (status >= 500) console.error(err);
    if (err.headers) res.set(err.headers);
    res.status(status).json({
      error: status >= 500 ? 'Something went wrong.' : err.message,
      ...(err.errors ? { errors: err.errors } : {}),
    });
  });

  app.use('/api', api);
  app.use('/core', express.static(root('core')));
  app.use(express.static(root('web')));
  return app;
}
