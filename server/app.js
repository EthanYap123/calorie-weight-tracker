// JSON API plus the web UI. Every route is a thin wrapper around the
// tracker service in core/, which the browser demo also uses.
import express from 'express';
import { fileURLToPath } from 'node:url';
import { searchOnline } from '../core/off.js';
import { createTracker } from '../core/service.js';

const root = (dir) => fileURLToPath(new URL(`../${dir}/`, import.meta.url));

export function createApp(store) {
  const tracker = createTracker(store);
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));

  const api = express.Router();

  api.get('/health', (req, res) => res.json({ ok: true }));

  api.get('/dashboard', async (req, res) => res.json(await tracker.dashboard(req.query.date)));

  api.get('/profile', async (req, res) => res.json(await tracker.getProfile()));
  api.put('/profile', async (req, res) => res.json(await tracker.saveProfile(req.body)));

  api.post('/weights', async (req, res) => res.status(201).json(await tracker.logWeight(req.body)));
  api.delete('/weights/:date', async (req, res) => {
    await tracker.deleteWeight(req.params.date);
    res.status(204).end();
  });

  api.get('/meals', async (req, res) => res.json(await tracker.listMeals(req.query.date)));
  api.post('/meals', async (req, res) => res.status(201).json(await tracker.addMeal(req.body)));
  api.post('/meals/copy', async (req, res) => res.json(await tracker.copyMeals(req.body ?? {})));
  api.put('/meals/:id', async (req, res) => res.json(await tracker.updateMeal(req.params.id, req.body)));
  api.delete('/meals/:id', async (req, res) => {
    await tracker.deleteMeal(req.params.id);
    res.status(204).end();
  });
  api.get('/recent-foods', async (req, res) => res.json(await tracker.recentFoods(req.query.date)));

  api.put('/water', async (req, res) => res.json(await tracker.setWater(req.body)));

  api.post('/exercises', async (req, res) => res.status(201).json(await tracker.addExercise(req.body)));
  api.delete('/exercises/:id', async (req, res) => {
    await tracker.deleteExercise(req.params.id);
    res.status(204).end();
  });

  api.post('/measurements', async (req, res) => res.status(201).json(await tracker.logMeasurement(req.body)));
  api.delete('/measurements/:date', async (req, res) => {
    await tracker.deleteMeasurement(req.params.date);
    res.status(204).end();
  });

  api.put('/checkins', async (req, res) => res.json(await tracker.logCheckin(req.body)));
  api.delete('/checkins/:date', async (req, res) => {
    await tracker.deleteCheckin(req.params.date);
    res.status(204).end();
  });

  api.post('/fasts/start', async (req, res) => res.status(201).json(await tracker.startFast(req.body?.time)));
  api.post('/fasts/end', async (req, res) => res.json(await tracker.endFast(req.body?.time)));
  api.delete('/fasts/:id', async (req, res) => {
    await tracker.deleteFast(req.params.id);
    res.status(204).end();
  });

  api.get('/foods', async (req, res) => res.json(await tracker.searchFoods(req.query.q)));

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

  api.get('/my-foods', async (req, res) => res.json(await tracker.listFoods()));
  api.post('/my-foods', async (req, res) => res.status(201).json(await tracker.addFood(req.body)));
  api.delete('/my-foods/:id', async (req, res) => {
    await tracker.deleteFood(req.params.id);
    res.status(204).end();
  });

  api.get('/export', async (req, res) => {
    res.attachment('tracker-export.json');
    res.json(await tracker.exportData());
  });
  api.post('/import', async (req, res) => res.json(await tracker.importData(req.body)));
  api.post('/demo', async (req, res) => {
    await tracker.loadDemo(req.body?.today);
    res.status(204).end();
  });
  api.post('/reset', async (req, res) => {
    await tracker.reset();
    res.status(204).end();
  });

  api.use((req, res) => res.status(404).json({ error: 'Not found.' }));
  // Express 5 forwards rejected promises here.
  api.use((err, req, res, next) => {
    const status = err.status ?? err.statusCode ?? 500;
    if (status >= 500) console.error(err);
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
