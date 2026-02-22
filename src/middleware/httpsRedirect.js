/**
 * Middleware to enforce HTTPS on all auth endpoints.
 * In production (FORCE_HTTPS=true), redirects HTTP requests to HTTPS.
 * Also handles requests behind a reverse proxy (X-Forwarded-Proto header).
 */
export function enforceHttps(req, res, next) {
  if (process.env.FORCE_HTTPS !== "true") {
    return next();
  }

  // Check if the request is already HTTPS
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  if (proto === "https") {
    return next();
  }

  // Redirect to HTTPS
  const httpsUrl = `https://${req.hostname}${req.originalUrl}`;
  return res.redirect(301, httpsUrl);
}
