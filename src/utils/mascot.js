/**
 * Mascot Evolution System (US-022)
 *
 * Each BMI category has a unique 3-stage mascot progression:
 *   Stage 1 (Level 1–4): Baby/starter mascot (assigned at onboarding)
 *   Stage 2 (Level 5–9): Evolved mascot
 *   Stage 3 (Level 10+): Final form mascot
 *
 * Evolution triggers a CSS animation on the dashboard and awards badges.
 */

import { v4 as uuidv4 } from "uuid";
import db from "../db/index.js";

/**
 * 3-stage mascot progression per BMI category.
 * Each stage has a stable `id` (used by the client for asset loading) and a `name`.
 */
const MASCOT_EVOLUTION = {
  underweight: [
    { id: 1, name: "Baby Flamingo", stage: 1 },
    { id: 11, name: "Flamingo", stage: 2 },
    { id: 12, name: "Dancing Flamingo", stage: 3 },
  ],
  normal: [
    { id: 2, name: "Energetic Fox", stage: 1 },
    { id: 21, name: "Swift Fox", stage: 2 },
    { id: 22, name: "Champion Fox", stage: 3 },
  ],
  overweight: [
    { id: 3, name: "Chunky Bear", stage: 1 },
    { id: 31, name: "Strong Bear", stage: 2 },
    { id: 32, name: "Mighty Bear", stage: 3 },
  ],
  obese_1: [
    { id: 4, name: "Sleepy Panda", stage: 1 },
    { id: 41, name: "Active Panda", stage: 2 },
    { id: 42, name: "Warrior Panda", stage: 3 },
  ],
  obese_2: [
    { id: 5, name: "Cozy Sloth", stage: 1 },
    { id: 51, name: "Speedy Sloth", stage: 2 },
    { id: 52, name: "Turbo Sloth", stage: 3 },
  ],
};

const EVOLUTION_LEVEL_5 = 5;
const EVOLUTION_LEVEL_10 = 10;

/**
 * Returns the mascot stage index (0, 1, or 2) for a given level.
 */
function getMascotStageForLevel(level) {
  if (level >= EVOLUTION_LEVEL_10) return 2;
  if (level >= EVOLUTION_LEVEL_5) return 1;
  return 0;
}

/**
 * Returns the mascot info for a given BMI category and level.
 * Returns null if the category is unknown.
 */
function getMascotForLevel(bmiCategory, level) {
  const stages = MASCOT_EVOLUTION[bmiCategory];
  if (!stages) return null;
  const stageIndex = getMascotStageForLevel(level);
  return stages[stageIndex];
}

/**
 * Checks if a level-up triggers a mascot evolution and applies it.
 * Called after XP is applied and level changes.
 *
 * Returns evolution info if evolution occurred, null otherwise.
 * Also awards the appropriate badge.
 */
function checkAndApplyEvolution(userId, previousLevel, newLevel) {
  if (newLevel <= previousLevel) return null;

  const crossedLevel5 =
    previousLevel < EVOLUTION_LEVEL_5 && newLevel >= EVOLUTION_LEVEL_5;
  const crossedLevel10 =
    previousLevel < EVOLUTION_LEVEL_10 && newLevel >= EVOLUTION_LEVEL_10;

  if (!crossedLevel5 && !crossedLevel10) return null;

  const user = db
    .prepare("SELECT bmi_category, mascot_id, mascot_name, mascot_stage FROM users WHERE id = ?")
    .get(userId);

  if (!user || !user.bmi_category) return null;

  const newMascot = getMascotForLevel(user.bmi_category, newLevel);
  if (!newMascot) return null;

  if (newMascot.id === user.mascot_id) return null;

  const previousMascot = { id: user.mascot_id, name: user.mascot_name };
  const now = new Date().toISOString();

  db.prepare(
    "UPDATE users SET mascot_id = ?, mascot_name = ?, mascot_stage = ? WHERE id = ?"
  ).run(newMascot.id, newMascot.name, newMascot.stage, userId);

  // Award badge — Level 10 gets "Champion", Level 5 gets "Mascot Evolution"
  let badgeType;
  let badgeName;
  if (crossedLevel10) {
    badgeType = "champion";
    badgeName = "Champion";
  } else {
    badgeType = "evolution_5";
    badgeName = "Mascot Evolution";
  }

  // If user crosses both 5 and 10 in one jump, award both badges
  if (crossedLevel5 && crossedLevel10) {
    db.prepare(
      `INSERT OR IGNORE INTO badges (id, user_id, badge_type, badge_name, awarded_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(uuidv4(), userId, "evolution_5", "Mascot Evolution", now);
  }

  db.prepare(
    `INSERT OR IGNORE INTO badges (id, user_id, badge_type, badge_name, awarded_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(uuidv4(), userId, badgeType, badgeName, now);

  return {
    previousMascot,
    newMascot: { id: newMascot.id, name: newMascot.name, stage: newMascot.stage },
    badgeType,
    badgeName,
    evolutionLevel: crossedLevel10 ? 10 : 5,
  };
}

export {
  MASCOT_EVOLUTION,
  EVOLUTION_LEVEL_5,
  EVOLUTION_LEVEL_10,
  getMascotForLevel,
  getMascotStageForLevel,
  checkAndApplyEvolution,
};
