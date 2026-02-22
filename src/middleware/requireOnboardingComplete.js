import db from "../db/index.js";

/**
 * The number of onboarding steps that must be completed before a user
 * can access protected areas like the dashboard. Increment this constant
 * as new onboarding steps are added.
 */
const TOTAL_ONBOARDING_STEPS = 4;

/**
 * Middleware: requires the authenticated user to have completed all onboarding steps.
 *
 * Must be used after requireAuth (which sets req.user) and requireEmailVerified.
 * Returns 403 if onboarding is not yet complete, including the current step
 * so the client can redirect to the correct onboarding screen.
 */
export function requireOnboardingComplete(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required." });
  }

  const user = db
    .prepare("SELECT onboarding_step FROM users WHERE id = ?")
    .get(req.user.id);

  if (!user || user.onboarding_step < TOTAL_ONBOARDING_STEPS) {
    return res.status(403).json({
      error:
        "Onboarding not complete. Please finish all onboarding steps before accessing the dashboard.",
      onboardingStep: user ? user.onboarding_step : 0,
    });
  }

  next();
}
