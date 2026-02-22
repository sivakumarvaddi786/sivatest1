/**
 * XP System and Level Tracking (US-019)
 *
 * Level thresholds:
 *   Level 1 = 0 XP
 *   Level 2 = 500 XP
 *   Level 3 = 1,200 XP
 *   Each subsequent level requires ~20% more XP than the previous increment.
 *
 * Daily XP cap: ~150 XP
 */

const DAILY_XP_CAP = 150;

/**
 * Pre-computed level thresholds. Index = level - 1, value = minimum XP for that level.
 * Generated from the rules: L1=0, L2=500, L3=1200, then each increment grows by ~20%.
 */
function buildLevelThresholds(maxLevel = 100) {
  const thresholds = [0, 500, 1200]; // Levels 1, 2, 3
  let prevIncrement = 700; // 1200 - 500
  for (let i = 3; i < maxLevel; i++) {
    prevIncrement = Math.round(prevIncrement * 1.2);
    thresholds.push(thresholds[i - 1] + prevIncrement);
  }
  return thresholds;
}

const LEVEL_THRESHOLDS = buildLevelThresholds();

/**
 * Returns the level for a given total XP.
 */
function getLevelForXp(xp) {
  let level = 1;
  for (let i = 1; i < LEVEL_THRESHOLDS.length; i++) {
    if (xp >= LEVEL_THRESHOLDS[i]) {
      level = i + 1;
    } else {
      break;
    }
  }
  return level;
}

/**
 * Returns the XP threshold needed to reach the next level.
 * Returns null if already at max level.
 */
function getXpForNextLevel(level) {
  if (level >= LEVEL_THRESHOLDS.length) return null;
  return LEVEL_THRESHOLDS[level]; // level is 1-indexed, so LEVEL_THRESHOLDS[level] = threshold for level+1
}

/**
 * Caps the proposed XP delta so the daily total doesn't exceed DAILY_XP_CAP.
 * @param {number} currentDayXp - XP already earned today (from daily_logs.xp_earned)
 * @param {number} proposedDelta - XP about to be awarded
 * @returns {number} The actual delta to award (0 if cap already reached)
 */
function capDailyXp(currentDayXp, proposedDelta) {
  if (proposedDelta <= 0) return 0;
  const remaining = Math.max(0, DAILY_XP_CAP - (currentDayXp ?? 0));
  return Math.min(proposedDelta, remaining);
}

export {
  DAILY_XP_CAP,
  LEVEL_THRESHOLDS,
  getLevelForXp,
  getXpForNextLevel,
  capDailyXp,
};
