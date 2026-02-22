import { Router } from "express";
import { body, param, validationResult } from "express-validator";
import { v4 as uuidv4 } from "uuid";
import db from "../db/index.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { getTodayForTimezone } from "../utils/date.js";
import { capDailyXp, getLevelForXp } from "../utils/xp.js";
import { evaluateStreakIfNeeded } from "../utils/streak.js";

const router = Router();

router.use(requireAuth);

const VALID_CATEGORIES = ["steps", "hydration", "sleep", "movement", "vegetables", "food"];

const CATEGORY_COLUMN_MAP = {
  steps: "steps",
  hydration: "hydration_glasses",
  sleep: "sleep_hours",
  movement: "movement_done",
  vegetables: "vegetables_count",
};

// US-012: step-specific constants
const MAX_MANUAL_STEPS = 50000;
const STEP_BONUS_INCREMENT = 500;
const STEP_BONUS_XP = 5;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

// US-013: movement routine constants
const MOVEMENT_XP = 15;

// US-014: hydration XP constants
const HYDRATION_GLASS_XP = 5;
const HYDRATION_GOAL_BONUS_XP = 20;

// US-015: sleep XP constants
const SLEEP_LOG_XP = 5;
const SLEEP_GOAL_BONUS_XP = 15;
const SLEEP_GOAL_HOURS = 7;

/**
 * Applies XP to a user within an existing transaction.
 * Updates xp_total and recalculates level. Returns level-up info.
 * Must be called inside a db.transaction() block.
 */
function applyXpToUser(userId, xpDelta) {
  if (xpDelta <= 0) return { previousLevel: null, newLevel: null, leveledUp: false };

  const user = db
    .prepare("SELECT xp_total, level FROM users WHERE id = ?")
    .get(userId);

  const previousLevel = user.level;
  const newXpTotal = user.xp_total + xpDelta;
  const newLevel = getLevelForXp(newXpTotal);

  db.prepare("UPDATE users SET xp_total = ?, level = ? WHERE id = ?").run(
    newXpTotal,
    newLevel,
    userId
  );

  return { previousLevel, newLevel, leveledUp: newLevel > previousLevel };
}

// US-016: food habit constants
const FOOD_HABITS = {
  vegetables: { label: "Ate 2 servings of vegetables", xp: 10, col: "food_vegetables", xpCol: "food_veg_xp_awarded" },
  no_junk: { label: "Skipped junk food today", xp: 10, col: "food_no_junk", xpCol: "food_nojunk_xp_awarded" },
  breakfast: { label: "Ate breakfast", xp: 5, col: "food_breakfast", xpCol: "food_breakfast_xp_awarded" },
};

/**
 * Maps each movement_preference to a preset routine of 3 exercises.
 * All exercises drawn from the 4 options: jumping jacks (20), chair squats (15),
 * shoulder rolls (10), calf raises (20).
 */
const MOVEMENT_EXERCISES = {
  jumping_jacks: [
    { name: "jumping_jacks", label: "Jumping Jacks", reps: 20 },
    { name: "chair_squats", label: "Chair Squats", reps: 15 },
    { name: "calf_raises", label: "Calf Raises", reps: 20 },
  ],
  chair_exercises: [
    { name: "chair_squats", label: "Chair Squats", reps: 15 },
    { name: "shoulder_rolls", label: "Shoulder Rolls", reps: 10 },
    { name: "calf_raises", label: "Calf Raises", reps: 20 },
  ],
  walking: [
    { name: "jumping_jacks", label: "Jumping Jacks", reps: 20 },
    { name: "shoulder_rolls", label: "Shoulder Rolls", reps: 10 },
    { name: "calf_raises", label: "Calf Raises", reps: 20 },
  ],
};

/**
 * GET /api/habits/today
 *
 * Returns today's habit log for the current user, plus their goals from habits_config.
 */
router.get("/today", (req, res) => {
  // Evaluate streak for any unevaluated days before responding
  evaluateStreakIfNeeded(req.user.id, req.user.timezone);

  const today = getTodayForTimezone(req.user.timezone);

  const log = db
    .prepare("SELECT * FROM daily_logs WHERE user_id = ? AND log_date = ?")
    .get(req.user.id, today);

  const config = db
    .prepare(
      `SELECT daily_steps, hydration_glasses, sleep_hours_min, sleep_hours_max,
              movement_preference, vegetables_per_day
       FROM habits_config WHERE user_id = ?`
    )
    .get(req.user.id);

  const movementRoutine = config
    ? (MOVEMENT_EXERCISES[config.movement_preference] ?? null)
    : null;

  return res.json({
    date: today,
    goals: config || null,
    movementRoutine,
    foodHabits: buildFoodHabitsResponse(log),
    today: log
      ? {
          steps: log.steps,
          stepsManual: log.steps_manual,
          stepsGoogleFit: log.steps_google_fit,
          hydration: log.hydration_glasses,
          sleep: log.sleep_hours,
          sleepStart: log.sleep_start ?? null,
          sleepEnd: log.sleep_end ?? null,
          movement: log.movement_done === 1,
          vegetables: log.vegetables_count,
          mood: log.mood,
          notes: log.notes,
          xpEarned: log.xp_earned,
        }
      : null,
  });
});

/**
 * PATCH /api/habits/today/:category
 *
 * Updates a single habit category in today's log.
 * Creates the daily log record if one doesn't exist yet.
 *
 * Categories: steps, hydration, sleep, movement, vegetables
 *
 * For "steps":
 *   - Body: { value: number, source?: "manual" | "google_fit" } (default source: "manual")
 *   - Manual entries capped at 50,000.
 *   - Effective steps = max(manual, google_fit).
 *   - Completing step goal awards XP immediately (20 XP for 5k goal, 40 XP for 10k goal).
 *   - Bonus: +5 XP when manual steps increase by >=500 with 2-hour cooldown.
 *
 * For other categories:
 *   - Body: { value: number | boolean }
 */
router.patch(
  "/today/:category",
  [
    param("category")
      .isIn(VALID_CATEGORIES)
      .withMessage(`Category must be one of: ${VALID_CATEGORIES.join(", ")}.`),
    body("value")
      .if(param("category").not().equals("sleep"))
      .if(param("category").not().equals("food"))
      .exists()
      .withMessage("Value is required."),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: "Validation failed",
        details: errors.array().map((e) => ({ field: e.path, message: e.msg })),
      });
    }

    const { category } = req.params;
    const { value } = req.body;
    const today = getTodayForTimezone(req.user.timezone);
    const now = new Date().toISOString();

    // Steps have dedicated logic (source tracking, XP awards)
    if (category === "steps") {
      return handleStepsUpdate(req, res, value, today, now);
    }

    // Movement has dedicated logic (XP award on completion)
    if (category === "movement") {
      return handleMovementUpdate(req, res, value, today, now);
    }

    // Hydration has dedicated logic (per-glass XP + goal bonus)
    if (category === "hydration") {
      return handleHydrationUpdate(req, res, value, today, now);
    }

    // Sleep has dedicated logic (start/end times, auto-calculated hours, XP)
    if (category === "sleep") {
      return handleSleepUpdate(req, res, today, now);
    }

    // Food has dedicated logic (checkbox items with per-item XP)
    if (category === "food") {
      return handleFoodUpdate(req, res, today, now);
    }

    const column = CATEGORY_COLUMN_MAP[category];

    let processedValue;
    if (category === "movement") {
      if (typeof value !== "boolean" && value !== 0 && value !== 1) {
        return res
          .status(400)
          .json({ error: "Movement value must be a boolean (true/false)." });
      }
      processedValue = value ? 1 : 0;
    } else if (category === "sleep") {
      const num = parseFloat(value);
      if (isNaN(num) || num < 0 || num > 24) {
        return res
          .status(400)
          .json({ error: "Sleep value must be a number between 0 and 24 hours." });
      }
      processedValue = num;
    } else {
      const num = parseInt(value, 10);
      if (isNaN(num) || num < 0) {
        return res
          .status(400)
          .json({ error: `${category} value must be a non-negative integer.` });
      }
      processedValue = num;
    }

    const existing = db
      .prepare("SELECT id FROM daily_logs WHERE user_id = ? AND log_date = ?")
      .get(req.user.id, today);

    if (existing) {
      db.prepare(
        `UPDATE daily_logs SET ${column} = ?, updated_at = ? WHERE id = ?`
      ).run(processedValue, now, existing.id);
    } else {
      db.prepare(
        `INSERT INTO daily_logs (id, user_id, log_date, ${column}, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(uuidv4(), req.user.id, today, processedValue, now, now);
    }

    const log = db
      .prepare("SELECT * FROM daily_logs WHERE user_id = ? AND log_date = ?")
      .get(req.user.id, today);

    return res.json({
      message: `${category} updated successfully.`,
      date: today,
      today: {
        steps: log.steps,
        hydration: log.hydration_glasses,
        sleep: log.sleep_hours,
        movement: log.movement_done === 1,
        vegetables: log.vegetables_count,
        mood: log.mood,
        notes: log.notes,
        xpEarned: log.xp_earned,
      },
    });
  }
);

/**
 * Handles movement updates with boolean done/not-done tracking and one-time 15 XP award.
 */
function handleMovementUpdate(req, res, value, today, now) {
  if (typeof value !== "boolean" && value !== 0 && value !== 1) {
    return res
      .status(400)
      .json({ error: "Movement value must be a boolean (true/false)." });
  }

  const done = value === true || value === 1;
  const processedValue = done ? 1 : 0;

  const existing = db
    .prepare(
      `SELECT id, movement_xp_awarded, xp_earned
       FROM daily_logs WHERE user_id = ? AND log_date = ?`
    )
    .get(req.user.id, today);

  const prevXpAwarded = existing?.movement_xp_awarded ?? 0;
  const newXpAwarded = done && prevXpAwarded === 0 ? 1 : prevXpAwarded;
  const rawXpDelta = newXpAwarded === 1 && prevXpAwarded === 0 ? MOVEMENT_XP : 0;
  const currentDayXp = existing?.xp_earned ?? 0;
  const xpDelta = capDailyXp(currentDayXp, rawXpDelta);

  const fields = {
    movement_done: processedValue,
    movement_xp_awarded: newXpAwarded,
    updated_at: now,
  };

  if (xpDelta > 0) {
    fields.xp_earned = (existing?.xp_earned ?? 0) + xpDelta;
  }

  const applyUpdate = db.transaction(() => {
    if (existing) {
      const setClauses = Object.keys(fields)
        .map((k) => `${k} = ?`)
        .join(", ");
      db.prepare(
        `UPDATE daily_logs SET ${setClauses} WHERE id = ?`
      ).run(...Object.values(fields), existing.id);
    } else {
      const insertFields = {
        id: uuidv4(),
        user_id: req.user.id,
        log_date: today,
        created_at: now,
        ...fields,
      };
      const keys = Object.keys(insertFields);
      const placeholders = keys.map(() => "?").join(", ");
      db.prepare(
        `INSERT INTO daily_logs (${keys.join(", ")}) VALUES (${placeholders})`
      ).run(...Object.values(insertFields));
    }

    let levelInfo = { leveledUp: false };
    if (xpDelta > 0) {
      levelInfo = applyXpToUser(req.user.id, xpDelta);
    }
    return levelInfo;
  });

  const levelInfo = applyUpdate();

  const log = db
    .prepare("SELECT * FROM daily_logs WHERE user_id = ? AND log_date = ?")
    .get(req.user.id, today);

  const config = db
    .prepare("SELECT movement_preference FROM habits_config WHERE user_id = ?")
    .get(req.user.id);

  const movementRoutine = config
    ? (MOVEMENT_EXERCISES[config.movement_preference] ?? null)
    : null;

  const updatedUser = db
    .prepare("SELECT xp_total, level FROM users WHERE id = ?")
    .get(req.user.id);

  return res.json({
    message: "movement updated successfully.",
    date: today,
    movementDone: done,
    xpAwarded: xpDelta,
    xpTotal: updatedUser.xp_total,
    level: updatedUser.level,
    levelUp: levelInfo.leveledUp
      ? { previousLevel: levelInfo.previousLevel, newLevel: levelInfo.newLevel }
      : null,
    movementRoutine,
    today: {
      steps: log.steps,
      hydration: log.hydration_glasses,
      sleep: log.sleep_hours,
      movement: log.movement_done === 1,
      vegetables: log.vegetables_count,
      mood: log.mood,
      notes: log.notes,
      xpEarned: log.xp_earned,
    },
  });
}

/**
 * Handles hydration updates with per-glass 5 XP and one-time 20 XP bonus at daily target.
 */
function handleHydrationUpdate(req, res, value, today, now) {
  const glasses = parseInt(value, 10);
  if (isNaN(glasses) || glasses < 0) {
    return res
      .status(400)
      .json({ error: "hydration value must be a non-negative integer." });
  }

  // Fetch user's hydration goal from habits_config; default to 8 if not set
  const goalConfig = db
    .prepare("SELECT hydration_glasses FROM habits_config WHERE user_id = ?")
    .get(req.user.id);

  const hydrationGoal = goalConfig?.hydration_glasses ?? 8;

  const existing = db
    .prepare(
      `SELECT id, hydration_glasses, hydration_xp_glasses, hydration_goal_xp_awarded, xp_earned
       FROM daily_logs WHERE user_id = ? AND log_date = ?`
    )
    .get(req.user.id, today);

  const prevXpGlasses = existing?.hydration_xp_glasses ?? 0;
  const newXpGlasses = Math.max(prevXpGlasses, glasses);
  const glassXpDelta = Math.max(0, newXpGlasses - prevXpGlasses) * HYDRATION_GLASS_XP;

  const prevGoalAwarded = existing?.hydration_goal_xp_awarded ?? 0;
  const goalMet = glasses >= hydrationGoal;
  const newGoalAwarded = goalMet && prevGoalAwarded === 0 ? 1 : prevGoalAwarded;
  const goalXpDelta = newGoalAwarded === 1 && prevGoalAwarded === 0 ? HYDRATION_GOAL_BONUS_XP : 0;

  const rawXpDelta = glassXpDelta + goalXpDelta;
  const currentDayXp = existing?.xp_earned ?? 0;
  const xpDelta = capDailyXp(currentDayXp, rawXpDelta);

  const fields = {
    hydration_glasses: glasses,
    hydration_xp_glasses: newXpGlasses,
    hydration_goal_xp_awarded: newGoalAwarded,
    updated_at: now,
  };

  if (xpDelta > 0) {
    fields.xp_earned = (existing?.xp_earned ?? 0) + xpDelta;
  }

  const applyUpdate = db.transaction(() => {
    if (existing) {
      const setClauses = Object.keys(fields)
        .map((k) => `${k} = ?`)
        .join(", ");
      db.prepare(
        `UPDATE daily_logs SET ${setClauses} WHERE id = ?`
      ).run(...Object.values(fields), existing.id);
    } else {
      const insertFields = {
        id: uuidv4(),
        user_id: req.user.id,
        log_date: today,
        created_at: now,
        ...fields,
      };
      const keys = Object.keys(insertFields);
      const placeholders = keys.map(() => "?").join(", ");
      db.prepare(
        `INSERT INTO daily_logs (${keys.join(", ")}) VALUES (${placeholders})`
      ).run(...Object.values(insertFields));
    }

    let levelInfo = { leveledUp: false };
    if (xpDelta > 0) {
      levelInfo = applyXpToUser(req.user.id, xpDelta);
    }
    return levelInfo;
  });

  const levelInfo = applyUpdate();

  const log = db
    .prepare("SELECT * FROM daily_logs WHERE user_id = ? AND log_date = ?")
    .get(req.user.id, today);

  const updatedUser = db
    .prepare("SELECT xp_total, level FROM users WHERE id = ?")
    .get(req.user.id);

  return res.json({
    message: "hydration updated successfully.",
    date: today,
    hydrationGoal,
    currentGlasses: glasses,
    goalMet,
    xpAwarded: xpDelta,
    xpTotal: updatedUser.xp_total,
    level: updatedUser.level,
    levelUp: levelInfo.leveledUp
      ? { previousLevel: levelInfo.previousLevel, newLevel: levelInfo.newLevel }
      : null,
    today: {
      steps: log.steps,
      hydration: log.hydration_glasses,
      sleep: log.sleep_hours,
      movement: log.movement_done === 1,
      vegetables: log.vegetables_count,
      mood: log.mood,
      notes: log.notes,
      xpEarned: log.xp_earned,
    },
  });
}

/**
 * Handles sleep updates with start/end time logging, auto-calculated hours, and XP awards.
 *
 * Body: { sleepStart?: "HH:MM", sleepEnd?: "HH:MM" } — at least one required.
 * - Logging sleep start awards 5 XP (once per day).
 * - Logging wake-up (sleepEnd) awards 5 XP (once per day).
 * - Achieving 7+ hours of sleep awards an additional 15 XP (once per day).
 * - Sleep hours auto-calculated when both start and end are present.
 */
function handleSleepUpdate(req, res, today, now) {
  const { sleepStart, sleepEnd } = req.body;

  if (!sleepStart && !sleepEnd) {
    return res.status(400).json({
      error: "At least one of sleepStart or sleepEnd (HH:MM format) is required.",
    });
  }

  const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

  if (sleepStart && !timeRegex.test(sleepStart)) {
    return res.status(400).json({
      error: "sleepStart must be in HH:MM format (00:00–23:59).",
    });
  }

  if (sleepEnd && !timeRegex.test(sleepEnd)) {
    return res.status(400).json({
      error: "sleepEnd must be in HH:MM format (00:00–23:59).",
    });
  }

  const existing = db
    .prepare(
      `SELECT id, sleep_start, sleep_end, sleep_hours,
              sleep_xp_start_awarded, sleep_xp_end_awarded, sleep_goal_xp_awarded,
              xp_earned
       FROM daily_logs WHERE user_id = ? AND log_date = ?`
    )
    .get(req.user.id, today);

  const effectiveStart = sleepStart || existing?.sleep_start || null;
  const effectiveEnd = sleepEnd || existing?.sleep_end || null;

  // Auto-calculate sleep hours when both times are present
  let sleepHours = null;
  if (effectiveStart && effectiveEnd) {
    const [sh, sm] = effectiveStart.split(":").map(Number);
    const [eh, em] = effectiveEnd.split(":").map(Number);
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;
    const diffMin = endMin >= startMin
      ? endMin - startMin
      : 1440 - startMin + endMin; // crosses midnight
    sleepHours = Math.round((diffMin / 60) * 10) / 10; // 1 decimal
  }

  // XP calculations
  let rawXpDelta = 0;

  const prevStartAwarded = existing?.sleep_xp_start_awarded ?? 0;
  const newStartAwarded =
    effectiveStart && prevStartAwarded === 0 ? 1 : prevStartAwarded;
  if (newStartAwarded === 1 && prevStartAwarded === 0) {
    rawXpDelta += SLEEP_LOG_XP;
  }

  const prevEndAwarded = existing?.sleep_xp_end_awarded ?? 0;
  const newEndAwarded =
    effectiveEnd && prevEndAwarded === 0 ? 1 : prevEndAwarded;
  if (newEndAwarded === 1 && prevEndAwarded === 0) {
    rawXpDelta += SLEEP_LOG_XP;
  }

  const prevGoalAwarded = existing?.sleep_goal_xp_awarded ?? 0;
  const goalMet = sleepHours !== null && sleepHours >= SLEEP_GOAL_HOURS;
  const newGoalAwarded =
    goalMet && prevGoalAwarded === 0 ? 1 : prevGoalAwarded;
  if (newGoalAwarded === 1 && prevGoalAwarded === 0) {
    rawXpDelta += SLEEP_GOAL_BONUS_XP;
  }

  // Apply daily XP cap
  const currentDayXp = existing?.xp_earned ?? 0;
  const xpDelta = capDailyXp(currentDayXp, rawXpDelta);

  const fields = {
    sleep_xp_start_awarded: newStartAwarded,
    sleep_xp_end_awarded: newEndAwarded,
    sleep_goal_xp_awarded: newGoalAwarded,
    updated_at: now,
  };

  if (effectiveStart) fields.sleep_start = effectiveStart;
  if (effectiveEnd) fields.sleep_end = effectiveEnd;
  if (sleepHours !== null) fields.sleep_hours = sleepHours;

  if (xpDelta > 0) {
    fields.xp_earned = (existing?.xp_earned ?? 0) + xpDelta;
  }

  const applyUpdate = db.transaction(() => {
    if (existing) {
      const setClauses = Object.keys(fields)
        .map((k) => `${k} = ?`)
        .join(", ");
      db.prepare(
        `UPDATE daily_logs SET ${setClauses} WHERE id = ?`
      ).run(...Object.values(fields), existing.id);
    } else {
      const insertFields = {
        id: uuidv4(),
        user_id: req.user.id,
        log_date: today,
        created_at: now,
        ...fields,
      };
      const keys = Object.keys(insertFields);
      const placeholders = keys.map(() => "?").join(", ");
      db.prepare(
        `INSERT INTO daily_logs (${keys.join(", ")}) VALUES (${placeholders})`
      ).run(...Object.values(insertFields));
    }

    let levelInfo = { leveledUp: false };
    if (xpDelta > 0) {
      levelInfo = applyXpToUser(req.user.id, xpDelta);
    }
    return levelInfo;
  });

  const levelInfo = applyUpdate();

  const log = db
    .prepare("SELECT * FROM daily_logs WHERE user_id = ? AND log_date = ?")
    .get(req.user.id, today);

  const updatedUser = db
    .prepare("SELECT xp_total, level FROM users WHERE id = ?")
    .get(req.user.id);

  return res.json({
    message: "sleep updated successfully.",
    date: today,
    sleepStart: log.sleep_start ?? null,
    sleepEnd: log.sleep_end ?? null,
    sleepHours: log.sleep_hours ?? null,
    goalMet: log.sleep_hours !== null && log.sleep_hours >= SLEEP_GOAL_HOURS,
    xpAwarded: xpDelta,
    xpTotal: updatedUser.xp_total,
    level: updatedUser.level,
    levelUp: levelInfo.leveledUp
      ? { previousLevel: levelInfo.previousLevel, newLevel: levelInfo.newLevel }
      : null,
    today: {
      steps: log.steps,
      hydration: log.hydration_glasses,
      sleep: log.sleep_hours,
      sleepStart: log.sleep_start ?? null,
      sleepEnd: log.sleep_end ?? null,
      movement: log.movement_done === 1,
      vegetables: log.vegetables_count,
      mood: log.mood,
      notes: log.notes,
      xpEarned: log.xp_earned,
    },
  });
}

/**
 * Handles food habit checkbox updates with per-item XP awards.
 *
 * Body: { item: "vegetables" | "no_junk" | "breakfast", checked: boolean }
 *
 * - "Ate 2 servings of vegetables" → 10 XP
 * - "Skipped junk food today" → 10 XP
 * - "Ate breakfast" → 5 XP
 *
 * XP is awarded once per item per day; unchecking does not revoke XP.
 */
function handleFoodUpdate(req, res, today, now) {
  const { item, checked } = req.body;

  const validItems = Object.keys(FOOD_HABITS);
  if (!item || !validItems.includes(item)) {
    return res.status(400).json({
      error: `item must be one of: ${validItems.join(", ")}.`,
    });
  }

  if (typeof checked !== "boolean" && checked !== 0 && checked !== 1) {
    return res.status(400).json({
      error: "checked must be a boolean (true/false).",
    });
  }

  const habit = FOOD_HABITS[item];
  const done = checked === true || checked === 1;
  const processedValue = done ? 1 : 0;

  const existing = db
    .prepare(
      `SELECT id, ${habit.col}, ${habit.xpCol}, xp_earned
       FROM daily_logs WHERE user_id = ? AND log_date = ?`
    )
    .get(req.user.id, today);

  const prevXpAwarded = existing?.[habit.xpCol] ?? 0;
  const newXpAwarded = done && prevXpAwarded === 0 ? 1 : prevXpAwarded;
  const rawXpDelta = newXpAwarded === 1 && prevXpAwarded === 0 ? habit.xp : 0;
  const currentDayXp = existing?.xp_earned ?? 0;
  const xpDelta = capDailyXp(currentDayXp, rawXpDelta);

  const fields = {
    [habit.col]: processedValue,
    [habit.xpCol]: newXpAwarded,
    updated_at: now,
  };

  if (xpDelta > 0) {
    fields.xp_earned = (existing?.xp_earned ?? 0) + xpDelta;
  }

  const applyUpdate = db.transaction(() => {
    if (existing) {
      const setClauses = Object.keys(fields)
        .map((k) => `${k} = ?`)
        .join(", ");
      db.prepare(
        `UPDATE daily_logs SET ${setClauses} WHERE id = ?`
      ).run(...Object.values(fields), existing.id);
    } else {
      const insertFields = {
        id: uuidv4(),
        user_id: req.user.id,
        log_date: today,
        created_at: now,
        ...fields,
      };
      const keys = Object.keys(insertFields);
      const placeholders = keys.map(() => "?").join(", ");
      db.prepare(
        `INSERT INTO daily_logs (${keys.join(", ")}) VALUES (${placeholders})`
      ).run(...Object.values(insertFields));
    }

    let levelInfo = { leveledUp: false };
    if (xpDelta > 0) {
      levelInfo = applyXpToUser(req.user.id, xpDelta);
    }
    return levelInfo;
  });

  const levelInfo = applyUpdate();

  const log = db
    .prepare("SELECT * FROM daily_logs WHERE user_id = ? AND log_date = ?")
    .get(req.user.id, today);

  const updatedUser = db
    .prepare("SELECT xp_total, level FROM users WHERE id = ?")
    .get(req.user.id);

  return res.json({
    message: `${habit.label} ${done ? "checked" : "unchecked"}.`,
    date: today,
    item,
    checked: done,
    xpAwarded: xpDelta,
    xpTotal: updatedUser.xp_total,
    level: updatedUser.level,
    levelUp: levelInfo.leveledUp
      ? { previousLevel: levelInfo.previousLevel, newLevel: levelInfo.newLevel }
      : null,
    foodHabits: buildFoodHabitsResponse(log),
    today: {
      steps: log.steps,
      hydration: log.hydration_glasses,
      sleep: log.sleep_hours,
      movement: log.movement_done === 1,
      vegetables: log.vegetables_count,
      mood: log.mood,
      notes: log.notes,
      xpEarned: log.xp_earned,
    },
  });
}

/**
 * Builds the food habits checklist response from a daily_logs row.
 */
function buildFoodHabitsResponse(log) {
  return Object.entries(FOOD_HABITS).map(([key, habit]) => ({
    id: key,
    label: habit.label,
    xp: habit.xp,
    checked: (log?.[habit.col] ?? 0) === 1,
  }));
}

/**
 * Handles step updates with source tracking, effective-value logic, and XP awards.
 */
function handleStepsUpdate(req, res, value, today, now) {
  const source = req.body.source || "manual";
  if (source !== "manual" && source !== "google_fit") {
    return res
      .status(400)
      .json({ error: 'source must be "manual" or "google_fit".' });
  }

  const steps = parseInt(value, 10);
  if (isNaN(steps) || steps < 0) {
    return res
      .status(400)
      .json({ error: "steps value must be a non-negative integer." });
  }

  if (source === "manual" && steps > MAX_MANUAL_STEPS) {
    return res.status(400).json({
      error: `Manual step entries are capped at ${MAX_MANUAL_STEPS.toLocaleString()} steps/day.`,
    });
  }

  // Fetch user's step goal from habits_config; default to 10,000 if not set
  const goalConfig = db
    .prepare("SELECT daily_steps FROM habits_config WHERE user_id = ?")
    .get(req.user.id);

  const stepGoal = goalConfig?.daily_steps ?? 10000;
  const goalXp = stepGoal === 5000 ? 20 : 40;

  const existing = db
    .prepare(
      `SELECT id, steps_manual, steps_google_fit, steps_goal_xp_awarded,
              steps_last_bonus_at, xp_earned
       FROM daily_logs WHERE user_id = ? AND log_date = ?`
    )
    .get(req.user.id, today);

  // Determine updated per-source values
  const prevManual = existing?.steps_manual ?? 0;
  const newManual =
    source === "manual" ? steps : (existing?.steps_manual ?? null);
  const newGoogleFit =
    source === "google_fit" ? steps : (existing?.steps_google_fit ?? null);

  // Effective steps = maximum of both sources
  const effectiveSteps = Math.max(newManual ?? 0, newGoogleFit ?? 0);

  // XP: goal completion (awarded once per day)
  let rawXpDelta = 0;
  const prevGoalXpAwarded = existing?.steps_goal_xp_awarded ?? 0;
  const newGoalXpAwarded =
    effectiveSteps >= stepGoal && prevGoalXpAwarded === 0
      ? 1
      : prevGoalXpAwarded;

  if (newGoalXpAwarded === 1 && prevGoalXpAwarded === 0) {
    rawXpDelta += goalXp;
  }

  // XP: bonus for incremental manual logging (+5 per 500-step increase, 2-hour cooldown)
  let newLastBonusAt = existing?.steps_last_bonus_at ?? null;
  if (source === "manual") {
    const stepIncrease = steps - prevManual;
    const lastBonusMs = newLastBonusAt ? new Date(newLastBonusAt).getTime() : 0;
    const cooldownPassed = Date.now() - lastBonusMs >= TWO_HOURS_MS;

    if (stepIncrease >= STEP_BONUS_INCREMENT && cooldownPassed) {
      rawXpDelta += STEP_BONUS_XP;
      newLastBonusAt = now;
    }
  }

  // Apply daily XP cap
  const currentDayXp = existing?.xp_earned ?? 0;
  const xpDelta = capDailyXp(currentDayXp, rawXpDelta);

  // Build the fields to write
  const fields = {
    steps: effectiveSteps,
    steps_goal_xp_awarded: newGoalXpAwarded,
    steps_last_bonus_at: newLastBonusAt,
    updated_at: now,
  };

  if (source === "manual") {
    fields.steps_manual = newManual;
  } else {
    fields.steps_google_fit = newGoogleFit;
  }

  if (xpDelta > 0) {
    fields.xp_earned = (existing?.xp_earned ?? 0) + xpDelta;
  }

  const applyUpdate = db.transaction(() => {
    if (existing) {
      const setClauses = Object.keys(fields)
        .map((k) => `${k} = ?`)
        .join(", ");
      db.prepare(
        `UPDATE daily_logs SET ${setClauses} WHERE id = ?`
      ).run(...Object.values(fields), existing.id);
    } else {
      const insertFields = {
        id: uuidv4(),
        user_id: req.user.id,
        log_date: today,
        created_at: now,
        ...fields,
      };
      const keys = Object.keys(insertFields);
      const placeholders = keys.map(() => "?").join(", ");
      db.prepare(
        `INSERT INTO daily_logs (${keys.join(", ")}) VALUES (${placeholders})`
      ).run(...Object.values(insertFields));
    }

    let levelInfo = { leveledUp: false };
    if (xpDelta > 0) {
      levelInfo = applyXpToUser(req.user.id, xpDelta);
    }
    return levelInfo;
  });

  const levelInfo = applyUpdate();

  const log = db
    .prepare("SELECT * FROM daily_logs WHERE user_id = ? AND log_date = ?")
    .get(req.user.id, today);

  const updatedUser = db
    .prepare("SELECT xp_total, level FROM users WHERE id = ?")
    .get(req.user.id);

  return res.json({
    message: "steps updated successfully.",
    date: today,
    stepsGoal: stepGoal,
    goalMet: effectiveSteps >= stepGoal,
    xpAwarded: xpDelta,
    xpTotal: updatedUser.xp_total,
    level: updatedUser.level,
    levelUp: levelInfo.leveledUp
      ? { previousLevel: levelInfo.previousLevel, newLevel: levelInfo.newLevel }
      : null,
    today: {
      steps: log.steps,
      stepsManual: log.steps_manual,
      stepsGoogleFit: log.steps_google_fit,
      hydration: log.hydration_glasses,
      sleep: log.sleep_hours,
      movement: log.movement_done === 1,
      vegetables: log.vegetables_count,
      mood: log.mood,
      notes: log.notes,
      xpEarned: log.xp_earned,
    },
  });
}

export { MOVEMENT_EXERCISES, FOOD_HABITS, buildFoodHabitsResponse };
export default router;
