import type { RequestHandler } from 'express';
import { pool } from '../../db/pool.js';
import { HttpError } from '../../middleware/error.js';

/**
 * Use AFTER requireAuth. Restricts a route to accounts flagged as dataset
 * testers.
 *
 * The flag is read from the database on every call rather than carried in the
 * JWT. Tokens live long enough that a granted or revoked tester flag would
 * take effect only after the user's next login, and revocation in particular
 * has to be immediate — this gates the ability to write rows into a research
 * corpus and to read back stored audio.
 *
 * The cost is one indexed primary-key lookup on a route family that a handful
 * of accounts hit a few dozen times a day, which is not worth caching.
 */
export const requireTester: RequestHandler = (req, _res, next) => {
  const user = req.user;
  if (!user) return next(new HttpError(401, 'no_token', 'Not authenticated'));

  pool
    .query<{ is_tester: boolean }>(
      `SELECT COALESCE(is_tester, false) AS is_tester FROM users WHERE id = $1`,
      [user.id],
    )
    .then(({ rows }) => {
      if (!rows[0]?.is_tester) {
        return next(
          new HttpError(403, 'not_a_tester', 'Dataset collection is restricted to testers.'),
        );
      }
      next();
    })
    .catch(next);
};
