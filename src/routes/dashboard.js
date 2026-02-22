import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireEmailVerified } from "../middleware/requireEmailVerified.js";
import { requireOnboardingComplete } from "../middleware/requireOnboardingComplete.js";
import db from "../db/index.js";
import { MOVEMENT_EXERCISES, buildFoodHabitsResponse } from "./habits.js";
import { getTodayForTimezone } from "../utils/date.js";
import { getXpForNextLevel, DAILY_XP_CAP } from "../utils/xp.js";
import { evaluateStreakIfNeeded, countCompletedCategories } from "../utils/streak.js";

const router = Router();

// All dashboard routes require authentication, email verification, and completed onboarding
router.use(requireAuth);
router.use(requireEmailVerified);
router.use(requireOnboardingComplete);

/**
 * GET /api/dashboard
 *
 * Returns dashboard home data including the user's assigned mascot and its current
 * mood based on streak status (happy = active streak, sad = no active streak),
 * today's habit checklist progress, XP/level, and an ad banner marker.
 */
router.get("/", (req, res) => {
  // Evaluate streak for any unevaluated days before reading user data
  evaluateStreakIfNeeded(req.user.id, req.user.timezone);

  const user = db
    .prepare(
      "SELECT name, mascot_id, mascot_name, current_streak, longest_streak, streak_shields, xp_total, level, team_reminder_at, timezone FROM users WHERE id = ?"
    )
    .get(req.user.id);

  const team = db
    .prepare(
      `SELECT t.id, t.name, tm.role
       FROM team_members tm
       JOIN teams t ON t.id = tm.team_id
       WHERE tm.user_id = ?`
    )
    .get(req.user.id);

  const today = getTodayForTimezone(user.timezone);

  const habitLog = db
    .prepare("SELECT * FROM daily_logs WHERE user_id = ? AND log_date = ?")
    .get(req.user.id, today);

  const habitGoals = db
    .prepare(
      `SELECT daily_steps, hydration_glasses, sleep_hours_min, sleep_hours_max,
              movement_preference, vegetables_per_day
       FROM habits_config WHERE user_id = ?`
    )
    .get(req.user.id);

  const categoriesCompleted = countCompletedCategories(req.user.id, today);

  const mascotMood = user.current_streak > 0 ? "happy" : "sad";

  // Only surface the reminder if it hasn't fired yet
  const teamReminder =
    user.team_reminder_at && new Date(user.team_reminder_at) > new Date()
      ? { remindAt: user.team_reminder_at }
      : null;

  res.json({
    message: "Welcome to your dashboard!",
    userId: req.user.id,
    name: user.name,
    mascot: user.mascot_id
      ? { id: user.mascot_id, name: user.mascot_name, mood: mascotMood }
      : null,
    streak: {
      current: user.current_streak,
      longest: user.longest_streak,
      shields: user.streak_shields,
      mood: mascotMood,
      categoriesCompletedToday: categoriesCompleted,
      categoriesRequired: 3,
      onTrack: categoriesCompleted >= 3,
    },
    xpTotal: user.xp_total,
    level: user.level,
    xpForNextLevel: getXpForNextLevel(user.level),
    dailyXpEarned: habitLog?.xp_earned ?? 0,
    dailyXpCap: DAILY_XP_CAP,
    team: team ? { id: team.id, name: team.name, role: team.role } : null,
    teamReminder,
    todayChecklist: {
      date: today,
      goals: habitGoals || null,
      movementRoutine: habitGoals
        ? (MOVEMENT_EXERCISES[habitGoals.movement_preference] ?? null)
        : null,
      hydration: {
        current: habitLog?.hydration_glasses ?? 0,
        target: habitGoals?.hydration_glasses ?? 8,
        goalMet: (habitLog?.hydration_glasses ?? 0) >= (habitGoals?.hydration_glasses ?? 8),
      },
      sleep: {
        sleepStart: habitLog?.sleep_start ?? null,
        sleepEnd: habitLog?.sleep_end ?? null,
        hours: habitLog?.sleep_hours ?? null,
        goalMet: habitLog?.sleep_hours != null && habitLog.sleep_hours >= 7,
      },
      foodHabits: buildFoodHabitsResponse(habitLog),
      progress: habitLog
        ? {
            steps: habitLog.steps,
            hydration: habitLog.hydration_glasses,
            sleep: habitLog.sleep_hours,
            sleepStart: habitLog.sleep_start ?? null,
            sleepEnd: habitLog.sleep_end ?? null,
            movement: habitLog.movement_done === 1,
            vegetables: habitLog.vegetables_count,
            mood: habitLog.mood,
            xpEarned: habitLog.xp_earned,
          }
        : null,
    },
    adBanner: {
      enabled: true,
      placement: "bottom",
    },
  });
});

export default router;
