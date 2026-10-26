// Exercise calories from MET values (Compendium of Physical Activities).
// A MET of 1 is resting, which maintenance calories already cover, so the
// app counts only the extra: (MET - 1) x body weight x hours.

export const ACTIVITIES = [
  ['walking', 'Walking (normal pace)', 3.5],
  ['walking-brisk', 'Walking (brisk)', 4.3],
  ['hiking', 'Hiking', 6.0],
  ['stairs', 'Climbing stairs', 8.8],
  ['running-8', 'Running, 8 km/h (7:30 /km)', 8.3],
  ['running-10', 'Running, 10 km/h (6:00 /km)', 9.8],
  ['running-12', 'Running, 12 km/h (5:00 /km)', 11.8],
  ['cycling-easy', 'Cycling (easy, under 16 km/h)', 4.0],
  ['cycling', 'Cycling (moderate, 19-22 km/h)', 8.0],
  ['spin', 'Stationary bike / spin (moderate)', 6.8],
  ['swimming', 'Swimming laps (moderate)', 5.8],
  ['gym', 'Weight training (general)', 3.5],
  ['gym-hard', 'Weight training (vigorous)', 6.0],
  ['hiit', 'HIIT / circuit training', 8.0],
  ['rowing', 'Rowing machine (moderate)', 7.0],
  ['elliptical', 'Elliptical (moderate)', 5.0],
  ['jump-rope', 'Skipping rope', 11.8],
  ['badminton', 'Badminton (social)', 5.5],
  ['basketball', 'Basketball (casual)', 6.5],
  ['football', 'Football (casual)', 7.0],
  ['tennis', 'Tennis', 7.3],
  ['volleyball', 'Volleyball (casual)', 3.0],
  ['dance', 'Dancing / Zumba', 6.5],
  ['yoga', 'Yoga', 2.5],
  ['pilates', 'Pilates', 3.0],
  ['housework', 'Housework / cleaning', 3.3],
].map(([id, name, met]) => ({ id, name, met }));

export const findActivity = (id) => ACTIVITIES.find((a) => a.id === id) ?? null;

/** Extra kcal burned above resting. */
export function exerciseKcal(met, weightKg, minutes) {
  return Math.round(Math.max(0, met - 1) * weightKg * (minutes / 60));
}

/**
 * Steps: about 100 steps a minute of normal walking (3.5 METs), so each
 * step burns roughly 2.5 x kg / 6000 kcal above resting.
 */
export function stepsKcal(steps, weightKg) {
  return Math.round((steps * 2.5 * weightKg) / 6000);
}
