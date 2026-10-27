// Accounts: bcrypt password hashes, signed JWTs and database-backed rate limits.
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createHash } from 'node:crypto';
import { ValidationError } from '../core/validate.js';

const BCRYPT_COST = 10;
const TOKEN_LIFETIME = '30d';
// Compared against when an email has no account, so a wrong email takes as
// long as a wrong password and doesn't reveal which emails are signed up.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_COST);

export const DEFAULT_LIMITS = {
  signup: { max: 5, windowSec: 3600 },
  login: { max: 10, windowSec: 900 },
  writes: { max: 120, windowSec: 60 },
};

export class HttpError extends Error {
  constructor(status, message, headers = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

export function validateCredentials(input) {
  const email = String(input?.email ?? '').trim().toLowerCase();
  const password = String(input?.password ?? '');
  const errors = [];
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Enter a valid email address.');
  if (password.length < 8) errors.push('Password must be at least 8 characters.');
  // bcrypt only reads the first 72 bytes.
  else if (Buffer.byteLength(password) > 72) errors.push('Password must be at most 72 bytes.');
  if (errors.length) throw new ValidationError(errors);
  return { email, password };
}

const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 32);

export function createAuth(db, { jwtSecret, limits = DEFAULT_LIMITS }) {
  const secret = () => {
    if (!jwtSecret) {
      console.error('JWT_SECRET_KEY is not set, so nobody can log in.');
      throw new HttpError(500, 'Something went wrong.');
    }
    return jwtSecret;
  };
  const issue = (user) => ({
    token: jwt.sign({ sub: String(user.id) }, secret(), { algorithm: 'HS256', expiresIn: TOKEN_LIFETIME }),
    user: { email: user.email },
  });

  /** Count one hit against `key`; throws 429 once the window is full. */
  async function limit(kind, key) {
    const { max, windowSec } = limits[kind];
    const ms = windowSec * 1000;
    const start = Math.floor(Date.now() / ms) * ms;
    const { rows } = await db.query(
      `INSERT INTO rate_limits (key, window_start, hits) VALUES ($1, $2::timestamptz, 1)
       ON CONFLICT (key, window_start) DO UPDATE SET hits = rate_limits.hits + 1
       RETURNING hits`,
      [`${kind}:${key}`, new Date(start).toISOString()],
    );
    // Old windows are useless; clear them out now and then.
    if (Math.random() < 0.02) {
      db.query(`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`).catch(() => {});
    }
    if (rows[0].hits > max) {
      const wait = Math.max(1, Math.ceil((start + ms - Date.now()) / 1000));
      const when = wait < 90 ? `${wait} seconds` : `${Math.ceil(wait / 60)} minutes`;
      throw new HttpError(429, `Too many attempts. Try again in ${when}.`, { 'retry-after': String(wait) });
    }
  }

  async function findUser(id) {
    const { rows } = await db.query('SELECT id, email FROM users WHERE id = $1', [id]);
    return rows[0] ?? null;
  }

  async function checkPassword(email, password) {
    const { rows } = await db.query('SELECT id, email, password_hash FROM users WHERE email = $1', [email]);
    const ok = await bcrypt.compare(password, rows[0]?.password_hash ?? DUMMY_HASH);
    return ok && rows[0] ? rows[0] : null;
  }

  return {
    limit,

    async register(input, ip) {
      secret();
      await limit('signup', sha(ip));
      const { email, password } = validateCredentials(input);
      const hash = await bcrypt.hash(password, BCRYPT_COST);
      const { rows } = await db.query(
        `INSERT INTO users (email, password_hash) VALUES ($1, $2)
         ON CONFLICT (email) DO NOTHING RETURNING id, email`,
        [email, hash],
      );
      if (!rows[0]) throw new HttpError(409, 'An account with that email already exists. Log in instead.');
      return issue(rows[0]);
    },

    async login(input, ip) {
      secret();
      const email = String(input?.email ?? '').trim().toLowerCase();
      const password = String(input?.password ?? '');
      await limit('login', sha(ip));
      await limit('login', sha(`email:${email}`));
      const user = email && password ? await checkPassword(email, password) : null;
      if (!user) throw new HttpError(401, 'Email or password is incorrect.');
      return issue(user);
    },

    async deleteAccount(userId, password) {
      const user = await findUser(userId);
      if (!user || !(await checkPassword(user.email, String(password ?? '')))) {
        throw new HttpError(401, 'Password is incorrect.');
      }
      // Every tracker table cascades from users.
      await db.query('DELETE FROM users WHERE id = $1', [userId]);
    },

    /** Express middleware: a valid token for an existing user, or 401. */
    async requireUser(req, res, next) {
      const header = req.get('authorization') ?? '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      let id = null;
      try {
        id = Number(jwt.verify(token, secret(), { algorithms: ['HS256'] }).sub);
      } catch (err) {
        if (err instanceof HttpError) throw err;
      }
      const user = Number.isInteger(id) ? await findUser(id) : null;
      if (!user) throw new HttpError(401, 'Please log in.');
      req.user = user;
      next();
    },
  };
}
