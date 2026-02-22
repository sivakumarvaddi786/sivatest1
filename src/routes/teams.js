import { Router } from "express";
import { body, validationResult } from "express-validator";
import { v4 as uuidv4 } from "uuid";
import db from "../db/index.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();

router.use(requireAuth);

/**
 * GET /api/teams
 *
 * Returns all teams the current user is a member of.
 */
router.get("/", (req, res) => {
  const teams = db
    .prepare(
      `SELECT t.id, t.name, t.invite_code, t.owner_id, t.created_at, tm.role,
              (SELECT COUNT(*) FROM team_members WHERE team_id = t.id) as member_count
       FROM team_members tm
       JOIN teams t ON t.id = tm.team_id
       WHERE tm.user_id = ?`
    )
    .all(req.user.id);

  return res.json({ teams });
});

/**
 * POST /api/teams
 *
 * Creates a new team. The creator becomes the owner.
 */
const createTeamValidation = [
  body("name")
    .isString()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage("Team name must be between 1 and 100 characters."),
];

router.post("/", createTeamValidation, (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: "Validation failed",
      details: errors.array().map((e) => ({ field: e.path, message: e.msg })),
    });
  }

  const { name } = req.body;
  const teamId = uuidv4();
  const inviteCode = uuidv4().replace(/-/g, "").substring(0, 8).toUpperCase();
  const now = new Date().toISOString();

  db.transaction(() => {
    db.prepare(
      "INSERT INTO teams (id, name, invite_code, owner_id, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(teamId, name, inviteCode, req.user.id, now);

    db.prepare(
      "INSERT INTO team_members (id, team_id, user_id, role, joined_at) VALUES (?, ?, ?, 'owner', ?)"
    ).run(uuidv4(), teamId, req.user.id, now);
  })();

  return res.status(201).json({
    message: "Team created successfully.",
    team: { id: teamId, name, inviteCode, role: "owner" },
  });
});

/**
 * POST /api/teams/join
 *
 * Join an existing team using an invite code.
 */
const joinTeamValidation = [
  body("inviteCode")
    .isString()
    .trim()
    .notEmpty()
    .withMessage("Invite code is required."),
];

router.post("/join", joinTeamValidation, (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: "Validation failed",
      details: errors.array().map((e) => ({ field: e.path, message: e.msg })),
    });
  }

  const { inviteCode } = req.body;

  const team = db
    .prepare("SELECT * FROM teams WHERE invite_code = ?")
    .get(inviteCode.toUpperCase());

  if (!team) {
    return res.status(404).json({ error: "Invalid invite code. No team found." });
  }

  const existing = db
    .prepare("SELECT id FROM team_members WHERE team_id = ? AND user_id = ?")
    .get(team.id, req.user.id);

  if (existing) {
    return res
      .status(409)
      .json({ error: "You are already a member of this team." });
  }

  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO team_members (id, team_id, user_id, role, joined_at) VALUES (?, ?, ?, 'member', ?)"
  ).run(uuidv4(), team.id, req.user.id, now);

  return res.json({
    message: "Joined team successfully.",
    team: { id: team.id, name: team.name, role: "member" },
  });
});

/**
 * GET /api/teams/:id/leaderboard
 *
 * Returns team members sorted by XP (descending), with streak as tiebreaker.
 * Requires the requesting user to be a member of the team.
 */
router.get("/:id/leaderboard", (req, res) => {
  const { id } = req.params;

  const membership = db
    .prepare("SELECT role FROM team_members WHERE team_id = ? AND user_id = ?")
    .get(id, req.user.id);

  if (!membership) {
    return res.status(403).json({ error: "You are not a member of this team." });
  }

  const members = db
    .prepare(
      `SELECT u.id, u.name, u.xp_total, u.level, u.current_streak, u.longest_streak, tm.role
       FROM team_members tm
       JOIN users u ON u.id = tm.user_id
       WHERE tm.team_id = ?
       ORDER BY u.xp_total DESC, u.current_streak DESC`
    )
    .all(id);

  return res.json({
    teamId: id,
    leaderboard: members.map((m, idx) => ({
      rank: idx + 1,
      userId: m.id,
      name: m.name,
      xpTotal: m.xp_total,
      level: m.level,
      currentStreak: m.current_streak,
      longestStreak: m.longest_streak,
      role: m.role,
    })),
  });
});

/**
 * POST /api/teams/:id/challenges/:challengeId
 *
 * Submits a progress entry for an existing challenge.
 * Body: { value: integer }
 *
 * Requires: team membership + active challenge (not past end_date).
 */
const challengeEntryValidation = [
  body("value")
    .isInt({ min: 0 })
    .withMessage("Value must be a non-negative integer."),
];

router.post("/:id/challenges/:challengeId", challengeEntryValidation, (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: "Validation failed",
      details: errors.array().map((e) => ({ field: e.path, message: e.msg })),
    });
  }

  const { id, challengeId } = req.params;
  const { value } = req.body;

  const membership = db
    .prepare("SELECT role FROM team_members WHERE team_id = ? AND user_id = ?")
    .get(id, req.user.id);

  if (!membership) {
    return res.status(403).json({ error: "You are not a member of this team." });
  }

  const challenge = db
    .prepare("SELECT * FROM team_challenges WHERE id = ? AND team_id = ?")
    .get(challengeId, id);

  if (!challenge) {
    return res.status(404).json({ error: "Challenge not found." });
  }

  const today = new Date().toISOString().slice(0, 10);
  if (challenge.end_date < today) {
    return res.status(400).json({ error: "This challenge has already ended." });
  }

  const now = new Date().toISOString();
  const entryId = uuidv4();

  db.prepare(
    `INSERT INTO challenge_entries (id, challenge_id, user_id, value, logged_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(entryId, challengeId, req.user.id, value, now, now);

  return res.status(201).json({
    message: "Challenge entry submitted successfully.",
    entry: {
      id: entryId,
      challengeId,
      userId: req.user.id,
      value,
      loggedAt: now,
    },
  });
});

/**
 * GET /api/teams/:id/challenges/:challengeId
 *
 * Returns challenge details and all submitted entries for the challenge.
 * Requires team membership.
 */
router.get("/:id/challenges/:challengeId", (req, res) => {
  const { id, challengeId } = req.params;

  const membership = db
    .prepare("SELECT role FROM team_members WHERE team_id = ? AND user_id = ?")
    .get(id, req.user.id);

  if (!membership) {
    return res.status(403).json({ error: "You are not a member of this team." });
  }

  const challenge = db
    .prepare("SELECT * FROM team_challenges WHERE id = ? AND team_id = ?")
    .get(challengeId, id);

  if (!challenge) {
    return res.status(404).json({ error: "Challenge not found." });
  }

  const entries = db
    .prepare(
      `SELECT ce.id, ce.user_id, u.name, ce.value, ce.logged_at
       FROM challenge_entries ce
       JOIN users u ON u.id = ce.user_id
       WHERE ce.challenge_id = ?
       ORDER BY ce.value DESC, ce.logged_at ASC`
    )
    .all(challengeId);

  return res.json({ challenge, entries });
});

export default router;
