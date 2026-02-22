import db from "../db/index.js";

/**
 * Middleware: requires the authenticated user to have a verified email.
 *
 * Must be used after an auth middleware that sets req.user = { id: string }.
 * Returns 401 if no authenticated user is present, 403 if the user's email
 * has not been verified yet.
 */
export function requireEmailVerified(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required." });
  }

  const user = db
    .prepare("SELECT email_verified FROM users WHERE id = ?")
    .get(req.user.id);

  if (!user) {
    return res.status(401).json({ error: "Authentication required." });
  }

  if (!user.email_verified) {
    return res.status(403).json({
      error:
        "Email verification required. Please check your inbox or request a new verification email.",
    });
  }

  next();
}
