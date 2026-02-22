import { Router } from "express";
import { body, validationResult } from "express-validator";
import { v4 } from "uuid";
import db from "../db/index.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireEmailVerified } from "../middleware/requireEmailVerified.js";

const router = Router();

// All onboarding routes require authentication and email verification
router.use(requireAuth);
router.use(requireEmailVerified);

/**
 * Maps a numeric BMI to an internal DB category and a user-facing motivational label.
 * The word 'obese' is never exposed to the user.
 */
function getBmiInfo(bmi) {
  if (bmi < 18.5) return { category: "underweight", label: "Let's build strength" };
  if (bmi < 25) return { category: "normal", label: "Keep it up!" };
  if (bmi < 30) return { category: "overweight", label: "Let's get moving" };
  if (bmi < 35) return { category: "obese_1", label: "Every step counts" };
  return { category: "obese_2", label: "You've got this" };
}

/**
 * Maps a BMI category to a starter mascot.
 * Mascot IDs are stable integer identifiers used by the client for asset loading.
 */
const MASCOT_MAP = {
  underweight: { id: 1, name: "Baby Flamingo" },
  normal:      { id: 2, name: "Energetic Fox" },
  overweight:  { id: 3, name: "Chunky Bear" },
  obese_1:     { id: 4, name: "Sleepy Panda" },
  obese_2:     { id: 5, name: "Cozy Sloth" },
};

/**
 * Computes pre-filled health goals for onboarding step 3 based on
 * the user's weight and BMI category.
 *
 * Steps: 5,000/day for overweight/obese; 10,000/day for normal/underweight.
 * Hydration: weight(kg) × 0.033 L, converted to 250 ml glasses (rounded).
 * Sleep: 7–8 hours (fixed default).
 * Vegetables: 2 per day (fixed default).
 */
function computeGoalPrefill(weightKg, bmiCategory) {
  const isHigherBmi = ["overweight", "obese_1", "obese_2"].includes(bmiCategory);
  const daily_steps = isHigherBmi ? 5000 : 10000;
  const hydration_glasses = Math.round((weightKg * 0.033) / 0.25);
  return {
    daily_steps,
    hydration_glasses,
    sleep_hours_min: 7,
    sleep_hours_max: 8,
    vegetables_per_day: 2,
  };
}

/**
 * GET /api/onboarding/status
 *
 * Returns the user's current onboarding step and any saved step data
 * so the client can resume from where the user left off.
 *
 * Responses:
 *   200 - Current onboarding step and saved data
 *   401 - Not authenticated or email not verified
 */
router.get("/status", (req, res) => {
  const user = db
    .prepare(
      "SELECT name, age, gender, height_cm, weight_kg, bmi, bmi_category, mascot_id, mascot_name, onboarding_step, team_reminder_at, timezone FROM users WHERE id = ?"
    )
    .get(req.user.id);

  const habitsConfig = db
    .prepare(
      "SELECT daily_steps, hydration_glasses, sleep_hours_min, sleep_hours_max, movement_preference, vegetables_per_day FROM habits_config WHERE user_id = ?"
    )
    .get(req.user.id);

  const team = db
    .prepare(
      `SELECT t.id, t.name, t.invite_code, tm.role
       FROM team_members tm
       JOIN teams t ON t.id = tm.team_id
       WHERE tm.user_id = ?`
    )
    .get(req.user.id);

  const goalPrefill =
    user.weight_kg && user.bmi_category
      ? computeGoalPrefill(user.weight_kg, user.bmi_category)
      : null;

  return res.json({
    onboardingStep: user.onboarding_step,
    data: {
      name: user.name,
      age: user.age,
      gender: user.gender,
      height_cm: user.height_cm,
      weight_kg: user.weight_kg,
      bmi: user.bmi,
      bmiCategory: user.bmi_category,
      mascot: user.mascot_id ? { id: user.mascot_id, name: user.mascot_name } : null,
      goals: habitsConfig || null,
      goalPrefill,
      team: team
        ? { id: team.id, name: team.name, inviteCode: team.invite_code, role: team.role }
        : null,
      teamReminderAt: user.team_reminder_at || null,
      timezone: user.timezone || null,
    },
  });
});

const step1Validation = [
  body("name")
    .isString()
    .withMessage("Name must be a string.")
    .bail()
    .trim()
    .notEmpty()
    .withMessage("Name is required.")
    .isLength({ max: 100 })
    .withMessage("Name must be 100 characters or fewer."),
  body("age")
    .isInt({ min: 13, max: 120 })
    .withMessage("Age must be a whole number between 13 and 120."),
  body("gender")
    .isIn(["male", "female", "other"])
    .withMessage("Gender must be one of: male, female, other."),
  body("timezone")
    .optional()
    .isString()
    .trim()
    .notEmpty()
    .withMessage("Timezone must be a valid IANA timezone string (e.g. America/New_York)."),
];

/**
 * POST /api/onboarding/step1
 *
 * Saves the user's name, age, and gender.
 * Advances onboarding_step to at least 1 (does not regress if already higher).
 *
 * Request body:
 *   { name: string, age: number, gender: "male"|"female"|"other" }
 *
 * Responses:
 *   200 - Step 1 saved; returns updated onboarding step
 *   400 - Validation error
 *   401 - Not authenticated or email not verified
 *   500 - Internal server error
 */
router.post("/step1", step1Validation, (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: "Validation failed",
      details: errors.array().map((e) => ({ field: e.path, message: e.msg })),
    });
  }

  const { name, gender, timezone } = req.body;
  const age = parseInt(req.body.age, 10);

  try {
    if (timezone) {
      db.prepare(
        `UPDATE users
         SET name = ?, age = ?, gender = ?, timezone = ?, onboarding_step = MAX(onboarding_step, 1)
         WHERE id = ?`
      ).run(name.trim(), age, gender, timezone.trim(), req.user.id);
    } else {
      db.prepare(
        `UPDATE users
         SET name = ?, age = ?, gender = ?, onboarding_step = MAX(onboarding_step, 1)
         WHERE id = ?`
      ).run(name.trim(), age, gender, req.user.id);
    }

    return res.json({
      message: "Onboarding step 1 complete.",
      onboardingStep: 1,
    });
  } catch (err) {
    console.error("[Onboarding Step 1] Unexpected error:", err);
    return res
      .status(500)
      .json({ error: "An unexpected error occurred. Please try again." });
  }
});

const step2Validation = [
  body("height_cm")
    .isFloat({ min: 50, max: 300 })
    .withMessage("Height must be a number between 50 and 300 cm."),
  body("weight_kg")
    .isFloat({ min: 10, max: 500 })
    .withMessage("Weight must be a number between 10 and 500 kg.")
    .bail()
    .custom((value, { req }) => {
      const heightM = parseFloat(req.body.height_cm) / 100;
      if (!heightM || heightM <= 0) return true; // height validation will catch this
      const bmi = parseFloat(value) / (heightM * heightM);
      if (bmi < 10 || bmi > 60) {
        throw new Error(
          "The height and weight combination results in an invalid BMI. Please check your values."
        );
      }
      return true;
    }),
];

/**
 * POST /api/onboarding/step2
 *
 * Saves the user's height (cm) and weight (kg), calculates BMI, assigns
 * a motivational BMI category label, and advances onboarding to step 2.
 *
 * Request body:
 *   { height_cm: number, weight_kg: number }
 *
 * Responses:
 *   200 - Step 2 saved; returns BMI, motivational label, and updated onboarding step
 *   400 - Validation error (including out-of-range BMI)
 *   401 - Not authenticated or email not verified
 *   500 - Internal server error
 */
router.post("/step2", step2Validation, (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: "Validation failed",
      details: errors.array().map((e) => ({ field: e.path, message: e.msg })),
    });
  }

  const height_cm = parseFloat(req.body.height_cm);
  const weight_kg = parseFloat(req.body.weight_kg);
  const heightM = height_cm / 100;
  const bmi = Math.round((weight_kg / (heightM * heightM)) * 10) / 10;
  const { category, label } = getBmiInfo(bmi);
  const mascot = MASCOT_MAP[category];

  try {
    db.prepare(
      `UPDATE users
       SET height_cm = ?, weight_kg = ?, bmi = ?, bmi_category = ?,
           mascot_id = ?, mascot_name = ?,
           onboarding_step = MAX(onboarding_step, 2)
       WHERE id = ?`
    ).run(height_cm, weight_kg, bmi, category, mascot.id, mascot.name, req.user.id);

    return res.json({
      message: "Onboarding step 2 complete.",
      onboardingStep: 2,
      bmi,
      bmiLabel: label,
      mascot: { id: mascot.id, name: mascot.name },
    });
  } catch (err) {
    console.error("[Onboarding Step 2] Unexpected error:", err);
    return res
      .status(500)
      .json({ error: "An unexpected error occurred. Please try again." });
  }
});

const step3Validation = [
  body("movement_preference")
    .isIn(["chair_exercises", "walking", "jumping_jacks"])
    .withMessage(
      "Movement preference must be one of: chair_exercises, walking, jumping_jacks."
    ),
];

/**
 * POST /api/onboarding/step3
 *
 * Confirms the user's health goals pre-filled from BMI/weight data and saves
 * the selected movement preference. Goals are persisted to habits_config.
 *
 * Pre-filled (read from step 2 data, not user-supplied):
 *   - daily_steps: 5,000 (overweight/obese) or 10,000 (normal/underweight)
 *   - hydration_glasses: weight(kg) × 0.033 L ÷ 0.25 L/glass
 *   - sleep_hours_min/max: 7–8
 *   - vegetables_per_day: 2
 *
 * Request body:
 *   { movement_preference: "chair_exercises"|"walking"|"jumping_jacks" }
 *
 * Responses:
 *   200 - Step 3 saved; returns the full goals object and updated onboarding step
 *   400 - Validation error or step 2 not yet completed
 *   401 - Not authenticated or email not verified
 *   500 - Internal server error
 */
router.post("/step3", step3Validation, (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: "Validation failed",
      details: errors.array().map((e) => ({ field: e.path, message: e.msg })),
    });
  }

  const user = db
    .prepare("SELECT weight_kg, bmi_category FROM users WHERE id = ?")
    .get(req.user.id);

  if (!user.weight_kg || !user.bmi_category) {
    return res.status(400).json({
      error: "Please complete step 2 (height and weight) before confirming your goals.",
    });
  }

  const { movement_preference } = req.body;
  const prefill = computeGoalPrefill(user.weight_kg, user.bmi_category);
  const now = new Date().toISOString();

  try {
    db.transaction(() => {
      db.prepare(
        `INSERT INTO habits_config
           (id, user_id, daily_steps, hydration_glasses, sleep_hours_min, sleep_hours_max,
            movement_preference, vegetables_per_day, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           daily_steps         = excluded.daily_steps,
           hydration_glasses   = excluded.hydration_glasses,
           movement_preference = excluded.movement_preference,
           updated_at          = excluded.updated_at`
      ).run(
        v4(),
        req.user.id,
        prefill.daily_steps,
        prefill.hydration_glasses,
        prefill.sleep_hours_min,
        prefill.sleep_hours_max,
        movement_preference,
        prefill.vegetables_per_day,
        now,
        now
      );

      db.prepare(
        "UPDATE users SET onboarding_step = MAX(onboarding_step, 3) WHERE id = ?"
      ).run(req.user.id);
    })();

    return res.json({
      message: "Onboarding step 3 complete.",
      onboardingStep: 3,
      goals: {
        daily_steps: prefill.daily_steps,
        hydration_glasses: prefill.hydration_glasses,
        sleep_hours_min: prefill.sleep_hours_min,
        sleep_hours_max: prefill.sleep_hours_max,
        movement_preference,
        vegetables_per_day: prefill.vegetables_per_day,
      },
    });
  } catch (err) {
    console.error("[Onboarding Step 3] Unexpected error:", err);
    return res
      .status(500)
      .json({ error: "An unexpected error occurred. Please try again." });
  }
});

const step4Validation = [
  body("action")
    .isIn(["create", "join", "skip"])
    .withMessage("Action must be one of: create, join, skip."),
  body("teamName")
    .if(body("action").equals("create"))
    .isString()
    .withMessage("Team name must be a string.")
    .bail()
    .trim()
    .notEmpty()
    .withMessage("Team name is required when creating a team.")
    .isLength({ max: 100 })
    .withMessage("Team name must be 100 characters or fewer."),
  body("inviteCode")
    .if(body("action").equals("join"))
    .isString()
    .withMessage("Invite code must be a string.")
    .bail()
    .trim()
    .notEmpty()
    .withMessage("Invite code is required when joining a team."),
];

/**
 * POST /api/onboarding/step4
 *
 * Presents the user with three team options and completes onboarding:
 *   - create: Creates a new team with a generated invite code; user becomes owner.
 *   - join:   Joins an existing team via invite code; user becomes a member.
 *   - skip:   Skips team creation and schedules a 48-hour reminder notification.
 *
 * All three actions advance onboarding_step to 4 (onboarding complete).
 * After this step the user is allowed to access the dashboard.
 *
 * Request body:
 *   { action: "create", teamName: string }
 *   { action: "join",   inviteCode: string }
 *   { action: "skip" }
 *
 * Responses:
 *   200 - Step 4 complete; returns updated onboarding step and team/reminder info
 *   400 - Validation error or invalid invite code
 *   401 - Not authenticated or email not verified
 *   500 - Internal server error
 */
router.post("/step4", step4Validation, (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: "Validation failed",
      details: errors.array().map((e) => ({ field: e.path, message: e.msg })),
    });
  }

  const { action } = req.body;
  const now = new Date().toISOString();

  if (action === "skip") {
    const remindAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    try {
      db.prepare(
        "UPDATE users SET team_reminder_at = ?, onboarding_step = MAX(onboarding_step, 4) WHERE id = ?"
      ).run(remindAt, req.user.id);

      return res.json({
        message: "Onboarding complete. You will be reminded to join a team in 48 hours.",
        onboardingStep: 4,
        teamReminderAt: remindAt,
      });
    } catch (err) {
      console.error("[Onboarding Step 4] Skip error:", err);
      return res
        .status(500)
        .json({ error: "An unexpected error occurred. Please try again." });
    }
  }

  if (action === "create") {
    const teamName = req.body.teamName.trim();
    const teamId = v4();
    // Short invite code: first 8 chars of a UUID (hex, without dashes), uppercased
    const inviteCode = v4().replace(/-/g, "").substring(0, 8).toUpperCase();

    try {
      db.transaction(() => {
        db.prepare(
          "INSERT INTO teams (id, name, invite_code, owner_id, created_at) VALUES (?, ?, ?, ?, ?)"
        ).run(teamId, teamName, inviteCode, req.user.id, now);

        db.prepare(
          "INSERT INTO team_members (id, team_id, user_id, role, joined_at) VALUES (?, ?, ?, ?, ?)"
        ).run(v4(), teamId, req.user.id, "owner", now);

        db.prepare(
          "UPDATE users SET onboarding_step = MAX(onboarding_step, 4) WHERE id = ?"
        ).run(req.user.id);
      })();

      return res.json({
        message: "Team created. Onboarding complete.",
        onboardingStep: 4,
        team: { id: teamId, name: teamName, inviteCode, role: "owner" },
      });
    } catch (err) {
      console.error("[Onboarding Step 4] Create team error:", err);
      return res
        .status(500)
        .json({ error: "An unexpected error occurred. Please try again." });
    }
  }

  // action === "join"
  const inviteCode = req.body.inviteCode.trim().toUpperCase();
  const team = db
    .prepare("SELECT id, name FROM teams WHERE invite_code = ?")
    .get(inviteCode);

  if (!team) {
    return res
      .status(400)
      .json({ error: "Invalid invite code. No team found with that code." });
  }

  try {
    db.transaction(() => {
      // INSERT OR IGNORE handles the case where the user is already a member
      db.prepare(
        "INSERT OR IGNORE INTO team_members (id, team_id, user_id, role, joined_at) VALUES (?, ?, ?, ?, ?)"
      ).run(v4(), team.id, req.user.id, "member", now);

      db.prepare(
        "UPDATE users SET onboarding_step = MAX(onboarding_step, 4) WHERE id = ?"
      ).run(req.user.id);
    })();

    return res.json({
      message: "Joined team. Onboarding complete.",
      onboardingStep: 4,
      team: { id: team.id, name: team.name, role: "member" },
    });
  } catch (err) {
    console.error("[Onboarding Step 4] Join team error:", err);
    return res
      .status(500)
      .json({ error: "An unexpected error occurred. Please try again." });
  }
});

export default router;
