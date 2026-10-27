// Sleep and mood check-ins, the weekly report and reminders.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { addDays } from '../core/dates.js';
import { icsFile, normaliseReminders, nudges, schedule } from '../core/reminders.js';
import { dailyHistory, weekStats } from '../core/report.js';
import { createTracker } from '../core/service.js';
import { createMemoryStore } from '../core/store-memory.js';
import { pgStore, startServer } from './helpers.js';

const TODAY = '2026-10-26';
const PROFILE = { name: '', sex: 'female', age: 30, heightCm: 165, activity: 'light', goalKg: 60, weeklyRateKg: 0.5 };

describe('weekly report', () => {
  // A week of 2,000 kcal days, one half-logged day, workouts, water and sleep.
  const end = '2026-10-25';
  const days = Array.from({ length: 7 }, (_, i) => addDays(end, -i));
  const data = {
    meals: [
      ...days.slice(1).map((date) => ({ date, kcal: 2000, protein: 100 })),
      { date: days[0], kcal: 500, protein: 20 },
    ],
    water: days.map((date) => ({ date, ml: 2000 })),
    exercises: [
      { date: days[0], activity: 'gym', minutes: 45, steps: null, kcal: 160 },
      { date: days[1], activity: 'steps', minutes: null, steps: 8000, kcal: 230 },
    ],
    checkins: [
      { date: days[0], sleepHours: 7, sleepQuality: 4, mood: 4 },
      { date: days[1], sleepHours: 6, sleepQuality: 2, mood: 3 },
    ],
  };
  const series = [
    { date: '2026-10-18', trend: 70 },
    { date: '2026-10-25', trend: 69.4 },
  ];
  const fasts = [
    { start: '2026-10-20T12:00:00.000Z', end: '2026-10-21T05:00:00.000Z' },
    { start: '2026-10-22T12:00:00.000Z', end: '2026-10-23T01:00:00.000Z' },
  ];

  test('averages only fully logged days and sums the rest', () => {
    const w = weekStats(data, end, { target: 2000, series, fasts, goalHours: 16 });
    assert.equal(w.start, '2026-10-19');
    assert.equal(w.loggedDays, 6);
    assert.equal(w.avgKcal, 2000);
    assert.equal(w.avgProtein, 100);
    assert.equal(w.onTarget, 6);
    assert.equal(w.workouts, 1);
    assert.equal(w.workoutMinutes, 45);
    assert.equal(w.exerciseKcal, 390);
    assert.equal(w.avgSteps, 8000);
    assert.equal(w.avgWater, 2000);
    assert.equal(w.avgSleep, 6.5);
    assert.equal(w.avgMood, 3.5);
    assert.equal(w.weightChange, -0.6);
    assert.deepEqual([w.fasts, w.fastsOnGoal], [2, 1]);
  });

  test('history has a row for every day, empty ones included', () => {
    const rows = dailyHistory(data, '2026-10-24', '2026-10-27');
    assert.equal(rows.length, 4);
    assert.deepEqual(rows.at(-1), { date: '2026-10-27', kcal: 0, protein: 0, water: 0, exercise: 0, steps: 0, sleep: null, quality: null, mood: null });
    assert.equal(rows[0].steps, 8000);
  });
});

describe('reminders', () => {
  const dash = (over = {}) => ({
    weight: { loggedToday: false },
    today: { meals: [{ slot: 'breakfast', items: [] }, { slot: 'lunch', items: [{}] }, { slot: 'dinner', items: [] }] },
    water: { ml: 250, goal: 2000 },
    ...over,
  });

  test('bad times fall back to the defaults; cleared times stay off', () => {
    const r = normaliseReminders({ lunch: '25:00', dinner: '', water: false });
    assert.deepEqual([r.lunch, r.dinner, r.water], ['12:30', '', false]);
  });

  test('schedule lists meals, weigh-in and water in time order', () => {
    const items = schedule({ water: true });
    assert.equal(items[0].key, 'weighIn');
    assert.equal(items.filter((i) => i.key.startsWith('water')).length, 6);
    assert.ok(items.every((x, i) => i === 0 || items[i - 1].time <= x.time));
  });

  test('nudges point out what is missing, an hour after each meal time', () => {
    const at = (now) => nudges(dash(), now, {}).map((n) => n.key);
    assert.deepEqual(at('07:00'), []);
    // By 9:40 only about 250 ml is expected, which has been drunk.
    assert.deepEqual(at('09:40'), ['weighIn', 'breakfast']);
    assert.deepEqual(at('20:30'), ['breakfast', 'dinner', 'water']);
    assert.deepEqual(nudges(dash({ water: { ml: 1750, goal: 2000 } }), '20:30', {}).map((n) => n.key), ['breakfast', 'dinner']);
  });

  test('calendar file has a daily event with an alert per reminder', () => {
    const ics = icsFile({ water: false, lunch: '23:58' }, TODAY, new Date('2026-10-26T00:00:00Z'));
    assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
    assert.equal(ics.match(/BEGIN:VEVENT/g).length, 4);
    assert.equal(ics.match(/RRULE:FREQ=DAILY/g).length, 4);
    assert.equal(ics.match(/BEGIN:VALARM/g).length, 4);
    assert.match(ics, /DTSTART:20261026T073000/);
    assert.match(ics, /DTEND:20261026T235900/, 'end time never rolls past midnight');
  });
});

for (const [label, makeStore] of [
  ['memory store', () => createMemoryStore()],
  ['Postgres store', pgStore],
]) {
  describe(`check-ins on the ${label}`, () => {
    test('save, update, show on the dashboard and delete', async () => {
      const t = createTracker(await makeStore());
      await t.saveProfile(PROFILE);
      await t.logWeight({ date: TODAY, kg: 64 });
      await t.logCheckin({ date: TODAY, sleepHours: '7.5', sleepQuality: '4', mood: '3' });
      await t.logCheckin({ date: TODAY, sleepHours: 8, mood: 5, note: 'Good run' });
      let d = await t.dashboard(TODAY);
      assert.deepEqual(d.checkin, { date: TODAY, sleepHours: 8, sleepQuality: null, mood: 5, note: 'Good run' });
      assert.equal(d.history.at(-1).mood, 5);
      await assert.rejects(t.logCheckin({ date: TODAY }), /at least one/);
      await assert.rejects(t.logCheckin({ date: TODAY, mood: 9 }), /Mood/);
      await t.deleteCheckin(TODAY);
      d = await t.dashboard(TODAY);
      assert.equal(d.checkin, null);
    });

    test('the sample data fills the weekly report', async () => {
      const t = createTracker(await makeStore());
      await t.loadDemo(TODAY);
      const { report, history } = await t.dashboard(TODAY);
      assert.equal(history.length, 28);
      assert.equal(report.thisWeek.loggedDays, 7);
      assert.ok(report.thisWeek.avgSleep > 6 && report.thisWeek.avgSleep < 9);
      assert.ok(report.thisWeek.workouts >= 3);
    });
  });
}
