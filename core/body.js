// Body measures: BMI, healthy weight range, body fat and waist-to-height.

const r1 = (x) => Math.round(x * 10) / 10;

export function bmi(weightKg, heightCm) {
  const m = heightCm / 100;
  return r1(weightKg / (m * m));
}

/**
 * Singapore (HPB/MOH) uses lower cut-offs for Asians, because health risks
 * rise at a lower BMI. WHO's international cut-offs are shown alongside.
 */
export const BMI_SCALES = {
  asian: [
    { max: 18.5, label: 'Underweight', risk: 'Risk of nutritional deficiency' },
    { max: 23, label: 'Healthy', risk: 'Low risk' },
    { max: 27.5, label: 'Overweight', risk: 'Moderate risk' },
    { max: Infinity, label: 'Obese', risk: 'High risk' },
  ],
  who: [
    { max: 18.5, label: 'Underweight' },
    { max: 25, label: 'Normal' },
    { max: 30, label: 'Overweight' },
    { max: Infinity, label: 'Obese' },
  ],
};

export function bmiCategory(value, scale = 'asian') {
  return BMI_SCALES[scale].find((c) => value < c.max);
}

/** Weight range for a healthy BMI at this height (Asian 18.5-22.9 by default). */
export function healthyRange(heightCm, scale = 'asian') {
  const m = heightCm / 100;
  const top = scale === 'asian' ? 22.9 : 24.9;
  return { min: r1(18.5 * m * m), max: r1(top * m * m) };
}

/**
 * US Navy body fat estimate from tape measurements (cm). Women also need
 * hips. Returns null when the measurements can't give a sensible answer.
 */
export function bodyFatNavy({ sex, heightCm, waistCm, neckCm, hipCm }) {
  if (!(heightCm > 0 && waistCm > 0 && neckCm > 0)) return null;
  let pct;
  if (sex === 'female') {
    if (!(hipCm > 0) || waistCm + hipCm - neckCm <= 0) return null;
    pct = 495 / (1.29579 - 0.35004 * Math.log10(waistCm + hipCm - neckCm) + 0.221 * Math.log10(heightCm)) - 450;
  } else {
    if (waistCm - neckCm <= 0) return null;
    pct = 495 / (1.0324 - 0.19077 * Math.log10(waistCm - neckCm) + 0.15456 * Math.log10(heightCm)) - 450;
  }
  return pct > 2 && pct < 70 ? r1(pct) : null;
}

/** ACE body fat bands. */
export function bodyFatCategory(pct, sex) {
  const bands =
    sex === 'female'
      ? [[14, 'Essential fat'], [21, 'Athletic'], [25, 'Fit'], [32, 'Average'], [Infinity, 'High']]
      : [[6, 'Essential fat'], [14, 'Athletic'], [18, 'Fit'], [25, 'Average'], [Infinity, 'High']];
  return bands.find(([max]) => pct < max)[1];
}

/** Keeping your waist under half your height is a simple health check. */
export function waistToHeight(waistCm, heightCm) {
  if (!(waistCm > 0 && heightCm > 0)) return null;
  const ratio = Math.round((waistCm / heightCm) * 100) / 100;
  return { ratio, ok: ratio < 0.5 };
}

/** Daily protein for active people trying to keep or build muscle: 1.6 g/kg. */
export function proteinRange(weightKg) {
  return { min: Math.round(weightKg * 1.2), target: Math.round(weightKg * 1.6), max: Math.round(weightKg * 2.2) };
}
