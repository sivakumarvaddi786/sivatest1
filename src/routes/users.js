import { Router } from "express";
import { body, validationResult } from "express-validator";
import db from "../db/index.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { getXpForNextLevel } from "../utils/xp.js";

const router = Router();

router.use(requireAuth);

function calcBmi(heightCm, weightKg) {
  const heightM = heightCm / 100;
  const bmi = Math.round((weightKg / (heightM * heightM)) * 10) / 10;
  let bmi_category;
  if (bmi < 18.5) bmi_category = "underweight";
  else if (bmi < 25) bmi_category = "normal";
  else if (bmi < 30) bmi_category = "overweight";
  else if (bmi < 35) bmi_category = "obese_1";
  else bmi_category = "obese_2";
  return { bmi, bmi_category };
}

/**
 * GET /api/users/me
 *
 * Returns the current user's profile.
 */
router.get("/me", (req, res) => {
  const user = db
    .prepare(
      `SELECT id, email, name, age, gender, height_cm, weight_kg, bmi, bmi_category,
              mascot_id, mascot_name, xp_total, level, current_streak, longest_streak,
              streak_shields, timezone, created_at, email_verified, onboarding_step
       FROM users WHERE id = ?`
    )
    .get(req.user.id);

  return res.json({ user });
});

/**
 * PATCH /api/users/me
 *
 * Updates the current user's profile fields (name, age, gender, timezone).
 */
const profileUpdateValidation = [
  body("name")
    .optional()
    .isString()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage("Name must be between 1 and 100 characters."),
  body("age")
    .optional()
    .isInt({ min: 13, max: 120 })
    .withMessage("Age must be between 13 and 120."),
  body("gender")
    .optional()
    .isIn(["male", "female", "other"])
    .withMessage("Gender must be male, female, or other."),
  body("timezone")
    .optional()
    .isString()
    .trim()
    .notEmpty()
    .withMessage("Timezone must be a non-empty string."),
];

router.patch("/me", profileUpdateValidation, (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: "Validation failed",
      details: errors.array().map((e) => ({ field: e.path, message: e.msg })),
    });
  }

  const { name, age, gender, timezone } = req.body;

  const updates = {};
  if (name !== undefined) updates.name = name;
  if (age !== undefined) updates.age = age;
  if (gender !== undefined) updates.gender = gender;
  if (timezone !== undefined) updates.timezone = timezone;

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: "No valid fields to update." });
  }

  const setClause = Object.keys(updates)
    .map((k) => `${k} = ?`)
    .join(", ");
  const values = [...Object.values(updates), req.user.id];

  db.prepare(`UPDATE users SET ${setClause} WHERE id = ?`).run(...values);

  const updated = db
    .prepare(
      `SELECT id, email, name, age, gender, height_cm, weight_kg, bmi, bmi_category,
              mascot_id, mascot_name, xp_total, level, current_streak, longest_streak,
              timezone, created_at
       FROM users WHERE id = ?`
    )
    .get(req.user.id);

  return res.json({ message: "Profile updated successfully.", user: updated });
});

/**
 * PATCH /api/users/me/bmi
 *
 * Updates the current user's height and weight, recalculating BMI.
 */
const bmiUpdateValidation = [
  body("height_cm")
    .isFloat({ min: 50, max: 300 })
    .withMessage("Height must be between 50 and 300 cm."),
  body("weight_kg")
    .isFloat({ min: 10, max: 500 })
    .withMessage("Weight must be between 10 and 500 kg."),
];

router.patch("/me/bmi", bmiUpdateValidation, (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: "Validation failed",
      details: errors.array().map((e) => ({ field: e.path, message: e.msg })),
    });
  }

  const { height_cm, weight_kg } = req.body;
  const { bmi, bmi_category } = calcBmi(height_cm, weight_kg);

  db.prepare(
    "UPDATE users SET height_cm = ?, weight_kg = ?, bmi = ?, bmi_category = ? WHERE id = ?"
  ).run(height_cm, weight_kg, bmi, bmi_category, req.user.id);

  return res.json({
    message: "BMI updated successfully.",
    height_cm,
    weight_kg,
    bmi,
    bmi_category,
  });
});

/**
 * GET /api/users/me/stats
 *
 * Returns the current user's overall stats.
 */
router.get("/me/stats", (req, res) => {
  const user = db
    .prepare(
      "SELECT xp_total, level, current_streak, longest_streak, streak_shields FROM users WHERE id = ?"
    )
    .get(req.user.id);

  const { total_days } = db
    .prepare("SELECT COUNT(*) as total_days FROM daily_logs WHERE user_id = ?")
    .get(req.user.id);

  const { xp_from_logs } = db
    .prepare(
      "SELECT COALESCE(SUM(xp_earned), 0) as xp_from_logs FROM daily_logs WHERE user_id = ?"
    )
    .get(req.user.id);

  return res.json({
    xpTotal: user.xp_total,
    level: user.level,
    xpForNextLevel: getXpForNextLevel(user.level),
    currentStreak: user.current_streak,
    longestStreak: user.longest_streak,
    streakShields: user.streak_shields,
    totalDaysLogged: total_days,
    xpFromLogs: xp_from_logs,
  });
});

/**
 * GET /api/users/me/streaks
 *
 * Returns the current user's streak info and recent activity dates.
 */
router.get("/me/streaks", (req, res) => {
  const user = db
    .prepare(
      "SELECT current_streak, longest_streak, streak_shields FROM users WHERE id = ?"
    )
    .get(req.user.id);

  const recentLogs = db
    .prepare(
      "SELECT log_date FROM daily_logs WHERE user_id = ? ORDER BY log_date DESC LIMIT 30"
    )
    .all(req.user.id);

  return res.json({
    currentStreak: user.current_streak,
    longestStreak: user.longest_streak,
    streakShields: user.streak_shields,
    recentActivityDates: recentLogs.map((l) => l.log_date),
  });
});

export default router;
