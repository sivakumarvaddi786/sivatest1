import db from "../db/index.js";
import { getTodayForTimezone } from "./date.js";

/**
 * Adds N days to a YYYY-MM-DD date string and returns the result as YYYY-MM-DD.
 */
function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Counts how many of the 5 habit categories were completed for a given user/date.
 *
 * Categories (5 total):
 *   1. Steps — met if steps >= daily_steps goal
 *   2. Hydration — met if hydration_glasses >= hydration goal
 *   3. Sleep — met if sleep_hours >= 7
 *   4. Movement — met if movement_done = 1
 *   5. Food — met if any food checkbox is checked
 */
export function countCompletedCategories(userId, dateStr) {
  const log = db
    .prepare("SELECT * FROM daily_logs WHERE user_id = ? AND log_date = ?")
    .get(userId, dateStr);

  if (!log) return 0;

  const goals = db
    .prepare("SELECT daily_steps, hydration_glasses FROM habits_config WHERE user_id = ?")
    .get(userId);

  let count = 0;

  // Steps
  if (log.steps != null && log.steps >= (goals?.daily_steps ?? 10000)) count++;

  // Hydration
  if (
    log.hydration_glasses != null &&
    log.hydration_glasses >= (goals?.hydration_glasses ?? 8)
  )
    count++;

  // Sleep
  if (log.sleep_hours != null && log.sleep_hours >= 7) count++;

  // Movement
  if (log.movement_done === 1) count++;

  // Food (any of the 3 checkboxes)
  if (
    log.food_vegetables === 1 ||
    log.food_no_junk === 1 ||
    log.food_breakfast === 1
  )
    count++;

  return count;
}

const STREAK_THRESHOLD = 3;
const SHIELD_STREAK_INTERVAL = 7;
const MAX_SHIELDS = 1;

/**
 * Evaluates the user's streak for any unevaluated days since their last check.
 *
 * Called on dashboard/habits access. On each new day:
 * - Checks the previous day(s) that haven't been evaluated yet
 * - If a day has >= 3/5 categories completed, streak increments
 * - If < 3 and a shield is available, shield is consumed (streak preserved, not incremented)
 * - If < 3 and no shield, streak resets to 0
 * - Updates longest_streak if current exceeds it
 *
 * Uses streak_last_evaluated_date to avoid re-processing.
 */
export function evaluateStreakIfNeeded(userId, timezone) {
  const today = getTodayForTimezone(timezone);

  const user = db
    .prepare(
      `SELECT streak_last_evaluated_date, current_streak, longest_streak, streak_shields
       FROM users WHERE id = ?`
    )
    .get(userId);

  const lastEval = user.streak_last_evaluated_date;

  // First time: set to today without changing streak (no previous day to evaluate)
  if (!lastEval) {
    db.prepare(
      "UPDATE users SET streak_last_evaluated_date = ? WHERE id = ?"
    ).run(today, userId);
    return;
  }

  // Already evaluated for today or later
  if (lastEval >= today) return;

  const yesterday = addDays(today, -1);

  let currentStreak = user.current_streak;
  let longestStreak = user.longest_streak;
  let shields = user.streak_shields;

  // Evaluate each day from lastEval+1 through yesterday (inclusive)
  let evalDate = addDays(lastEval, 1);
  while (evalDate <= yesterday) {
    const completed = countCompletedCategories(userId, evalDate);

    if (completed >= STREAK_THRESHOLD) {
      currentStreak++;
      // Award a shield for every 7-day streak completed (max 1 in reserve)
      if (currentStreak > 0 && currentStreak % SHIELD_STREAK_INTERVAL === 0 && shields < MAX_SHIELDS) {
        shields++;
      }
    } else if (shields > 0) {
      shields--;
      // Streak preserved but not incremented
    } else {
      currentStreak = 0;
    }

    longestStreak = Math.max(longestStreak, currentStreak);
    evalDate = addDays(evalDate, 1);
  }

  db.prepare(
    `UPDATE users SET current_streak = ?, longest_streak = ?, streak_shields = ?,
     streak_last_evaluated_date = ? WHERE id = ?`
  ).run(currentStreak, longestStreak, shields, today, userId);
}
