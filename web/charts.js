// Small hand-rolled SVG charts. They return markup strings and scale with
// their container through the viewBox.
import { addDays, daysBetween, toDay } from './core/dates.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const shortDate = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', timeZone: 'UTC' });

function niceStep(range, ticks) {
  const raw = range / ticks;
  const pow = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw);
}

/**
 * Weigh-ins as dots, the smoothed trend as a line, and the goal as a dashed
 * line when it is close enough to show without flattening the data.
 */
export function weightChart(series, { goalKg, end, days }) {
  const W = 640;
  const H = 260;
  const pad = { l: 44, r: 16, t: 16, b: 28 };
  const pts = series.filter((p) => p.date >= addDays(end, -(days - 1)) && p.date <= end);
  if (pts.length < 2) {
    return `<div class="chart-empty">Log at least two weigh-ins to see your trend.</div>`;
  }
  // Start at the first weigh-in when the history is shorter than the range.
  const start = pts[0].date;
  days = Math.max(daysBetween(start, end) + 1, 7);

  const values = pts.flatMap((p) => [p.kg, p.trend]);
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const showGoal = goalKg != null && goalKg >= lo - 4 && goalKg <= hi + 4;
  if (showGoal) {
    lo = Math.min(lo, goalKg);
    hi = Math.max(hi, goalKg);
  }
  const step = niceStep(Math.max(hi - lo, 1), 4);
  lo = Math.floor((lo - 0.2) / step) * step;
  hi = Math.ceil((hi + 0.2) / step) * step;

  const d0 = toDay(start);
  const x = (date) => pad.l + ((toDay(date) - d0) / Math.max(days - 1, 1)) * (W - pad.l - pad.r);
  const y = (kg) => pad.t + ((hi - kg) / (hi - lo)) * (H - pad.t - pad.b);

  let grid = '';
  for (let v = lo; v <= hi + 1e-9; v += step) {
    grid += `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/>`;
    grid += `<text class="axis" x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end">${+v.toFixed(1)}</text>`;
  }
  const xLabels = [start, addDays(start, Math.floor((days - 1) / 2)), end]
    .map((d, i) => `<text class="axis" x="${x(d)}" y="${H - 8}" text-anchor="${['start', 'middle', 'end'][i]}">${shortDate(d)}</text>`)
    .join('');

  const goal = showGoal
    ? `<line class="goal" x1="${pad.l}" x2="${W - pad.r}" y1="${y(goalKg)}" y2="${y(goalKg)}"/>
       <text class="goal-label" x="${W - pad.r}" y="${y(goalKg) - 6}" text-anchor="end">Goal ${goalKg} kg</text>`
    : '';

  const dots = pts
    .map((p) => `<circle class="dot" cx="${x(p.date)}" cy="${y(p.kg)}" r="3.2"><title>${shortDate(p.date)}: ${p.kg} kg (trend ${p.trend.toFixed(1)})</title></circle>`)
    .join('');
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.trend).toFixed(1)}`).join(' ');
  const last = pts.at(-1);

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Weight chart: trend ${last.trend.toFixed(1)} kg on ${esc(shortDate(last.date))}">
    ${grid}${xLabels}${goal}${dots}
    <path class="trend" d="${line}"/>
    <circle class="trend-end" cx="${x(last.date)}" cy="${y(last.trend)}" r="5"/>
  </svg>`;
}

/** Daily kcal bars against the target line. */
export function intakeChart(days, target) {
  const W = 640;
  const H = 220;
  const pad = { l: 44, r: 12, t: 14, b: 28 };
  const max = Math.max(target ?? 0, ...days.map((d) => d.kcal), 500) * 1.1;
  const step = niceStep(max, 4);
  const hi = Math.ceil(max / step) * step;
  const y = (k) => pad.t + ((hi - k) / hi) * (H - pad.t - pad.b);
  const slot = (W - pad.l - pad.r) / days.length;
  const bw = Math.min(28, slot * 0.62);

  let grid = '';
  for (let v = 0; v <= hi; v += step) {
    grid += `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/>`;
    grid += `<text class="axis" x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end">${v.toLocaleString('en-SG')}</text>`;
  }

  const bars = days
    .map((d, i) => {
      const cx = pad.l + slot * (i + 0.5);
      const isLast = i === days.length - 1;
      const over = target && d.kcal > target * 1.1;
      const cls = isLast ? 'bar today' : over ? 'bar over' : 'bar';
      const label = new Date(`${d.date}T00:00:00Z`).toLocaleDateString('en-SG', { weekday: 'narrow', timeZone: 'UTC' });
      const h = Math.max(0, y(0) - y(d.kcal));
      return `<rect class="${cls}" x="${cx - bw / 2}" y="${y(0) - h}" width="${bw}" height="${h}" rx="4"><title>${shortDate(d.date)}: ${d.kcal.toLocaleString('en-SG')} kcal</title></rect>
        <text class="axis" x="${cx}" y="${H - 8}" text-anchor="middle">${label}</text>`;
    })
    .join('');

  const targetLine = target
    ? `<line class="goal" x1="${pad.l}" x2="${W - pad.r}" y1="${y(target)}" y2="${y(target)}"/>`
    : '';

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Calories eaten over the last ${days.length} days">${grid}${bars}${targetLine}</svg>`;
}

/**
 * Daily bars for one value (water, exercise, sleep...), with an optional
 * goal line. `days` is [{date, value}]; null values are left empty.
 */
export function barChart(days, { goal = null, unit = '', label = 'Daily values', decimals = 0 } = {}) {
  const W = 640;
  const H = 200;
  const pad = { l: 44, r: 12, t: 14, b: 26 };
  const values = days.map((d) => d.value ?? 0);
  const max = Math.max(goal ?? 0, ...values, 1) * 1.12;
  const step = niceStep(max, 4);
  const hi = Math.ceil(max / step) * step;
  const y = (v) => pad.t + ((hi - v) / hi) * (H - pad.t - pad.b);
  const slot = (W - pad.l - pad.r) / days.length;
  const bw = Math.min(16, slot * 0.66);
  const show = (v) => (decimals ? v.toFixed(decimals) : Math.round(v).toLocaleString('en-SG'));

  let grid = '';
  for (let v = 0; v <= hi + 1e-9; v += step) {
    grid += `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/>`;
    grid += `<text class="axis" x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end">${+v.toFixed(2)}</text>`;
  }
  const bars = days
    .map((d, i) => {
      const cx = pad.l + slot * (i + 0.5);
      const v = d.value ?? 0;
      const h = Math.max(0, y(0) - y(v));
      const tick = i % 7 === days.length % 7 || i === days.length - 1;
      const reached = goal && v >= goal;
      return `${d.value === null ? '' : `<rect class="bar ${reached ? '' : 'under'}" x="${cx - bw / 2}" y="${y(0) - h}" width="${bw}" height="${h}" rx="3"><title>${shortDate(d.date)}: ${show(v)} ${unit}</title></rect>`}
        ${tick ? `<text class="axis" x="${cx}" y="${H - 8}" text-anchor="middle">${shortDate(d.date)}</text>` : ''}`;
    })
    .join('');
  const goalLine = goal ? `<line class="goal" x1="${pad.l}" x2="${W - pad.r}" y1="${y(goal)}" y2="${y(goal)}"/>` : '';
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${grid}${bars}${goalLine}</svg>`;
}

/** A simple line over time, e.g. waist size or mood. */
export function lineChart(points, { unit = '', label = 'Values over time', min = null, max = null } = {}) {
  if (points.length < 2) return `<div class="chart-empty">Log this at least twice to see a chart.</div>`;
  const W = 640;
  const H = 200;
  const pad = { l: 44, r: 16, t: 14, b: 26 };
  const vals = points.map((p) => p.value);
  let lo = min ?? Math.min(...vals);
  let hi = max ?? Math.max(...vals);
  if (hi - lo < 1) {
    lo -= 0.5;
    hi += 0.5;
  }
  const step = niceStep(hi - lo, 4);
  if (min === null) lo = Math.floor(lo / step) * step;
  if (max === null) hi = Math.ceil(hi / step) * step;
  const d0 = toDay(points[0].date);
  const span = Math.max(1, toDay(points.at(-1).date) - d0);
  const x = (date) => pad.l + ((toDay(date) - d0) / span) * (W - pad.l - pad.r);
  const y = (v) => pad.t + ((hi - v) / (hi - lo)) * (H - pad.t - pad.b);

  let grid = '';
  for (let v = lo; v <= hi + 1e-9; v += step) {
    grid += `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/>`;
    grid += `<text class="axis" x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end">${+v.toFixed(1)}</text>`;
  }
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const dots = points
    .map((p) => `<circle class="trend-end" cx="${x(p.date)}" cy="${y(p.value)}" r="3.5"><title>${shortDate(p.date)}: ${p.value} ${unit}</title></circle>`)
    .join('');
  const ends = [points[0], points.at(-1)]
    .map((p, i) => `<text class="axis" x="${x(p.date)}" y="${H - 8}" text-anchor="${i ? 'end' : 'start'}">${shortDate(p.date)}</text>`)
    .join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${grid}${ends}<path class="trend" d="${path}"/>${dots}</svg>`;
}
