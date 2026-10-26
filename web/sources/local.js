// Data source for the static build: the real tracker service from core/,
// running in the browser on a store saved to localStorage.
import { searchOnline } from '../core/off.js';
import { createTracker } from '../core/service.js';
import { createMemoryStore } from '../core/store-memory.js';

const KEY = 'steady-tracker-v1';

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

function persist(snapshot) {
  try {
    localStorage.setItem(KEY, JSON.stringify(snapshot));
  } catch {
    // Private mode or storage full: the app still works for this visit.
  }
}

const saved = load();
const tracker = createTracker(createMemoryStore(saved, persist));

export const source = {
  mode: 'local',
  /** Nothing saved yet: a fresh install, or a visitor from the portfolio. */
  firstVisit: saved === null,
  ...tracker,
  searchOnline: (text) => searchOnline(text),
};
