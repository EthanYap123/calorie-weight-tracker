// Postgres schema. Every statement is safe to re-run, so `npm run db:setup`
// is the Vercel build step and also runs when the local server starts.
// Every tracker row belongs to one user and is deleted with the account.

const OWNER = 'user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE';

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email         TEXT        NOT NULL UNIQUE,
    password_hash TEXT        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  // Ids are numbered per user (1, 2, 3...), the same as the browser store,
  // so the parity tests can compare whole dashboards.
  `CREATE TABLE IF NOT EXISTS id_counters (
    user_id     INTEGER PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    meals       INTEGER NOT NULL DEFAULT 0,
    foods       INTEGER NOT NULL DEFAULT 0,
    exercises   INTEGER NOT NULL DEFAULT 0,
    fasts       INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS profiles (
    user_id     INTEGER PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    data        JSONB   NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS weights (
    ${OWNER},
    date        TEXT    NOT NULL,
    kg          DOUBLE PRECISION NOT NULL CHECK (kg BETWEEN 30 AND 300),
    PRIMARY KEY (user_id, date)
  )`,
  `CREATE TABLE IF NOT EXISTS meals (
    ${OWNER},
    id          INTEGER NOT NULL,
    date        TEXT    NOT NULL,
    slot        TEXT    NOT NULL CHECK (slot IN ('breakfast', 'lunch', 'dinner', 'snacks')),
    name        TEXT    NOT NULL,
    amount      TEXT    NOT NULL DEFAULT '',
    grams       DOUBLE PRECISION,
    kcal        DOUBLE PRECISION NOT NULL,
    protein     DOUBLE PRECISION NOT NULL,
    carbs       DOUBLE PRECISION NOT NULL,
    fat         DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (user_id, id)
  )`,
  'CREATE INDEX IF NOT EXISTS meals_by_date ON meals (user_id, date)',
  // The user's own foods, per 100 g.
  `CREATE TABLE IF NOT EXISTS foods (
    ${OWNER},
    id            INTEGER NOT NULL,
    name          TEXT    NOT NULL,
    kcal          DOUBLE PRECISION NOT NULL,
    protein       DOUBLE PRECISION NOT NULL,
    carbs         DOUBLE PRECISION NOT NULL,
    fat           DOUBLE PRECISION NOT NULL,
    serving_unit  TEXT,
    serving_grams DOUBLE PRECISION,
    PRIMARY KEY (user_id, id)
  )`,
  `CREATE TABLE IF NOT EXISTS water (
    ${OWNER},
    date        TEXT    NOT NULL,
    ml          DOUBLE PRECISION NOT NULL CHECK (ml > 0),
    PRIMARY KEY (user_id, date)
  )`,
  `CREATE TABLE IF NOT EXISTS exercises (
    ${OWNER},
    id          INTEGER NOT NULL,
    date        TEXT    NOT NULL,
    activity    TEXT    NOT NULL,
    name        TEXT    NOT NULL,
    minutes     DOUBLE PRECISION,
    steps       INTEGER,
    kcal        DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (user_id, id)
  )`,
  'CREATE INDEX IF NOT EXISTS exercises_by_date ON exercises (user_id, date)',
  `CREATE TABLE IF NOT EXISTS measurements (
    ${OWNER},
    date        TEXT    NOT NULL,
    waist_cm    DOUBLE PRECISION,
    neck_cm     DOUBLE PRECISION,
    hip_cm      DOUBLE PRECISION,
    PRIMARY KEY (user_id, date)
  )`,
  // Daily check-in: sleep (hours, quality 1-5), mood 1-5 and a note.
  `CREATE TABLE IF NOT EXISTS checkins (
    ${OWNER},
    date          TEXT    NOT NULL,
    sleep_hours   DOUBLE PRECISION,
    sleep_quality INTEGER,
    mood          INTEGER,
    note          TEXT    NOT NULL DEFAULT '',
    PRIMARY KEY (user_id, date)
  )`,
  `CREATE TABLE IF NOT EXISTS fasts (
    ${OWNER},
    id          INTEGER NOT NULL,
    start       TEXT    NOT NULL,
    "end"       TEXT,
    PRIMARY KEY (user_id, id)
  )`,
  // Fixed-window counters for sign-up, login and write limits. Kept in the
  // database because serverless functions don't share memory.
  `CREATE TABLE IF NOT EXISTS rate_limits (
    key          TEXT        NOT NULL,
    window_start TIMESTAMPTZ NOT NULL,
    hits         INTEGER     NOT NULL,
    PRIMARY KEY (key, window_start)
  )`,
];

/** Create anything missing. Takes a lock so parallel runs don't race. */
export async function setupSchema(db) {
  await db.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(7461)');
    for (const statement of SCHEMA) await tx.query(statement);
  });
}
