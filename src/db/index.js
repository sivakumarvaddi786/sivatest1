import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DB_PATH = process.env.DB_PATH || join(__dirname, "../../data/lifepush.db");

// Ensure the data directory exists
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id              TEXT PRIMARY KEY,
    email           TEXT UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,
    name            TEXT,
    age             INTEGER,
    gender          TEXT CHECK(gender IN ('male', 'female', 'other')),
    height_cm       REAL,
    weight_kg       REAL,
    bmi             REAL,
    bmi_category    TEXT CHECK(bmi_category IN ('underweight', 'normal', 'overweight', 'obese_1', 'obese_2')),
    mascot_id       INTEGER,
    mascot_name     TEXT,
    xp_total        INTEGER DEFAULT 0,
    level           INTEGER DEFAULT 1,
    current_streak  INTEGER DEFAULT 0,
    longest_streak  INTEGER DEFAULT 0,
    streak_shields  INTEGER DEFAULT 0,
    timezone        TEXT,
    created_at      TEXT NOT NULL,
    last_active_at  TEXT NOT NULL,
    email_verified  INTEGER DEFAULT 0,
    onboarding_step INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS email_verifications (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token           TEXT UNIQUE NOT NULL,
    expires_at      TEXT NOT NULL,
    used            INTEGER DEFAULT 0,
    created_at      TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS password_resets (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token           TEXT UNIQUE NOT NULL,
    expires_at      TEXT NOT NULL,
    used            INTEGER DEFAULT 0,
    created_at      TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id             TEXT PRIMARY KEY,
    user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token          TEXT UNIQUE NOT NULL,
    expires_at     TEXT NOT NULL,
    last_active_at TEXT NOT NULL,
    created_at     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS habits_config (
    id                  TEXT PRIMARY KEY,
    user_id             TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    daily_steps         INTEGER NOT NULL,
    hydration_glasses   INTEGER NOT NULL,
    sleep_hours_min     INTEGER NOT NULL DEFAULT 7,
    sleep_hours_max     INTEGER NOT NULL DEFAULT 8,
    movement_preference TEXT NOT NULL CHECK(movement_preference IN ('chair_exercises', 'walking', 'jumping_jacks')),
    vegetables_per_day  INTEGER NOT NULL DEFAULT 2,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS teams (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    invite_code TEXT UNIQUE NOT NULL,
    owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS team_members (
    id        TEXT PRIMARY KEY,
    team_id   TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role      TEXT NOT NULL CHECK(role IN ('owner', 'member')),
    joined_at TEXT NOT NULL,
    UNIQUE(team_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS mascots (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    bmi_category TEXT CHECK(bmi_category IN ('underweight', 'normal', 'overweight', 'obese_1', 'obese_2')),
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS daily_logs (
    id                TEXT PRIMARY KEY,
    user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    log_date          TEXT NOT NULL,
    steps             INTEGER,
    hydration_glasses INTEGER,
    sleep_hours       REAL,
    movement_done     INTEGER DEFAULT 0,
    vegetables_count  INTEGER,
    mood              INTEGER CHECK(mood BETWEEN 1 AND 5),
    notes             TEXT,
    xp_earned         INTEGER DEFAULT 0,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL,
    UNIQUE(user_id, log_date)
  );

  CREATE TABLE IF NOT EXISTS team_challenges (
    id             TEXT PRIMARY KEY,
    team_id        TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    title          TEXT NOT NULL,
    description    TEXT,
    challenge_type TEXT NOT NULL CHECK(challenge_type IN ('steps', 'hydration', 'sleep', 'movement', 'vegetables')),
    target_value   INTEGER NOT NULL,
    start_date     TEXT NOT NULL,
    end_date       TEXT NOT NULL,
    created_by     TEXT NOT NULL REFERENCES users(id),
    created_at     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS challenge_entries (
    id           TEXT PRIMARY KEY,
    challenge_id TEXT NOT NULL REFERENCES team_challenges(id) ON DELETE CASCADE,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    value        INTEGER NOT NULL,
    logged_at    TEXT NOT NULL,
    created_at   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notifications_config (
    id                       TEXT PRIMARY KEY,
    user_id                  TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email_enabled            INTEGER DEFAULT 1,
    push_enabled             INTEGER DEFAULT 0,
    daily_reminder_enabled   INTEGER DEFAULT 1,
    reminder_time            TEXT DEFAULT '08:00',
    team_updates_enabled     INTEGER DEFAULT 1,
    challenge_updates_enabled INTEGER DEFAULT 1,
    created_at               TEXT NOT NULL,
    updated_at               TEXT NOT NULL
  );
`);

// Migration: add onboarding_step to existing databases
try {
  db.exec("ALTER TABLE users ADD COLUMN onboarding_step INTEGER DEFAULT 0");
} catch {
  // Column already exists — safe to ignore
}

// Migration: add team_reminder_at to existing databases
try {
  db.exec("ALTER TABLE users ADD COLUMN team_reminder_at TEXT");
} catch {
  // Column already exists — safe to ignore
}

// Migration: add steps source-tracking columns to daily_logs (US-012)
try {
  db.exec("ALTER TABLE daily_logs ADD COLUMN steps_manual INTEGER");
} catch {
  // Column already exists — safe to ignore
}
try {
  db.exec("ALTER TABLE daily_logs ADD COLUMN steps_google_fit INTEGER");
} catch {
  // Column already exists — safe to ignore
}
try {
  db.exec("ALTER TABLE daily_logs ADD COLUMN steps_goal_xp_awarded INTEGER DEFAULT 0");
} catch {
  // Column already exists — safe to ignore
}
try {
  db.exec("ALTER TABLE daily_logs ADD COLUMN steps_last_bonus_at TEXT");
} catch {
  // Column already exists — safe to ignore
}

// Migration: add movement XP tracking column to daily_logs (US-013)
try {
  db.exec("ALTER TABLE daily_logs ADD COLUMN movement_xp_awarded INTEGER DEFAULT 0");
} catch {
  // Column already exists — safe to ignore
}

// Migration: add hydration XP tracking columns to daily_logs (US-014)
try {
  db.exec("ALTER TABLE daily_logs ADD COLUMN hydration_xp_glasses INTEGER DEFAULT 0");
} catch {
  // Column already exists — safe to ignore
}
try {
  db.exec("ALTER TABLE daily_logs ADD COLUMN hydration_goal_xp_awarded INTEGER DEFAULT 0");
} catch {
  // Column already exists — safe to ignore
}

// Migration: add sleep tracking columns to daily_logs (US-015)
try {
  db.exec("ALTER TABLE daily_logs ADD COLUMN sleep_start TEXT");
} catch {
  // Column already exists — safe to ignore
}
try {
  db.exec("ALTER TABLE daily_logs ADD COLUMN sleep_end TEXT");
} catch {
  // Column already exists — safe to ignore
}
try {
  db.exec("ALTER TABLE daily_logs ADD COLUMN sleep_xp_start_awarded INTEGER DEFAULT 0");
} catch {
  // Column already exists — safe to ignore
}
try {
  db.exec("ALTER TABLE daily_logs ADD COLUMN sleep_xp_end_awarded INTEGER DEFAULT 0");
} catch {
  // Column already exists — safe to ignore
}
try {
  db.exec("ALTER TABLE daily_logs ADD COLUMN sleep_goal_xp_awarded INTEGER DEFAULT 0");
} catch {
  // Column already exists — safe to ignore
}

// Migration: add streak evaluation tracking to users (US-020)
try {
  db.exec("ALTER TABLE users ADD COLUMN streak_last_evaluated_date TEXT");
} catch {
  // Column already exists — safe to ignore
}

// Migration: add food habit tracking columns to daily_logs (US-016)
try {
  db.exec("ALTER TABLE daily_logs ADD COLUMN food_vegetables INTEGER DEFAULT 0");
} catch {
  // Column already exists — safe to ignore
}
try {
  db.exec("ALTER TABLE daily_logs ADD COLUMN food_no_junk INTEGER DEFAULT 0");
} catch {
  // Column already exists — safe to ignore
}
try {
  db.exec("ALTER TABLE daily_logs ADD COLUMN food_breakfast INTEGER DEFAULT 0");
} catch {
  // Column already exists — safe to ignore
}
try {
  db.exec("ALTER TABLE daily_logs ADD COLUMN food_veg_xp_awarded INTEGER DEFAULT 0");
} catch {
  // Column already exists — safe to ignore
}
try {
  db.exec("ALTER TABLE daily_logs ADD COLUMN food_nojunk_xp_awarded INTEGER DEFAULT 0");
} catch {
  // Column already exists — safe to ignore
}
try {
  db.exec("ALTER TABLE daily_logs ADD COLUMN food_breakfast_xp_awarded INTEGER DEFAULT 0");
} catch {
  // Column already exists — safe to ignore
}

export default db;
