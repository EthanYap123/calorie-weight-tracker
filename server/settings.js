// Per-account settings that should follow the user to every device, kept
// apart from the tracker data (they aren't part of export/import).
import { ValidationError } from '../core/validate.js';

export function validateSettings(input) {
  const key = String(input?.fdcKey ?? '').trim();
  // USDA (api.data.gov) keys are 40 letters and digits.
  if (key && !/^[A-Za-z0-9]{20,64}$/.test(key)) {
    throw new ValidationError(['That doesn\'t look like a USDA API key (letters and digits only).']);
  }
  return { fdcKey: key || null };
}

export async function getSettings(db, userId) {
  const { rows } = await db.query('SELECT fdc_key FROM user_settings WHERE user_id = $1', [userId]);
  return { fdcKey: rows[0]?.fdc_key ?? null };
}

export async function saveSettings(db, userId, input) {
  const settings = validateSettings(input);
  await db.query(
    `INSERT INTO user_settings (user_id, fdc_key) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET fdc_key = excluded.fdc_key`,
    [userId, settings.fdcKey],
  );
  return settings;
}
