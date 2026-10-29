import { MODE } from './config.js';
import { addDays, localToday } from './core/dates.js';
import { nutritionFor, relevance } from './core/foods.js';
import { bmi, bmiCategory, bodyFatCategory, bodyFatNavy, healthyRange, proteinRange } from './core/body.js';
import { ACTIVITIES } from './core/exercise.js';
import { ACTIVITY_LEVELS, bmr, formulaMaintenance } from './core/nutrition.js';
import { fdcBarcode, searchFdc, withPortions } from './core/fdc.js';
import { isBarcode, lookupBarcode } from './core/off.js';
import { applyEntry, parseEntry, resolveAmount, unitsFor } from './core/parse.js';
import { barChart, intakeChart, lineChart, weightChart } from './charts.js';
import { icsFile, normaliseReminders, nudges, schedule } from './core/reminders.js';

const { source } = MODE === 'local' ? await import('./sources/local.js') : await import('./sources/api.js');

const $ = (sel, el = document) => el.querySelector(sel);
const main = $('#main');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmt = (n) => Math.round(n).toLocaleString('en-SG');
const kg = (n, digits = 1) => `${Number(n).toFixed(digits)} kg`;
const SLOT_LABEL = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snacks: 'Snacks' };
const PACES = [0.25, 0.5, 0.75, 1];

const state = {
  today: localToday(),
  date: localToday(),
  tab: 'today',
  range: 90,
  data: null,
  slot: 'breakfast',
  picked: null,
  found: [],
  lastUnit: null,
};

// ---------- theme ----------

const THEME_KEY = 'steady-theme';
const SUN = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

function themeChoice() {
  try {
    return localStorage.getItem(THEME_KEY) || 'light';
  } catch {
    return 'light';
  }
}

/** The theme actually showing, resolving "Match device". */
function activeTheme(choice = themeChoice()) {
  if (choice !== 'system') return choice;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(choice) {
  try {
    localStorage.setItem(THEME_KEY, choice);
  } catch {
    // Not saved, but still applied for this visit.
  }
  document.documentElement.dataset.theme = choice;
  const dark = activeTheme(choice) === 'dark';
  const btn = $('#theme-btn');
  btn.innerHTML = dark ? SUN : MOON;
  btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  btn.title = btn.getAttribute('aria-label');
  $('meta[name="theme-color"]').content = dark ? '#141513' : '#f6f4ef';
}

applyTheme(themeChoice());
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (themeChoice() === 'system') applyTheme('system');
});

// ---------- data ----------

/** The online version needs a login; the browser version never does. */
const signedOut = () => Boolean(source.account && !source.account.loggedIn());

async function refresh() {
  state.today = localToday();
  if (signedOut()) return renderLogin();
  try {
    state.data = await source.dashboard(state.date);
  } catch (err) {
    if (err.status === 401) return renderLogin();
    main.innerHTML = `<div class="card empty"><h2>Can't reach the tracker</h2><p>${esc(err.message)}</p></div>`;
    return;
  }
  render();
}

async function act(fn, success) {
  try {
    await fn();
    if (success) toast(success);
    await refresh();
    return true;
  } catch (err) {
    toast(err.message, true);
    return false;
  }
}

// ---------- shell ----------

function renderHeader() {
  const d = new Date(`${state.date}T00:00:00Z`);
  const label =
    state.date === state.today
      ? 'Today'
      : state.date === addDays(state.today, -1)
        ? 'Yesterday'
        : d.toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  $('#date-label').textContent = label;
  $('[data-day="1"]').disabled = state.date >= state.today;
  for (const b of document.querySelectorAll('[data-tab]')) {
    if (b.dataset.tab === state.tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
}

function renderBanner() {
  const banner = $('#banner');
  // Only portfolio visitors (?demo) see this; everyday use has no banner.
  if (source.mode !== 'local' || !wantsDemo) {
    banner.hidden = true;
    return;
  }
  banner.hidden = false;
  banner.innerHTML = `<div class="wrap banner-inner">
    <span><strong>Sample data.</strong> This is eight weeks of made-up logs. Everything runs in your browser and saves to this device only.</span>
    <button type="button" class="link" data-action="go-settings">Use it yourself</button>
  </div>`;
}

function render() {
  if (signedOut()) return renderLogin();
  document.body.classList.remove('signed-out');
  renderHeader();
  renderBanner();
  const d = state.data;
  if (d.setupNeeded && state.tab !== 'settings') {
    main.innerHTML = setupView(d);
    return;
  }
  main.innerHTML = { today: todayView, body: bodyView, insights: insightsView, tools: toolsView, settings: settingsView }[state.tab](d);
  if (state.tab === 'tools') {
    runCalcs();
    tickFasting();
  }
}

// ---------- account (online version only) ----------

// The login page is the first thing a visitor sees, so point them at the no-account demo.
const DEMO_URL = 'https://ethanyap123.github.io/calorie-weight-tracker/?demo';
const SOURCE_URL = 'https://github.com/EthanYap123/calorie-weight-tracker';

function renderLogin(mode = state.authMode ?? 'login') {
  state.authMode = mode;
  state.data = null;
  document.body.classList.add('signed-out');
  $('#banner').hidden = true;
  const signup = mode === 'signup';
  main.innerHTML = `<section class="setup card">
    <p class="eyebrow">Steady</p>
    <h1>${signup ? 'Create your account' : 'Log in'}</h1>
    <p class="muted">Your meals, weigh-ins and everything else you log sync to every phone and computer you log in on.</p>
    <div class="seg" role="group" aria-label="Log in or sign up">
      <button type="button" data-action="auth-mode" data-mode="login" aria-pressed="${!signup}">Log in</button>
      <button type="button" data-action="auth-mode" data-mode="signup" aria-pressed="${signup}">Create account</button>
    </div>
    <form id="login-form" class="stack">
      <label class="field"><span>Email</span><input name="email" type="email" required autocomplete="email" value="${esc(source.account.email() ?? '')}"></label>
      <label class="field"><span>Password${signup ? ' (at least 8 characters)' : ''}</span><input name="password" type="password" required minlength="${signup ? 8 : 1}" maxlength="72" autocomplete="${signup ? 'new-password' : 'current-password'}"></label>
      <p class="form-error" role="alert"></p>
      <button class="btn primary">${signup ? 'Create account' : 'Log in'}</button>
    </form>
    ${signup ? '<p class="muted small">Already using Steady in the browser-only version? After signing up, go there, choose Settings, Export JSON, then use Import JSON here to bring everything across.</p>' : ''}
  </section>
  <aside class="login-more">
    <a class="btn" href="${DEMO_URL}">Just looking? Try the demo (no account needed) →</a>
    <p class="muted">Steady logs food by the gram and adjusts your calorie target to how your weight actually moves.</p>
    <a class="muted small" href="${SOURCE_URL}">Source on GitHub</a>
  </aside>`;
}

function accountCard() {
  if (!source.account) return '';
  return `<article class="card stack">
      <div class="card-head"><h2>Account</h2></div>
      <p class="muted">Logged in as <strong>${esc(source.account.email() ?? '')}</strong>. Your data syncs to every device you log in on.</p>
      <div class="row wrap-row">
        <button type="button" class="btn" data-action="logout">Log out</button>
        <button type="button" class="btn danger" data-action="delete-account">Delete account</button>
      </div>
    </article>`;
}

// ---------- views ----------

function profileFields(p = {}, withWeight = false) {
  const opt = (value, label, current) =>
    `<option value="${value}" ${String(value) === String(current) ? 'selected' : ''}>${esc(label)}</option>`;
  return `
    <div class="grid2">
      <label class="field"><span>Name (optional)</span><input name="name" maxlength="40" value="${esc(p.name ?? '')}" autocomplete="given-name"></label>
      <label class="field"><span>Sex</span><select name="sex">${opt('male', 'Male', p.sex)}${opt('female', 'Female', p.sex)}</select></label>
      <label class="field"><span>Age</span><input name="age" type="number" min="15" max="100" required value="${p.age ?? ''}" inputmode="numeric"></label>
      <label class="field"><span>Height (cm)</span><input name="heightCm" type="number" min="120" max="230" required value="${p.heightCm ?? ''}" inputmode="numeric"></label>
      ${withWeight ? `<label class="field"><span>Current weight (kg)</span><input name="kg" type="number" min="30" max="300" step="0.1" required inputmode="decimal"></label>` : ''}
      <label class="field"><span>Goal weight (kg)</span><input name="goalKg" type="number" min="30" max="300" step="0.1" required value="${p.goalKg ?? ''}" inputmode="decimal"></label>
      <label class="field wide"><span>Activity</span><select name="activity">${Object.entries(ACTIVITY_LEVELS)
        .map(([k, a]) => opt(k, `${a.label} (${a.hint.toLowerCase()})`, p.activity ?? 'light'))
        .join('')}</select></label>
      <label class="field wide"><span>Pace</span><select name="weeklyRateKg">${PACES.map((r) =>
        opt(r, `${r} kg a week`, p.weeklyRateKg ?? 0.5),
      ).join('')}</select></label>
      ${withWeight ? '' : `
      <label class="field"><span>Water goal (ml)</span><input name="waterGoalMl" type="number" min="500" max="6000" step="50" inputmode="numeric" value="${p.waterGoalMl ?? 2000}"></label>
      <label class="field"><span>Fasting goal (hours)</span><input name="fastingHours" type="number" min="10" max="72" step="1" inputmode="numeric" value="${p.fastingHours ?? 16}"></label>
      <label class="check wide"><input type="checkbox" name="eatBackExercise" ${p.eatBackExercise ? 'checked' : ''}>
        <span>Add exercise calories to my daily target<small>Leave this off if Steady's measured maintenance is in use: it already includes your usual exercise.</small></span></label>`}
    </div>`;
}

function setupView(d) {
  const needsWeightOnly = d.profile && !d.weight.latest;
  return `<section class="setup card">
    <p class="eyebrow">Get started</p>
    <h1>Lose, gain or hold weight without guesswork</h1>
    <p class="muted">Steady works out a daily calorie target from your details, then learns your real maintenance calories from what you log and how your weight moves.</p>
    <form id="setup-form" class="stack">
      ${needsWeightOnly
        ? `<label class="field"><span>Current weight (kg)</span><input name="kg" type="number" min="30" max="300" step="0.1" required inputmode="decimal"></label>`
        : profileFields({}, true)}
      <p class="form-error" role="alert"></p>
      <div class="row">
        <button class="btn primary">Start tracking</button>
        <button type="button" class="btn ghost" data-action="demo">Try it with sample data</button>
      </div>
    </form>
    ${source.mode === 'api'
      ? `<p class="muted">Moving from the browser-only version? Export JSON from its Settings, then import the file here.</p>
         <div class="row"><label class="btn">Import JSON<input type="file" accept="application/json,.json" id="import-file" hidden></label></div>`
      : ''}
  </section>`;
}

function ring(eaten, target) {
  const r = 70;
  const c = 2 * Math.PI * r;
  const frac = target ? Math.min(eaten / target, 1) : 0;
  const over = target && eaten > target;
  return `<svg class="ring ${over ? 'over' : ''}" viewBox="0 0 168 168" aria-hidden="true">
    <circle class="ring-bg" cx="84" cy="84" r="${r}"/>
    <circle class="ring-fg" cx="84" cy="84" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - frac)}"/>
  </svg>`;
}

function macroBar(label, cls, value, target) {
  const pct = target ? Math.min((value / target) * 100, 100) : 0;
  return `<div class="macro ${cls}">
    <div class="macro-top"><span>${label}</span><span class="num">${fmt(value)}<small> / ${fmt(target)} g</small></span></div>
    <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
  </div>`;
}

function todayView(d) {
  const { totals, remaining, meals, burned, budget } = d.today;
  const over = remaining < 0;
  const greeting = d.profile.name && state.date === state.today ? `<p class="eyebrow">Hi ${esc(d.profile.name)}</p>` : '';
  const weighedToday = d.weight.loggedToday;

  return `<section class="today-grid">
    <div class="stack">
      ${nudgeCard(d)}
      <article class="card summary">
        ${greeting}
        <div class="ring-wrap">
          ${ring(totals.kcal, budget)}
          <div class="ring-text">
            <span class="ring-num num">${fmt(Math.abs(remaining))}</span>
            <span class="ring-sub">${over ? 'kcal over' : 'kcal left'}</span>
          </div>
        </div>
        <dl class="kv3">
          <div><dt>Eaten</dt><dd class="num">${fmt(totals.kcal)}</dd></div>
          <div><dt>Exercise</dt><dd class="num">${burned ? `${d.exercise.eatBack ? '+' : ''}${fmt(burned)}` : '0'}</dd></div>
          <div><dt>Target</dt><dd class="num">${fmt(budget)}</dd></div>
        </dl>
        <div class="macros">
          ${macroBar('Protein', 'p', totals.protein, d.macros.protein)}
          ${macroBar('Carbs', 'c', totals.carbs, d.macros.carbs)}
          ${macroBar('Fat', 'f', totals.fat, d.macros.fat)}
        </div>
        ${d.plan.warnings.map((w) => `<p class="note warn">${esc(w)}</p>`).join('')}
      </article>

      ${waterCard(d.water)}

      ${checkinCard(d.checkin)}

      <article class="card">
        <div class="card-head"><h2>Weigh-in</h2>${d.weight.trend ? `<span class="pill">Trend ${kg(d.weight.trend)}</span>` : ''}</div>
        <form id="weigh-form" class="weigh">
          <label class="field inline grow"><span class="sr-only">Weight in kg</span>
            <input name="kg" type="number" min="30" max="300" step="0.1" required inputmode="decimal"
              placeholder="${weighedToday ? d.weight.latest.kg : 'Weight in kg'}" value="${weighedToday ? d.weight.latest.kg : ''}">
          </label>
          <button class="btn primary">${weighedToday ? 'Update' : 'Log'}</button>
        </form>
        <p class="muted small">${weighedToday ? 'Logged for this day. ' : ''}Weigh in each morning before eating. Steady smooths out daily water swings.</p>
      </article>

      ${exerciseCard(d.exercise)}
    </div>

    <div class="stack">
      <button type="button" class="btn primary log-btn" data-action="log-food">+ Log food</button>
      ${meals.map(mealCard).join('')}
    </div>
  </section>`;
}

function waterCard(w) {
  const pct = Math.min(100, Math.round((w.ml / w.goal) * 100));
  const glasses = Math.round(w.ml / 250);
  return `<article class="card water-card">
    <div class="card-head"><h2>Water</h2><span class="num muted">${fmt(w.ml)} / ${fmt(w.goal)} ml</span></div>
    <div class="bar-track water-track"><div class="bar-fill" style="width:${pct}%"></div></div>
    <div class="row wrap-row">
      <button type="button" class="btn" data-action="water" data-ml="250">+ 250 ml</button>
      <button type="button" class="btn" data-action="water" data-ml="500">+ 500 ml</button>
      <button type="button" class="btn ghost" data-action="water" data-ml="-250" ${w.ml ? '' : 'disabled'} aria-label="Remove 250 ml">− 250</button>
      <span class="muted small">${glasses} glass${glasses === 1 ? '' : 'es'}${pct >= 100 ? ' · goal reached' : ''}</span>
    </div>
  </article>`;
}

function exerciseCard(e) {
  return `<article class="card">
    <div class="card-head"><h2>Exercise</h2><span class="num muted">${fmt(e.kcal)} kcal burned</span></div>
    ${e.items.length ? `<ul class="items">${e.items.map((x) => `<li>
      <div class="item-main"><span class="item-name">${esc(x.name)}</span>
        <span class="item-meta">${x.minutes ? `${x.minutes} min` : x.steps ? 'Walking' : ''}</span></div>
      <span class="num">${fmt(x.kcal)}</span>
      <button type="button" class="icon-btn subtle" data-action="del-exercise" data-id="${x.id}" aria-label="Remove ${esc(x.name)}">✕</button>
    </li>`).join('')}</ul>` : ''}
    <form id="exercise-form" class="ex-form">
      <select name="activity" aria-label="Activity">
        <option value="steps">Steps</option>
        ${ACTIVITIES.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}
      </select>
      <input name="amount" type="number" min="1" step="1" required inputmode="numeric" placeholder="Steps" aria-label="Steps or minutes">
      <button class="btn">Add</button>
    </form>
    <p class="muted small">${e.eatBack
      ? 'Exercise calories are added to your target.'
      : 'Shown for your information, not added to your target. You can change this in Settings.'}</p>
  </article>`;
}

function mealCard({ slot, items, kcal }) {
  return `<article class="card meal">
    <div class="card-head">
      <h2>${SLOT_LABEL[slot]}</h2>
      <span class="num muted">${fmt(kcal)} kcal</span>
    </div>
    ${items.length ? `<ul class="items">${items.map((m) => `
      <li>
        <button type="button" class="item-main item-edit" data-action="edit-meal" data-id="${m.id}" aria-label="Edit ${esc(m.name)}">
          <span class="item-name">${esc(m.name)}</span>
          <span class="item-meta">${m.amount ? `${esc(m.amount)} · ` : ''}P ${fmt(m.protein)} · C ${fmt(m.carbs)} · F ${fmt(m.fat)}</span>
        </button>
        <span class="num">${fmt(m.kcal)}</span>
        <button type="button" class="icon-btn subtle" data-action="del-meal" data-id="${m.id}" aria-label="Remove ${esc(m.name)}">✕</button>
      </li>`).join('')}</ul>` : ''}
    <div class="row wrap-row meal-actions">
      <button type="button" class="add-btn" data-action="add-food" data-slot="${slot}">+ Add food</button>
      ${items.length ? '' : `<button type="button" class="add-btn muted-btn" data-action="copy-meal" data-slot="${slot}">Copy yesterday's ${SLOT_LABEL[slot].toLowerCase()}</button>`}
    </div>
  </article>`;
}

function stat(label, value, sub = '') {
  return `<div class="stat"><span class="stat-label">${label}</span><span class="stat-value num">${value}</span>${sub ? `<span class="stat-sub">${sub}</span>` : ''}</div>`;
}

const shortDay = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

function bodyView(d) {
  const w = d.weight;
  const toGo = d.profile.goalKg - w.trend;
  const rate = w.weeklyRate;
  const rateText = rate === null ? '–' : `${rate > 0 ? '+' : ''}${rate.toFixed(2)}`;
  const eta = w.goal
    ? w.goal.weeks === 0
      ? 'Reached'
      : new Date(`${w.goal.date}T00:00:00Z`).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    : '–';
  const recent = [...w.series].reverse().slice(0, 10);

  return `<section class="stack">
    <div class="stats">
      ${stat('Trend weight', kg(w.trend), `Started at ${kg(w.start.kg)}`)}
      ${stat('Pace', `${rateText}<small> kg/wk</small>`, rate === null ? 'Needs a week of weigh-ins' : 'Last 3 weeks')}
      ${stat('To goal', Math.abs(toGo) < 0.1 ? 'At goal' : kg(Math.abs(toGo)), `Goal ${kg(d.profile.goalKg)}`)}
      ${stat('Goal date', eta, w.goal && w.goal.weeks ? `About ${w.goal.weeks} weeks at this pace` : 'At your current pace')}
    </div>

    <article class="card">
      <div class="card-head">
        <h2>Weight trend</h2>
        <div class="seg small" role="group" aria-label="Chart range">
          ${[30, 90, 180].map((n) => `<button type="button" data-action="range" data-range="${n}" aria-pressed="${state.range === n}">${n}d</button>`).join('')}
        </div>
      </div>
      ${weightChart(w.series, { goalKg: d.profile.goalKg, end: state.date, days: state.range })}
      <p class="legend"><span class="key dot"></span>Daily weigh-in <span class="key line"></span>Trend <span class="key dash"></span>Goal</p>
    </article>

    <div class="two-col">
      ${bmiCard(d)}
      ${measureCard(d)}
    </div>

    <article class="card">
      <div class="card-head"><h2>Recent weigh-ins</h2></div>
      <table class="table">
        <thead><tr><th>Date</th><th class="r">Scale</th><th class="r">Trend</th><th></th></tr></thead>
        <tbody>${recent.map((p) => `<tr>
          <td>${shortDay(p.date)}</td>
          <td class="r num">${p.kg.toFixed(1)}</td>
          <td class="r num">${p.trend.toFixed(1)}</td>
          <td class="r"><button type="button" class="icon-btn subtle" data-action="del-weight" data-date="${p.date}" aria-label="Delete weigh-in on ${p.date}">✕</button></td>
        </tr>`).join('')}</tbody>
      </table>
    </article>
  </section>`;
}

/** BMI on a 15-35 scale with the Asian bands shaded. */
function bmiScale(value) {
  const pos = (v) => Math.min(100, Math.max(0, ((v - 15) / 20) * 100));
  return `<div class="bmi-scale" aria-hidden="true">
    <span class="band b1" style="width:${pos(18.5)}%"></span><span class="band b2" style="width:${pos(23) - pos(18.5)}%"></span><span class="band b3" style="width:${pos(27.5) - pos(23)}%"></span><span class="band b4" style="width:${100 - pos(27.5)}%"></span>
    <span class="marker" style="left:${pos(value)}%"></span>
  </div>
  <div class="bmi-ticks muted small">${[18.5, 23, 27.5].map((v) => `<span style="left:${pos(v)}%">${v}</span>`).join('')}</div>`;
}

function bmiCard(d) {
  const b = d.body;
  const t = d.weight.trend;
  const diff = t < b.healthy.min ? b.healthy.min - t : t > b.healthy.max ? t - b.healthy.max : 0;
  return `<article class="card">
    <div class="card-head"><h2>BMI</h2><span class="pill">${esc(b.asian.label)}</span></div>
    <div class="bmi-top"><span class="big num">${b.bmi}</span><span class="muted">${esc(b.asian.risk)} (Singapore cut-offs) · WHO: ${esc(b.who.label)}</span></div>
    ${bmiScale(b.bmi)}
    <p>Healthy weight for ${d.profile.heightCm} cm: <strong class="num">${b.healthy.min}–${b.healthy.max} kg</strong>.
      ${diff ? `You're <strong class="num">${diff.toFixed(1)} kg</strong> ${t > b.healthy.max ? 'above' : 'below'} that range.` : 'You are within it.'}</p>
    <p class="muted small">Based on your trend weight. BMI doesn't tell muscle from fat, so read it with your waist and body fat below.</p>
  </article>`;
}

function measureCard(d) {
  const b = d.body;
  const female = d.profile.sex === 'female';
  const today = b.measurements.find((m) => m.date === state.date);
  const val = (k) => (today?.[k] ?? '');
  return `<article class="card">
    <div class="card-head"><h2>Body fat and waist</h2>${b.bodyFat !== null ? `<span class="pill">${esc(b.bodyFatLabel)}</span>` : ''}</div>
    ${b.bodyFat !== null
      ? `<div class="bmi-top"><span class="big num">${b.bodyFat}%</span><span class="muted">body fat (US Navy tape method, about ±3%)</span></div>`
      : `<p class="muted">Measure your waist (at the navel) and neck${female ? ' and hips (widest point)' : ''} to estimate body fat.</p>`}
    ${b.waist.length >= 2 ? lineChart(b.waist.map((w) => ({ date: w.date, value: w.cm })), { unit: 'cm', label: 'Waist over time' }) : ''}
    ${b.waistToHeight ? `<p>Waist-to-height ratio <strong class="num">${b.waistToHeight.ratio}</strong>: ${b.waistToHeight.ok ? 'under 0.5, a healthy sign.' : 'over 0.5, which raises health risks. Aim to bring your waist under half your height.'}</p>` : ''}
    <form id="measure-form" class="grid3">
      <label class="field"><span>Waist cm</span><input name="waistCm" type="number" min="20" max="250" step="0.1" inputmode="decimal" value="${val('waistCm')}"></label>
      <label class="field"><span>Neck cm</span><input name="neckCm" type="number" min="20" max="250" step="0.1" inputmode="decimal" value="${val('neckCm')}"></label>
      <label class="field"><span>Hips cm${female ? '' : ' (optional)'}</span><input name="hipCm" type="number" min="20" max="250" step="0.1" inputmode="decimal" value="${val('hipCm')}"></label>
      <button class="btn primary wide">Save for ${state.date === state.today ? 'today' : shortDay(state.date)}</button>
    </form>
    ${b.measurements.length ? `<table class="table">
      <thead><tr><th>Date</th><th class="r">Waist</th><th class="r">Neck</th><th class="r">Hips</th><th></th></tr></thead>
      <tbody>${b.measurements.map((m) => `<tr><td>${shortDay(m.date)}</td>
        <td class="r num">${m.waistCm ?? '–'}</td><td class="r num">${m.neckCm ?? '–'}</td><td class="r num">${m.hipCm ?? '–'}</td>
        <td class="r"><button type="button" class="icon-btn subtle" data-action="del-measure" data-date="${m.date}" aria-label="Delete measurements on ${m.date}">✕</button></td></tr>`).join('')}</tbody>
    </table>` : ''}
  </article>`;
}

// ---------- check-in, report, reminders ----------

const MOODS = ['😞', '🙁', '😐', '🙂', '😄'];
const MOOD_WORDS = ['Awful', 'Low', 'Okay', 'Good', 'Great'];

function checkinCard(c) {
  const scale = (name, current, labels, aria) =>
    `<div class="chips scale" role="radiogroup" aria-label="${aria}">${labels
      .map((l, i) => `<label class="chip-radio"><input type="radio" name="${name}" value="${i + 1}" ${current === i + 1 ? 'checked' : ''}><span>${l}</span></label>`)
      .join('')}</div>`;
  return `<article class="card">
    <div class="card-head"><h2>Sleep and mood</h2>${c ? '<span class="pill">Saved</span>' : ''}</div>
    <form id="checkin-form" class="stack tight">
      <div class="checkin-row">
        <label class="field"><span>Hours slept</span><input name="sleepHours" type="number" min="0" max="24" step="0.25" inputmode="decimal" value="${c?.sleepHours ?? ''}" placeholder="7.5"></label>
        <div class="field"><span>Sleep quality</span>${scale('sleepQuality', c?.sleepQuality, ['1', '2', '3', '4', '5'], 'Sleep quality from 1 to 5')}</div>
      </div>
      <div class="field"><span>Mood</span>${scale('mood', c?.mood, MOODS, 'Mood')}</div>
      <label class="field"><span>Note (optional)</span><input name="note" maxlength="200" value="${esc(c?.note ?? '')}" placeholder="Slept late, stressful day, felt great after the run…"></label>
      <button class="btn">${c ? 'Update' : 'Save'}</button>
    </form>
  </article>`;
}

function nudgeCard(d) {
  if (state.date !== state.today) return '';
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const list = nudges(d, hhmm, loadReminders());
  if (!list.length) return '';
  return `<article class="card nudges">
    <ul>${list.map((n) => `<li>${esc(n.text)}</li>`).join('')}</ul>
  </article>`;
}

/** "Last 7 days" against "the 7 before", with the change. */
function reportCard(r) {
  const a = r.thisWeek;
  const b = r.lastWeek;
  const range = `${shortDay(a.start)} – ${shortDay(a.end)}`;
  const rows = [
    ['Average calories', a.avgKcal, b.avgKcal, (v) => `${fmt(v)} kcal`, 0],
    ['Average protein', a.avgProtein, b.avgProtein, (v) => `${fmt(v)} g`, 1],
    ['Days logged', a.loggedDays, b.loggedDays, (v) => `${v} / 7`, 1],
    ['Days within 10% of target', a.onTarget, b.onTarget, (v) => `${v}`, 1],
    ['Weight change (trend)', a.weightChange, b.weightChange, (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} kg`, 0],
    ['Workouts', a.workouts, b.workouts, (v) => `${v}`, 1],
    ['Exercise burned', a.exerciseKcal, b.exerciseKcal, (v) => `${fmt(v)} kcal`, 1],
    ['Average steps', a.avgSteps, b.avgSteps, (v) => fmt(v), 1],
    ['Average water', a.avgWater, b.avgWater, (v) => `${fmt(v)} ml`, 1],
    ['Average sleep', a.avgSleep, b.avgSleep, (v) => `${v.toFixed(1)} h`, 1],
    ['Average mood', a.avgMood, b.avgMood, (v) => `${v.toFixed(1)} / 5`, 1],
    ['Fasts reaching your goal', a.fastsOnGoal, b.fastsOnGoal, (v) => `${v}`, 1],
  ];
  // "better" = 1 when up is good, 0 when it depends on your goal (no colour).
  const change = (now, before, better) => {
    if (now === null || before === null || now === before) return '<span class="muted">–</span>';
    const up = now > before;
    const cls = better ? (up ? 'good' : 'bad') : '';
    return `<span class="delta ${cls}">${up ? '▲' : '▼'}</span>`;
  };
  return `<article class="card">
    <div class="card-head"><h2>Weekly report</h2><span class="muted small">${range}</span></div>
    <table class="table report">
      <thead><tr><th></th><th class="r">Last 7 days</th><th class="r">7 before</th><th class="r"></th></tr></thead>
      <tbody>${rows
        .map(([label, now, before, show, better]) => {
          const text = (v) => (v === null || v === undefined ? '–' : show(v));
          return `<tr><td>${label}</td><td class="r num">${text(now)}</td><td class="r num muted">${text(before)}</td><td class="r">${change(now, before, better)}</td></tr>`;
        })
        .join('')}</tbody>
    </table>
    <p class="muted small">Calories and protein average only fully logged days (800 kcal or more). Today isn't counted until it's over.</p>
  </article>`;
}

function historyCharts(d) {
  const h = d.history;
  const pick = (key) => h.map((x) => ({ date: x.date, value: key === 'sleep' || key === 'mood' ? x[key] : x[key] || null }));
  const moodPoints = h.filter((x) => x.mood !== null).map((x) => ({ date: x.date, value: x.mood }));
  return `<div class="two-col">
    <article class="card">
      <div class="card-head"><h2>Water, last 4 weeks</h2><span class="muted small">Goal ${fmt(d.water.goal)} ml</span></div>
      ${barChart(pick('water'), { goal: d.water.goal, unit: 'ml', label: 'Water per day' })}
    </article>
    <article class="card">
      <div class="card-head"><h2>Exercise, last 4 weeks</h2><span class="muted small">kcal burned</span></div>
      ${barChart(pick('exercise'), { unit: 'kcal', label: 'Exercise calories per day' })}
    </article>
    <article class="card">
      <div class="card-head"><h2>Sleep, last 4 weeks</h2><span class="muted small">Adults need 7–9 h</span></div>
      ${barChart(pick('sleep'), { goal: 7, unit: 'h', label: 'Hours slept per night', decimals: 1 })}
    </article>
    <article class="card">
      <div class="card-head"><h2>Mood, last 4 weeks</h2><span class="muted small">1 awful – 5 great</span></div>
      ${lineChart(moodPoints, { min: 1, max: 5, unit: '/ 5', label: 'Mood per day' })}
    </article>
  </div>`;
}

const REMINDER_KEY = 'steady-reminders';
function loadReminders() {
  try {
    return normaliseReminders(JSON.parse(localStorage.getItem(REMINDER_KEY)) ?? {});
  } catch {
    return normaliseReminders();
  }
}
function saveReminders(r) {
  try {
    localStorage.setItem(REMINDER_KEY, JSON.stringify(r));
  } catch {
    toast('Could not save reminders in this browser.', true);
  }
}

function remindersCard() {
  const r = loadReminders();
  const time = (name, label) =>
    `<label class="field"><span>${label}</span><input type="time" name="${name}" value="${r[name]}"></label>`;
  const canNotify = 'Notification' in window;
  return `<article class="card stack">
    <div class="card-head"><h2>Reminders</h2></div>
    <form id="reminder-form" class="grid2">
      ${time('weighIn', 'Weigh-in')}
      ${time('breakfast', 'Breakfast')}
      ${time('lunch', 'Lunch')}
      ${time('dinner', 'Dinner')}
      <label class="check wide"><input type="checkbox" name="water" ${r.water ? 'checked' : ''}><span>Water every 2 hours (10 am – 8 pm)</span></label>
    </form>
    <p class="muted small">Clear a time to turn that reminder off. The app nudges you on the Today screen; for alerts when the app is closed, add them to your phone's calendar.</p>
    <div class="row wrap-row">
      <button type="button" class="btn primary" data-action="calendar">Add to my calendar</button>
      ${canNotify ? `<button type="button" class="btn" data-action="notify">${r.notify && Notification.permission === 'granted' ? 'Notifications on ✓' : 'Notify me while the app is open'}</button>` : ''}
    </div>
  </article>`;
}

let reminderTimers = [];
/** While the app is open, show a notification at each remaining time today. */
function scheduleNotifications() {
  reminderTimers.forEach(clearTimeout);
  reminderTimers = [];
  const r = loadReminders();
  if (!r.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
  const now = new Date();
  for (const item of schedule(r)) {
    const [h, m] = item.time.split(':').map(Number);
    const at = new Date(now);
    at.setHours(h, m, 0, 0);
    const wait = at - now;
    if (wait > 0) {
      reminderTimers.push(
        setTimeout(async () => {
          const reg = await navigator.serviceWorker?.getRegistration?.().catch(() => null);
          const options = { body: item.text, icon: 'icons/icon-192.png', tag: item.key };
          if (reg) reg.showNotification('Steady', options);
          else new Notification('Steady', options);
        }, wait),
      );
    }
  }
}

// ---------- tools ----------

function toolsView(d) {
  const p = d.profile ?? {};
  const w = d.weight.trend ?? '';
  const sexOpts = (cur) => ['male', 'female'].map((s) => `<option value="${s}" ${cur === s ? 'selected' : ''}>${s === 'male' ? 'Male' : 'Female'}</option>`).join('');
  return `<section class="stack">
    ${fastingCard(d.fasting)}
    <div class="tools-grid">
      <article class="card">
        <div class="card-head"><h2>BMI calculator</h2></div>
        <form class="calc grid2" data-calc="bmi">
          <label class="field"><span>Weight kg</span><input name="kg" type="number" step="0.1" inputmode="decimal" value="${w}"></label>
          <label class="field"><span>Height cm</span><input name="cm" type="number" inputmode="decimal" value="${p.heightCm ?? ''}"></label>
        </form>
        <div class="calc-out" data-out="bmi"></div>
      </article>

      <article class="card">
        <div class="card-head"><h2>Calories needed</h2></div>
        <form class="calc grid2" data-calc="energy">
          <label class="field"><span>Sex</span><select name="sex">${sexOpts(p.sex ?? 'male')}</select></label>
          <label class="field"><span>Age</span><input name="age" type="number" inputmode="numeric" value="${p.age ?? ''}"></label>
          <label class="field"><span>Weight kg</span><input name="kg" type="number" step="0.1" inputmode="decimal" value="${w}"></label>
          <label class="field"><span>Height cm</span><input name="cm" type="number" inputmode="decimal" value="${p.heightCm ?? ''}"></label>
          <label class="field wide"><span>Activity</span><select name="activity">${Object.entries(ACTIVITY_LEVELS)
            .map(([k, a]) => `<option value="${k}" ${k === (p.activity ?? 'light') ? 'selected' : ''}>${esc(a.label)}</option>`)
            .join('')}</select></label>
        </form>
        <div class="calc-out" data-out="energy"></div>
      </article>

      <article class="card">
        <div class="card-head"><h2>Body fat calculator</h2></div>
        <form class="calc grid2" data-calc="fat">
          <label class="field"><span>Sex</span><select name="sex">${sexOpts(p.sex ?? 'male')}</select></label>
          <label class="field"><span>Height cm</span><input name="cm" type="number" inputmode="decimal" value="${p.heightCm ?? ''}"></label>
          <label class="field"><span>Waist cm</span><input name="waist" type="number" step="0.1" inputmode="decimal" value="${d.body?.tape.waistCm ?? ''}"></label>
          <label class="field"><span>Neck cm</span><input name="neck" type="number" step="0.1" inputmode="decimal" value="${d.body?.tape.neckCm ?? ''}"></label>
          <label class="field"><span>Hips cm (women)</span><input name="hip" type="number" step="0.1" inputmode="decimal" value="${d.body?.tape.hipCm ?? ''}"></label>
        </form>
        <div class="calc-out" data-out="fat"></div>
      </article>

      <article class="card">
        <div class="card-head"><h2>Protein and water</h2></div>
        <form class="calc grid2" data-calc="needs">
          <label class="field"><span>Weight kg</span><input name="kg" type="number" step="0.1" inputmode="decimal" value="${w}"></label>
        </form>
        <div class="calc-out" data-out="needs"></div>
      </article>
    </div>
  </section>`;
}

/** Fill every calculator's result from its inputs. */
function runCalcs() {
  for (const form of main.querySelectorAll('form[data-calc]')) {
    const f = Object.fromEntries(new FormData(form));
    const n = (k) => Number(f[k]);
    const out = main.querySelector(`[data-out="${form.dataset.calc}"]`);
    let html = '<p class="muted small">Fill in the fields above.</p>';
    if (form.dataset.calc === 'bmi' && n('kg') > 0 && n('cm') > 0) {
      const v = bmi(n('kg'), n('cm'));
      const range = healthyRange(n('cm'));
      html = `<p><span class="big num">${v}</span> ${esc(bmiCategory(v).label)} <span class="muted">(WHO: ${esc(bmiCategory(v, 'who').label)})</span></p>
        <p class="muted small">Healthy range for ${n('cm')} cm: ${range.min}–${range.max} kg (Singapore cut-offs).</p>`;
    } else if (form.dataset.calc === 'energy' && n('kg') > 0 && n('cm') > 0 && n('age') > 0) {
      const prof = { sex: f.sex, age: n('age'), heightCm: n('cm'), activity: f.activity };
      const base = Math.round(bmr(prof, n('kg')));
      const keep = Math.round(formulaMaintenance(prof, n('kg')) / 10) * 10;
      html = `<dl class="calc-list">
        <div><dt>Resting (BMR)</dt><dd class="num">${fmt(base)} kcal</dd></div>
        <div><dt>Maintain weight</dt><dd class="num">${fmt(keep)} kcal</dd></div>
        <div><dt>Lose 0.5 kg a week</dt><dd class="num">${fmt(keep - 550)} kcal</dd></div>
        <div><dt>Gain 0.25 kg a week</dt><dd class="num">${fmt(keep + 275)} kcal</dd></div>
      </dl>`;
    } else if (form.dataset.calc === 'fat') {
      const pct = bodyFatNavy({ sex: f.sex, heightCm: n('cm'), waistCm: n('waist'), neckCm: n('neck'), hipCm: n('hip') });
      if (pct !== null) html = `<p><span class="big num">${pct}%</span> ${esc(bodyFatCategory(pct, f.sex))}</p><p class="muted small">US Navy tape method, about ±3%.</p>`;
    } else if (form.dataset.calc === 'needs' && n('kg') > 0) {
      const pr = proteinRange(n('kg'));
      const ml = Math.round((n('kg') * 35) / 50) * 50;
      html = `<dl class="calc-list">
        <div><dt>Protein</dt><dd class="num">${pr.min}–${pr.max} g a day</dd></div>
        <div><dt>For muscle</dt><dd class="num">${pr.target} g a day</dd></div>
        <div><dt>Water</dt><dd class="num">about ${fmt(ml)} ml a day</dd></div>
      </dl><p class="muted small">Water: 35 ml per kg; drink more in hot weather or when you exercise.</p>`;
    }
    out.innerHTML = html;
  }
}

function fmtHours(h) {
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  return `${hh}h ${String(mm).padStart(2, '0')}m`;
}

function fastingCard(f) {
  const timeOf = (iso) => new Date(iso).toLocaleString('en-SG', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  const active = f.active;
  return `<article class="card fasting">
    <div class="card-head"><h2>Fasting timer</h2><span class="pill">${f.goalHours}:${24 - f.goalHours > 0 ? 24 - f.goalHours : 0} goal</span></div>
    ${active
      ? `<div class="fast-now">
          <span class="big num" data-elapsed="${esc(active.start)}"></span>
          <span class="muted">since ${esc(timeOf(active.start))}</span>
        </div>
        <div class="bar-track"><div class="bar-fill" data-fast-bar="${esc(active.start)}" data-goal="${f.goalHours}" style="width:0%"></div></div>
        <p class="muted small" data-fast-left="${esc(active.start)}" data-goal="${f.goalHours}"></p>
        <button type="button" class="btn primary" data-action="end-fast">End fast</button>`
      : `<p class="muted">Start the timer after your last meal. Your goal is ${f.goalHours} hours (change it in Settings).</p>
        <button type="button" class="btn primary" data-action="start-fast">Start fast now</button>`}
    ${f.recent.length ? `<table class="table">
      <thead><tr><th>Started</th><th class="r">Length</th><th></th></tr></thead>
      <tbody>${f.recent.map((x) => `<tr><td>${esc(timeOf(x.start))}</td>
        <td class="r num">${fmtHours(x.hours)} ${x.hours >= f.goalHours ? '✓' : ''}</td>
        <td class="r"><button type="button" class="icon-btn subtle" data-action="del-fast" data-id="${x.id}" aria-label="Delete fast">✕</button></td></tr>`).join('')}</tbody>
    </table>` : ''}
  </article>`;
}

/** Keep the fasting clock ticking while the Tools tab is open. */
function tickFasting() {
  for (const el of main.querySelectorAll('[data-elapsed]')) {
    el.textContent = fmtHours((Date.now() - Date.parse(el.dataset.elapsed)) / 3600000);
  }
  for (const el of main.querySelectorAll('[data-fast-bar]')) {
    const h = (Date.now() - Date.parse(el.dataset.fastBar)) / 3600000;
    el.style.width = `${Math.min(100, (h / Number(el.dataset.goal)) * 100)}%`;
  }
  for (const el of main.querySelectorAll('[data-fast-left]')) {
    const left = Number(el.dataset.goal) - (Date.now() - Date.parse(el.dataset.fastLeft)) / 3600000;
    el.textContent = left > 0 ? `${fmtHours(left)} to your goal` : 'Goal reached. End the fast whenever you eat.';
  }
}
setInterval(tickFasting, 30000);

function insightsView(d) {
  const a = d.adaptive;
  const plan = d.plan;
  const pct = (n, of) => Math.min(100, Math.round((n / of) * 100));
  const maint = a.ready
    ? `<div class="compare">
        <div><span class="stat-label">Your measured maintenance</span><span class="big num">${fmt(a.maintenance)}<small> kcal</small></span></div>
        <div><span class="stat-label">Formula estimate</span><span class="big num muted">${fmt(plan.formulaMaintenance)}<small> kcal</small></span></div>
      </div>
      <p>Over the last 4 weeks you averaged <strong class="num">${fmt(a.avgIntake)} kcal</strong> on fully logged days while your weight changed by <strong class="num">${a.weeklyChangeKg > 0 ? '+' : ''}${a.weeklyChangeKg} kg a week</strong>. That means you burn about <strong class="num">${fmt(a.maintenance)} kcal</strong> a day, which is ${a.maintenance >= plan.formulaMaintenance ? fmt(a.maintenance - plan.formulaMaintenance) + ' more' : fmt(plan.formulaMaintenance - a.maintenance) + ' fewer'} than the formula guessed. Your target now uses this number.</p>
      <p class="pill ${a.confidence}">${a.confidence === 'high' ? 'High confidence' : 'Medium confidence: keep logging'}</p>`
    : `<p>Your target uses the Mifflin-St Jeor formula for now (<strong class="num">${fmt(plan.formulaMaintenance)} kcal</strong> maintenance). Formulas can be off by 10-20% for any one person. Once you've logged enough, Steady measures your maintenance from your own data and switches over.</p>
      <div class="progress-row"><span>Fully logged days</span><span class="num">${a.loggedDays} / ${a.neededDays}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct(a.loggedDays, a.neededDays)}%"></div></div>
      <div class="progress-row"><span>Weigh-ins</span><span class="num">${a.weighIns} / ${a.neededWeighIns}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct(a.weighIns, a.neededWeighIns)}%"></div></div>`;

  const dir = { lose: 'deficit', gain: 'surplus', maintain: 'balance' }[plan.direction];
  return `<section class="stack">
    <div class="stats">
      ${stat('Daily target', `${fmt(plan.target)}<small> kcal</small>`, `${fmt(Math.abs(plan.dailyDelta))} kcal ${dir}`)}
      ${stat('14-day average', d.intake.average === null ? '–' : `${fmt(d.intake.average)}<small> kcal</small>`, `${d.intake.loggedDays} days logged`)}
      ${stat('Within 10% of target', `${d.intake.onTarget}<small> / ${d.intake.loggedDays}</small>`, 'days in the last two weeks')}
      ${stat('Logging streak', `${d.streak}<small> days</small>`)}
    </div>

    ${reportCard(d.report)}

    <div class="two-col">
      <article class="card">
        <div class="card-head"><h2>Maintenance calories</h2><span class="pill">${plan.source === 'adaptive' ? 'Adaptive' : 'Formula'}</span></div>
        ${maint}
      </article>
      <article class="card">
        <div class="card-head"><h2>Last 14 days</h2></div>
        ${intakeChart(d.intake.days, plan.target)}
        <p class="legend"><span class="key bar-key"></span>Eaten <span class="key bar-key over"></span>More than 10% over <span class="key dash"></span>Target</p>
      </article>
    </div>

    ${historyCharts(d)}

    <article class="card how">
      <h2>How Steady works out your numbers</h2>
      <ol>
        <li><strong>Trend weight.</strong> Each weigh-in pulls an exponentially smoothed average 10% of the way towards it, so a salty dinner doesn't look like a kilo of fat.</li>
        <li><strong>Pace.</strong> A least-squares line through the last three weeks of weigh-ins gives your real rate of change.</li>
        <li><strong>Maintenance.</strong> Average intake minus weight change × 7,700 kcal/kg. Days under 800 kcal count as half-logged and are skipped.</li>
        <li><strong>Target.</strong> Maintenance ± your chosen pace. Loss is capped at 1% of body weight a week and never goes below ${d.profile.sex === 'female' ? '1,200' : '1,500'} kcal.</li>
      </ol>
    </article>
  </section>`;
}

function settingsView(d) {
  const local = source.mode === 'local';
  return `<section class="two-col">
    <article class="card">
      <div class="card-head"><h2>Your details</h2></div>
      <form id="profile-form" class="stack">
        ${profileFields(d.profile ?? {}, false)}
        <p class="form-error" role="alert"></p>
        <button class="btn primary">Save</button>
      </form>
    </article>
    <div class="stack">
    <article class="card stack">
      <div class="card-head"><h2>Appearance</h2></div>
      <div class="seg" role="group" aria-label="Theme">
        ${[['light', 'Light'], ['dark', 'Dark'], ['system', 'Match device']]
          .map(([v, label]) => `<button type="button" data-action="theme" data-theme-pick="${v}" aria-pressed="${themeChoice() === v}">${label}</button>`)
          .join('')}
      </div>
    </article>
    ${accountCard()}
    ${remindersCard()}
    <article class="card stack">
      <div class="card-head"><h2>Food search</h2></div>
      <p class="muted">Foods not in the built-in list are looked up in the USDA FoodData Central database. Without a key you get about 30 searches an hour. A <a href="https://fdc.nal.usda.gov/api-key-signup" target="_blank" rel="noopener">free USDA key</a> (it only needs an email) allows 1,000 an hour. ${source.account ? 'It is saved to your account, so every device you log in on uses it.' : 'It stays on this device.'}</p>
      <form id="fdc-form" class="row wrap-row">
        <label class="field grow"><span>USDA API key</span><input name="key" autocomplete="off" spellcheck="false" placeholder="Using the shared demo key" value="${esc(fdcKey() === 'DEMO_KEY' ? '' : fdcKey())}"></label>
        <button class="btn">Save key</button>
      </form>
      <div class="card-head"><h2>Your data</h2></div>
      <p class="muted">${local ? 'Everything is stored in this browser only. Export a copy to move it to another device.' : 'Stored in your account on the server. Export a copy any time as a backup.'}</p>
      <div class="row wrap-row">
        <button type="button" class="btn" data-action="export">Export JSON</button>
        <label class="btn">Import JSON<input type="file" accept="application/json,.json" id="import-file" hidden></label>
      </div>
      <div class="row wrap-row">
        <button type="button" class="btn ghost" data-action="demo">Load sample data</button>
        <button type="button" class="btn danger" data-action="reset">Start fresh</button>
      </div>
    </article>
    </div>
  </section>`;
}

// ---------- food dialog ----------

const dialog = $('#food-dialog');
const foodQ = $('#food-q');
const results = $('#food-results');
const pick = $('#food-pick');
const pickQty = $('#pick-qty');
const pickUnit = $('#pick-unit');
const foodError = $('#food-error');

/** The meal that fits the time of day, for the main "Log food" button. */
function slotForNow(now = new Date()) {
  const h = now.getHours() + now.getMinutes() / 60;
  if (h >= 5 && h < 10.5) return 'breakfast';
  if (h >= 11 && h < 15) return 'lunch';
  if (h >= 17.5 && h < 21.5) return 'dinner';
  return 'snacks';
}

function setSlot(slot) {
  state.slot = slot;
  for (const b of dialog.querySelectorAll('[data-slot-pick]')) b.setAttribute('aria-checked', b.dataset.slotPick === slot);
}

function openFood(slot) {
  setSlot(slot);
  state.picked = null;
  state.found = [];
  foodQ.value = '';
  results.innerHTML = '';
  pick.hidden = true;
  foodError.textContent = '';
  $('#quick-form').reset();
  setFoodMode('search');
  dialog.showModal();
  foodQ.focus();
  showRecent(++searchSeq);
}

/** With nothing typed, list foods you log often for one-tap logging. */
async function showRecent(seq) {
  state.recent = await source.recentFoods(state.date).catch(() => []);
  if (seq !== searchSeq || foodQ.value.trim()) return;
  results.innerHTML = state.recent.length
    ? `<li class="res-head">Recent</li>` +
      state.recent
        .map(
          (m, i) => `<li><button type="button" data-recent="${i}">
        <span class="res-main"><span class="item-name">${esc(m.name)}</span><span class="item-meta">${esc(m.amount || 'quick add')}${m.count > 1 ? ` · logged ${m.count}×` : ''}</span></span>
        <span class="num res-kcal">${fmt(m.kcal)}<small> kcal</small></span></button></li>`,
        )
        .join('')
    : '';
}

// ---------- edit an entry ----------

const editDialog = $('#edit-dialog');
const editForm = $('#edit-form');

function openEdit(id) {
  const meal = state.data.today.meals.flatMap((s) => s.items).find((m) => m.id === id);
  if (!meal) return;
  state.editing = meal;
  $('.edit-name', editDialog).textContent = meal.name;
  $('.edit-meta', editDialog).textContent = meal.amount ? `Logged as ${meal.amount}` : 'Logged with quick add';
  editForm.elements.qty.value = meal.grams ?? 1;
  $('.edit-qty-label', editDialog).textContent = meal.grams ? 'Weight (g)' : 'Multiply by';
  editForm.elements.slot.value = meal.slot;
  $('#edit-error').textContent = '';
  updateEdit();
  editDialog.showModal();
  editForm.elements.qty.select();
}

/** The edited entry: nutrition scales with the new weight (or multiplier). */
function editedMeal() {
  const m = state.editing;
  const qty = Number(editForm.elements.qty.value);
  if (!(qty > 0)) return null;
  const factor = m.grams ? qty / m.grams : qty;
  const r1 = (x) => Math.round(x * factor * 10) / 10;
  const same = Math.abs(factor - 1) < 1e-9;
  return {
    date: m.date,
    slot: editForm.elements.slot.value,
    name: m.name,
    amount: same ? m.amount : m.grams ? `${Math.round(qty * 10) / 10} g` : `${qty} × ${m.amount || 'portion'}`.slice(0, 60),
    grams: m.grams ? Math.round(qty * 10) / 10 : null,
    kcal: Math.round(m.kcal * factor),
    protein: r1(m.protein),
    carbs: r1(m.carbs),
    fat: r1(m.fat),
  };
}

function updateEdit() {
  const e = editedMeal();
  $('.edit-total', editDialog).innerHTML = e
    ? `<span class="num big">${fmt(e.kcal)}</span> kcal <span class="muted">· P ${e.protein} · C ${e.carbs} · F ${e.fat}</span>`
    : '<span class="warn-text">Enter an amount above 0.</span>';
}
editForm.elements.qty.addEventListener('input', updateEdit);

editForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const meal = editedMeal();
  if (!meal) return;
  try {
    await source.updateMeal(state.editing.id, meal);
    editDialog.close();
    toast('Entry updated');
    await refresh();
  } catch (err) {
    $('#edit-error').textContent = err.message;
  }
});

$('#edit-delete').addEventListener('click', async () => {
  editDialog.close();
  await act(() => source.deleteMeal(state.editing.id), 'Removed');
});
editDialog.addEventListener('click', (e) => {
  if (e.target === editDialog) editDialog.close();
});

function setFoodMode(mode) {
  for (const b of dialog.querySelectorAll('[data-mode]')) b.setAttribute('aria-selected', b.dataset.mode === mode);
  for (const p of dialog.querySelectorAll('[data-pane]')) p.hidden = p.dataset.pane !== mode;
  foodError.textContent = '';
  if (mode === 'mine') renderMine();
}

const r1 = (x) => Math.round(x * 10) / 10;
const per100 = (f) =>
  `Per 100 g: ${fmt(f.kcal)} kcal · P ${r1(f.protein)} · C ${r1(f.carbs)} · F ${r1(f.fat)}`;

function sourceLabel(f) {
  if (f.source.kind === 'usda') return f.source.fdcId ? `USDA FoodData Central #${f.source.fdcId}` : 'USDA FoodData Central';
  if (f.source.kind === 'mine') return 'My food';
  if (f.source.kind === 'off') return `Open Food Facts #${f.source.code}, from the product label`;
  if (f.source.kind === 'fdc') {
    const what = f.source.dataType === 'Branded' ? 'brand label' : f.source.dataType;
    return `USDA FoodData Central #${f.source.fdcId} (${what})`;
  }
  return 'Typical portion (estimate)';
}

let searchSeq = 0;
let onlineTimer = null;

const KEY_STORE = 'steady-fdc-key';
function fdcKey() {
  try {
    return localStorage.getItem(KEY_STORE) || 'DEMO_KEY';
  } catch {
    return 'DEMO_KEY';
  }
}

function setLocalKey(key) {
  try {
    if (key) localStorage.setItem(KEY_STORE, key);
    else localStorage.removeItem(KEY_STORE);
  } catch {
    // Not cached: searches fall back to the demo key on this visit.
  }
}

/** Online version: the account holds the USDA key and this device keeps a copy. */
async function syncSettings() {
  if (!source.account?.loggedIn()) return;
  try {
    setLocalKey((await source.account.settings()).fdcKey);
  } catch {
    // Offline or logged out: keep using the copy on this device.
  }
}

function resultRow(r, i) {
  const kind = r.food.source.kind;
  const tag =
    kind === 'fdc'
      ? r.food.source.dataType === 'Branded' ? ' · brand label' : ' · USDA'
      : ({ typical: ' · estimate', mine: ' · my food', off: ' · label data' }[kind] ?? '');
  return `<li><button type="button" role="option" data-i="${i}" class="${i === 0 ? 'top' : ''}">
    <span class="res-main">
      <span class="item-name">${esc(r.food.name)}</span>
      <span class="item-meta">${r.error ? `<span class="warn-text">${esc(r.error)}</span>` : `${esc(r.amount)}${tag}`}${r.hint ? `<br><span class="muted">${esc(r.hint)}</span>` : ''}</span>
    </span>
    <span class="num res-kcal">${r.error ? '' : `${fmt(r.kcal)}<small> kcal</small>`}</span></button></li>`;
}

/**
 * sections: [{ title, items, empty }]; `status` is a line for the online
 * search (a button, "searching..." or an error).
 */
function renderResults({ local, sections = [], status = null, offerOnline = false }) {
  state.found = [...local, ...sections.flatMap((s) => s.items)];
  const query = parseEntry(foodQ.value).query;
  let i = 0;
  let html = local.map((r) => resultRow(r, i++)).join('');
  for (const s of sections) {
    html += `<li class="res-head">${esc(s.title)}</li>`;
    html += s.items.length ? s.items.map((r) => resultRow(r, i++)).join('') : `<li class="muted small none">${esc(s.empty)}</li>`;
  }
  if (status) html += `<li class="muted small none">${status}</li>`;
  if (offerOnline && query) {
    html += `<li><button type="button" class="online-btn" data-action="online">Search the USDA food database for “${esc(query)}”</button></li>`;
  }
  results.innerHTML = html;
}

/** Online foods carry no portion for a typed unit until picked; show 100 g meanwhile. */
function applyOnline(food, parsed) {
  const r = applyEntry(food, parsed);
  if (!r.error) return r;
  const unit = parsed.unit ?? 'serving';
  return { ...applyEntry(food, { qty: 100, unit: 'g' }), hint: `Showing 100 g. Tap to pick a ${unit} size.` };
}

async function runSearch() {
  const seq = ++searchSeq;
  clearTimeout(onlineTimer);
  const text = foodQ.value.trim();
  pick.hidden = true;
  if (!text) {
    state.found = [];
    showRecent(seq);
    return;
  }
  if (isBarcode(text)) return runBarcode(text, seq);

  const local = await source.searchFoods(text);
  if (seq !== searchSeq) return;
  const query = parseEntry(text).query;
  renderResults({ local, offerOnline: true });
  // Nothing built in: look it up online once typing pauses.
  if (!local.length && query.length >= 3) onlineTimer = setTimeout(() => runOnline(seq), 700);
}
foodQ.addEventListener('input', runSearch);

async function runBarcode(code, seq) {
  results.innerHTML = `<li class="muted small none">Looking up barcode ${esc(code)}…</li>`;
  let food = null;
  let error = null;
  try {
    food = await lookupBarcode(code);
  } catch (err) {
    error = err;
  }
  if (!food) {
    try {
      food = await fdcBarcode(code, { key: fdcKey() });
    } catch (err) {
      error = err;
    }
  }
  if (seq !== searchSeq) return;
  if (!food) {
    state.found = [];
    results.innerHTML = `<li class="muted small none">${error ? esc(error.message) : `Barcode ${esc(code)} isn't in Open Food Facts or USDA.`} You can save it under <button type="button" class="link" data-mode="mine">My foods</button> from the label.</li>`;
    return;
  }
  renderResults({ local: [], sections: [{ title: 'Scanned product', items: [applyOnline(food, { qty: 1, unit: null })] }] });
}

async function runOnline(seq = ++searchSeq) {
  if (seq !== searchSeq) return;
  const parsed = parseEntry(foodQ.value);
  if (!parsed.query) return;
  const local = state.found.filter((r) => !['fdc', 'off'].includes(r.food.source.kind));
  renderResults({ local, status: 'Searching the USDA food database…' });

  const [usda, off] = await Promise.allSettled([
    searchFdc(parsed.query, { key: fdcKey() }),
    source.searchOnline(parsed.query),
  ]);
  if (seq !== searchSeq) return;

  // One list from both sources, best word match first; ties keep USDA's
  // generic foods ahead of brand labels.
  const online = [
    ...(usda.status === 'fulfilled' ? usda.value : []),
    ...(off.status === 'fulfilled' ? off.value.slice(0, 8) : []),
  ]
    .map((food, order) => ({ food, order, score: relevance(food, parsed.query) }))
    .filter((x) => x.score >= 0.5)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, 12)
    .map((x) => applyOnline(x.food, parsed));
  const sections =
    usda.status === 'fulfilled' || online.length
      ? [{ title: 'Online · USDA and Open Food Facts', items: online, empty: `Nothing found online for “${parsed.query}”.` }]
      : [];
  const status = usda.status === 'rejected' ? `<span class="warn-text">${esc(usda.reason.message)}</span>` : null;
  renderResults({ local, sections, status });
}

// Camera barcode scanning where the browser supports it (Chrome on Android).
const scanBtn = $('#scan-btn');
const scanVideo = $('#scan-video');
let scanStream = null;
if ('BarcodeDetector' in window) scanBtn.hidden = false;

async function startScan() {
  try {
    const detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    scanVideo.srcObject = scanStream;
    scanVideo.hidden = false;
    await scanVideo.play();
    while (scanStream) {
      const [code] = await detector.detect(scanVideo).catch(() => []);
      if (code?.rawValue) {
        stopScan();
        foodQ.value = code.rawValue;
        runSearch();
        return;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  } catch {
    stopScan();
    toast('Camera not available. Type the barcode number instead.', true);
  }
}

function stopScan() {
  scanStream?.getTracks().forEach((t) => t.stop());
  scanStream = null;
  scanVideo.hidden = true;
}
scanBtn.addEventListener('click', () => (scanStream ? stopScan() : startScan()));
dialog.addEventListener('close', stopScan);

foodQ.addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  if (!isBarcode(foodQ.value)) await runSearch();
  const top = state.found[0];
  if (!top) return;
  if (top.error || top.hint) choose(0);
  else addMeal(mealFrom(top.food, top.grams, top.amount));
});

results.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="online"]')) {
    clearTimeout(onlineTimer);
    runOnline();
    return;
  }
  const recent = e.target.closest('[data-recent]');
  if (recent) {
    const { count, ...meal } = state.recent[Number(recent.dataset.recent)];
    addMeal(meal);
    return;
  }
  const btn = e.target.closest('[data-i]');
  if (btn) choose(Number(btn.dataset.i));
});

async function choose(i) {
  let r = state.found[i];
  for (const b of results.querySelectorAll('[data-i]')) b.classList.toggle('selected', Number(b.dataset.i) === i);
  if (r.food.source.kind === 'fdc' && !r.food.portions.length) {
    // Generic USDA foods list their household portions separately.
    $('.pick-name', pick).textContent = r.food.name;
    $('.pick-per', pick).textContent = 'Loading portion sizes…';
    pick.hidden = false;
    try {
      const food = await withPortions(r.food, { key: fdcKey() });
      r = applyOnline(food, parseEntry(foodQ.value));
      state.found[i] = r;
    } catch {
      // Grams still work without portions.
    }
  }
  state.picked = r.food;
  const units = unitsFor(r.food);
  pickUnit.innerHTML = units.map((u) => `<option value="${esc(u.unit)}">${esc(u.label)}</option>`).join('');
  const usable = units.some((u) => u.unit === r.unit) && !r.error && !r.hint;
  pickUnit.value = usable ? r.unit : units[0].unit;
  pickQty.value = usable ? r.qty : pickUnit.value === 'g' ? 100 : 1;
  state.lastUnit = pickUnit.value;
  $('.pick-name', pick).textContent = r.food.name;
  $('.pick-per', pick).textContent = `${per100(r.food)} · ${sourceLabel(r.food)}`;
  $('#food-save').hidden = !['off', 'fdc'].includes(r.food.source.kind);
  pick.hidden = false;
  updatePick();
  pickQty.focus();
  pickQty.select();
}

function currentPick() {
  const r = resolveAmount(state.picked, Number(pickQty.value), pickUnit.value);
  return r.error ? r : { ...r, ...nutritionFor(state.picked, r.grams) };
}

function updatePick() {
  const r = currentPick();
  $('.pick-total', pick).innerHTML = r.error
    ? `<span class="warn-text">${esc(r.error)}</span>`
    : `<span class="num big">${fmt(r.kcal)}</span> kcal <span class="muted">· ${fmt(r.grams)} g · P ${r.protein} · C ${r.carbs} · F ${r.fat}</span>`;
  $('#food-add').disabled = Boolean(r.error);
}
pickQty.addEventListener('input', updatePick);
pickUnit.addEventListener('change', () => {
  // Switching to grams/ml starts from the current weight, so nothing jumps.
  const before = resolveAmount(state.picked, Number(pickQty.value) || 1, state.lastUnit ?? pickUnit.value);
  if (['g', 'ml'].includes(pickUnit.value) && !before.error) {
    pickQty.value = Math.round(pickUnit.value === 'ml' ? before.grams / state.picked.density : before.grams);
  } else if (!['g', 'ml'].includes(pickUnit.value) && ['g', 'ml'].includes(state.lastUnit)) {
    pickQty.value = 1;
  }
  state.lastUnit = pickUnit.value;
  updatePick();
});
pickUnit.addEventListener('focus', () => (state.lastUnit = pickUnit.value));
pickQty.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#food-add').click();
});

function mealFrom(food, grams, amount) {
  return { name: food.name, amount, grams, ...nutritionFor(food, grams) };
}

$('#food-save').addEventListener('click', async () => {
  const f = state.picked;
  const serving = f.portions.find((x) => x.unit !== 'g') ?? null;
  try {
    await source.addFood({
      name: f.name,
      kcal: f.kcal,
      protein: f.protein,
      carbs: f.carbs,
      fat: f.fat,
      servingUnit: serving ? serving.unit : '',
      servingGrams: serving?.grams ?? '',
    });
    $('#food-save').hidden = true;
    toast(`Saved ${f.name} to My foods`);
  } catch (err) {
    foodError.textContent = err.message;
  }
});

$('#food-add').addEventListener('click', () => {
  const r = currentPick();
  if (!r.error) addMeal(mealFrom(state.picked, r.grams, r.amount));
});

async function addMeal(meal) {
  foodError.textContent = '';
  try {
    await source.addMeal({ date: state.date, slot: state.slot, ...meal });
    dialog.close();
    toast(`Added ${meal.name} · ${fmt(meal.kcal)} kcal`);
    await refresh();
  } catch (err) {
    foodError.textContent = err.message;
  }
}

$('#quick-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  addMeal({ name: f.name, amount: '', grams: null, kcal: +f.kcal, protein: +f.protein, carbs: +f.carbs, fat: +f.fat });
});

async function renderMine() {
  const foods = await source.listFoods();
  $('#mine-list').innerHTML = foods.length
    ? foods
        .map(
          (f) => `<li>
        <div class="item-main"><span class="item-name">${esc(f.name)}</span>
          <span class="item-meta">${fmt(f.kcal)} kcal per 100 g${f.servingGrams ? ` · 1 ${esc(f.servingUnit)} = ${f.servingGrams} g` : ''}</span></div>
        <button type="button" class="icon-btn subtle" data-action="del-food" data-id="${f.id}" aria-label="Delete ${esc(f.name)}">✕</button>
      </li>`,
        )
        .join('')
    : '';
}

$('#mine-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  foodError.textContent = '';
  try {
    const saved = await source.addFood(Object.fromEntries(new FormData(e.target)));
    e.target.reset();
    toast(`Saved ${saved.name}`);
    setFoodMode('search');
    foodQ.value = saved.name;
    await runSearch();
    foodQ.focus();
  } catch (err) {
    foodError.textContent = err.message;
  }
});

dialog.addEventListener('click', async (e) => {
  const m = e.target.closest('[data-mode]');
  if (m) setFoodMode(m.dataset.mode);
  const s = e.target.closest('[data-slot-pick]');
  if (s) setSlot(s.dataset.slotPick);
  const del = e.target.closest('[data-action="del-food"]');
  if (del && confirm('Delete this saved food? Meals already logged keep their numbers.')) {
    await source.deleteFood(del.dataset.id);
    renderMine();
  }
  if (e.target === dialog) dialog.close(); // backdrop click
});

// ---------- events ----------

document.addEventListener('click', async (e) => {
  const tab = e.target.closest('[data-tab]');
  if (tab) {
    state.tab = tab.dataset.tab;
    render();
    window.scrollTo({ top: 0 });
    return;
  }
  const day = e.target.closest('[data-day]');
  if (day) {
    const next = addDays(state.date, Number(day.dataset.day));
    if (next <= state.today) {
      state.date = next;
      await refresh();
    }
    return;
  }
  if (e.target.closest('#date-label')) {
    state.date = state.today;
    await refresh();
    return;
  }

  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  switch (btn.dataset.action) {
    case 'auth-mode':
      renderLogin(btn.dataset.mode);
      break;
    case 'logout':
      source.account.logout();
      setLocalKey(null);
      state.tab = 'today';
      renderLogin('login');
      break;
    case 'delete-account': {
      const password = prompt('This permanently deletes your account and everything in it. Enter your password to confirm.');
      if (!password) return;
      try {
        await source.account.deleteAccount(password);
        setLocalKey(null);
        state.tab = 'today';
        renderLogin('signup');
        toast('Account deleted');
      } catch (err) {
        toast(err.message, true);
      }
      break;
    }
    case 'add-food':
      openFood(btn.dataset.slot);
      break;
    case 'toggle-theme':
      applyTheme(activeTheme() === 'dark' ? 'light' : 'dark');
      if (state.tab === 'settings') render();
      break;
    case 'theme':
      applyTheme(btn.dataset.themePick);
      render();
      break;
    case 'calendar': {
      const ics = icsFile(loadReminders(), state.today);
      const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: 'steady-reminders.ics' });
      a.click();
      URL.revokeObjectURL(url);
      toast('Open the downloaded file to add the reminders to your calendar');
      break;
    }
    case 'notify': {
      const permission = await Notification.requestPermission();
      saveReminders({ ...loadReminders(), notify: permission === 'granted' });
      scheduleNotifications();
      toast(permission === 'granted' ? 'Notifications on while Steady is open' : 'Notifications are blocked in this browser', permission !== 'granted');
      render();
      break;
    }
    case 'water': {
      const ml = Math.max(0, state.data.water.ml + Number(btn.dataset.ml));
      await act(() => source.setWater({ date: state.date, ml }));
      break;
    }
    case 'del-exercise':
      await act(() => source.deleteExercise(btn.dataset.id), 'Removed');
      break;
    case 'del-measure':
      await act(() => source.deleteMeasurement(btn.dataset.date), 'Measurements deleted');
      break;
    case 'start-fast':
      await act(() => source.startFast(new Date().toISOString()), 'Fast started');
      break;
    case 'end-fast':
      await act(() => source.endFast(new Date().toISOString()), 'Fast ended');
      break;
    case 'del-fast':
      await act(() => source.deleteFast(btn.dataset.id), 'Fast deleted');
      break;
    case 'copy-meal': {
      const from = addDays(state.date, -1);
      try {
        const { copied } = await source.copyMeals({ from, to: state.date, slot: btn.dataset.slot });
        toast(copied ? `Copied ${copied} item${copied === 1 ? '' : 's'} from yesterday` : `Nothing logged for yesterday's ${SLOT_LABEL[btn.dataset.slot].toLowerCase()}`, !copied);
        if (copied) await refresh();
      } catch (err) {
        toast(err.message, true);
      }
      break;
    }
    case 'edit-meal':
      openEdit(Number(btn.dataset.id));
      break;
    case 'log-food':
      openFood(state.date === state.today ? slotForNow() : 'snacks');
      break;
    case 'del-meal':
      await act(() => source.deleteMeal(btn.dataset.id), 'Removed');
      break;
    case 'del-weight':
      await act(() => source.deleteWeight(btn.dataset.date), 'Weigh-in deleted');
      break;
    case 'range':
      state.range = Number(btn.dataset.range);
      render();
      break;
    case 'demo':
      if (state.data.profile && !confirm('Replace everything with eight weeks of sample data?')) return;
      state.date = state.today;
      state.tab = 'today';
      await act(() => source.loadDemo(state.today), 'Sample data loaded');
      break;
    case 'reset':
      if (!confirm('Delete all your meals, weigh-ins and details?')) return;
      state.tab = 'today';
      await act(() => source.reset(), 'All data cleared');
      break;
    case 'go-settings':
      state.tab = 'settings';
      render();
      break;
    case 'export': {
      const data = await source.exportData();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: `steady-export-${state.today}.json` });
      a.click();
      URL.revokeObjectURL(url);
      break;
    }
  }
});

main.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const f = Object.fromEntries(new FormData(form));
  const error = $('.form-error', form);

  if (form.id === 'login-form') {
    const button = $('button.primary', form);
    button.disabled = true;
    try {
      await source.account[state.authMode === 'signup' ? 'register' : 'login'](f.email, f.password);
      await syncSettings();
      state.tab = 'today';
      state.date = localToday();
      await refresh();
    } catch (err) {
      error.textContent = err.message;
      button.disabled = false;
    }
    return;
  }

  if (form.id === 'fdc-form') {
    const key = f.key.trim();
    if (source.account) {
      try {
        await source.account.saveSettings({ fdcKey: key });
      } catch (err) {
        toast(err.message, true);
        return;
      }
      setLocalKey(key);
      toast(key ? 'USDA key saved to your account' : 'Using the shared demo key');
      return;
    }
    try {
      if (key) localStorage.setItem(KEY_STORE, key);
      else localStorage.removeItem(KEY_STORE);
      toast(key ? 'USDA key saved on this device' : 'Using the shared demo key');
    } catch {
      toast('Could not save the key in this browser.', true);
    }
    return;
  }

  if (form.id === 'checkin-form') {
    await act(() => source.logCheckin({ date: state.date, ...f }), 'Check-in saved');
    return;
  }

  if (form.id === 'exercise-form') {
    const entry = f.activity === 'steps'
      ? { date: state.date, activity: 'steps', steps: f.amount }
      : { date: state.date, activity: f.activity, minutes: f.amount };
    await act(() => source.addExercise(entry), 'Exercise added');
    return;
  }

  if (form.id === 'measure-form') {
    await act(() => source.logMeasurement({ date: state.date, ...f }), 'Measurements saved');
    return;
  }

  if (form.id === 'weigh-form') {
    await act(() => source.logWeight({ date: state.date, kg: f.kg }), 'Weigh-in saved');
    return;
  }

  try {
    if (form.id === 'setup-form') {
      if (!state.data.profile) await source.saveProfile(f);
      await source.logWeight({ date: state.date, kg: f.kg });
    } else if (form.id === 'profile-form') {
      await source.saveProfile(f);
      toast('Details saved');
    }
    await refresh();
  } catch (err) {
    if (error) error.textContent = err.message;
  }
});

main.addEventListener('input', (e) => {
  if (e.target.closest('form[data-calc]')) runCalcs();
});

main.addEventListener('change', async (e) => {
  if (e.target.closest('#reminder-form')) {
    const f = e.target.form;
    const val = (n) => f.elements[n].value;
    saveReminders(normaliseReminders({
      ...loadReminders(),
      weighIn: val('weighIn'),
      breakfast: val('breakfast'),
      lunch: val('lunch'),
      dinner: val('dinner'),
      water: f.elements.water.checked,
    }));
    scheduleNotifications();
    toast('Reminders saved');
    return;
  }
  if (e.target.closest('form[data-calc]')) runCalcs();
  if (e.target.name === 'activity' && e.target.closest('#exercise-form')) {
    e.target.form.elements.amount.placeholder = e.target.value === 'steps' ? 'Steps' : 'Minutes';
  }
  if (e.target.id !== 'import-file') return;
  const file = e.target.files[0];
  if (!file) return;
  try {
    const counts = await source.importData(JSON.parse(await file.text()));
    toast(`Imported ${counts.weights} weigh-ins and ${counts.meals} foods`);
    await refresh();
  } catch (err) {
    toast(err instanceof SyntaxError ? 'That file is not valid JSON.' : err.message, true);
  }
});

let toastTimer;
function toast(message, isError = false) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2600);
}

// ---------- start ----------

const params = new URLSearchParams(location.search);
const wantsDemo = params.has('demo');
// ?tab=body opens a tab directly, e.g. from a home-screen bookmark.
if (['today', 'body', 'insights', 'tools', 'settings'].includes(params.get('tab'))) state.tab = params.get('tab');
if (source.firstVisit && wantsDemo) await source.loadDemo(state.today);
await refresh();
syncSettings();
scheduleNotifications();

// Installable and usable offline. Needs https or localhost.
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
