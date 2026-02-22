import db from "../db/index.js";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Middleware: requires a valid session token in the Authorization header.
 *
 * Expects: Authorization: Bearer <token>
 *
 * On success: sets req.user (full user row) and req.sessionId, then calls next().
 * Extends the session's expiry by 30 days from now (sliding inactivity window).
 *
 * Returns:
 *   401 - Missing, invalid, or expired session token
 */
export function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res
      .status(401)
      .json({ error: "Authentication required. Please log in." });
  }

  const token = authHeader.slice(7);

  const session = db
    .prepare("SELECT * FROM sessions WHERE token = ?")
    .get(token);

  if (!session) {
    return res
      .status(401)
      .json({ error: "Invalid session. Please log in again." });
  }

  if (new Date(session.expires_at) < new Date()) {
    // Remove the expired session
    db.prepare("DELETE FROM sessions WHERE id = ?").run(session.id);
    return res
      .status(401)
      .json({ error: "Session expired. Please log in again." });
  }

  // Slide the expiry window: reset to 30 days from now
  const now = new Date().toISOString();
  const newExpiresAt = new Date(Date.now() + THIRTY_DAYS_MS).toISOString();
  db.prepare(
    "UPDATE sessions SET last_active_at = ?, expires_at = ? WHERE id = ?"
  ).run(now, newExpiresAt, session.id);

  // Attach full user to request
  const user = db
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(session.user_id);

  if (!user) {
    return res
      .status(401)
      .json({ error: "User not found. Please log in again." });
  }

  req.user = user;
  req.sessionId = session.id;
  next();
}
