# Ralph Progress Log

This file tracks progress across iterations. Agents update this file
after each iteration and it's included in prompts for context.

## Codebase Patterns (Study These First)

### Tech Stack
- **Runtime:** Node.js v22 + ESM (`"type": "module"` in package.json)
- **Framework:** Express 4.x
- **Database:** SQLite via `better-sqlite3` (synchronous API — no async needed for DB ops)
- **Auth:** `bcryptjs` for password hashing (cost factor 12)
- **Validation:** `express-validator` (body validators, `validationResult`)
- **Email:** `nodemailer` v8 (uses `createTransport`, `createTestAccount` for dev fallback)
- **Security:** `helmet` for HTTP headers; `trust proxy` set to 1 for reverse proxy support
- **IDs:** UUIDs via `uuid` v11 (`v4`)
- **Env vars:** `dotenv` loaded via `import "dotenv/config"` at app entry point

### Project Structure
```
src/
  index.js              # Express app setup + server listen
  db/index.js           # SQLite init, schema creation (CREATE TABLE IF NOT EXISTS)
  routes/auth.js        # POST /api/auth/register (and future auth routes)
  services/email.js     # sendVerificationEmail() — Ethereal fallback in dev
  middleware/httpsRedirect.js  # enforceHttps() middleware
data/                   # SQLite DB files (gitignored)
```

### Patterns
- **Database init:** Schema created at import time in `src/db/index.js`. Safe to re-import (uses `IF NOT EXISTS`).
- **Error responses:** Always `{ error: "..." }` with HTTP status. Validation errors add `details: [{field, message}]`.
- **Email is non-blocking:** Verification email sent with `.catch()` so registration doesn't fail if SMTP is down.
- **HTTPS enforcement:** Via `FORCE_HTTPS=true` env var; checks `X-Forwarded-Proto` for proxy scenarios.
- **ESLint config:** Flat config (`eslint.config.js`) with `globals.node` to recognize `process`/`console`.

---

## 2026-02-22 - US-001
- **What was implemented:** User registration endpoint (`POST /api/auth/register`) with full acceptance criteria coverage
- **Files changed:**
  - `package.json` — new project (Express, bcryptjs, better-sqlite3, nodemailer v8, express-validator, helmet, uuid, dotenv)
  - `eslint.config.js` — ESLint flat config with Node globals
  - `.env.example` — environment variable template
  - `.gitignore` — excludes `node_modules/`, `data/`, `.env`, `*.db`
  - `src/index.js` — Express app entry point with helmet, trust proxy, 404/error handlers
  - `src/db/index.js` — SQLite init with `users` and `email_verifications` tables
  - `src/routes/auth.js` — Registration route with validation, bcrypt hashing, duplicate check, verification token creation
  - `src/services/email.js` — Nodemailer email service with Ethereal test fallback
  - `src/middleware/httpsRedirect.js` — HTTPS redirect middleware using `FORCE_HTTPS` env var
- **Learnings:**
  - `better-sqlite3` is synchronous — no `await` needed for DB operations, simplifies route handlers
  - nodemailer v8 still supports `createTestAccount`/`getTestMessageUrl` (same API as v6)
  - ESLint 10 flat config requires explicit `globals.node` from the `globals` package to recognize `process`/`console`
  - bcryptjs (pure JS) vs bcrypt (native): chose bcryptjs to avoid native compilation issues on Windows
  - SQLite stores booleans as integers (0/1); `email_verified INTEGER DEFAULT 0`
  - Email verification token stored in separate `email_verifications` table with expiry — keeps users table clean
  - `npm audit` flagged nodemailer <=7.0.10 and eslint <=9.x (minimatch ReDoS) — upgraded both to fix
---

## 2026-02-22 - US-002
- **What was implemented:** Email verification flow — verify endpoint, resend endpoint, and email verification guard middleware
- **Files changed:**
  - `src/routes/auth.js` — added `GET /api/auth/verify-email?token=...` and `POST /api/auth/resend-verification`
  - `src/middleware/requireEmailVerified.js` — middleware that checks `req.user.id` against `email_verified` in DB; returns 401/403 as appropriate
  - `src/routes/dashboard.js` — placeholder protected route guarded by `requireEmailVerified`; demonstrates unverified users get 403
  - `src/index.js` — mounted `dashboardRouter` at `/api/dashboard`
- **Learnings:**
  - `better-sqlite3` transactions: use `db.transaction(() => { ... })()` (IIFE) — the `.transaction()` call returns a function you must invoke
  - Resend endpoint invalidates existing unused tokens before creating a new one to enforce single-use per flow
  - Generic response on resend (`"If an account with this email exists..."`) prevents email enumeration
  - `requireEmailVerified` middleware depends on a preceding auth middleware setting `req.user`; wired to a placeholder dashboard route now, will connect to session/JWT auth in US-003+
  - `GET` verb used for verify-email since it is accessed by clicking a link in an email (browser navigation)
---

## 2026-02-22 - US-003
- **What was implemented:** Password reset via email flow — forgot-password endpoint, reset-password endpoint, password_resets DB table, and reset email template
- **Files changed:**
  - `src/db/index.js` — added `password_resets` table (mirrors `email_verifications` schema: id, user_id, token, expires_at, used, created_at)
  - `src/services/email.js` — added `sendPasswordResetEmail()` function; same transporter/Ethereal pattern as sendVerificationEmail
  - `src/routes/auth.js` — added `POST /api/auth/forgot-password` and `POST /api/auth/reset-password` routes
- **Learnings:**
  - Reset token expiry set to 1 hour (vs 24h for email verification) per AC requirement — just `Date.now() + 60 * 60 * 1000`
  - Generic response on forgot-password ("If an account with this email exists...") prevents email enumeration, same pattern used for resend-verification
  - Invalidate existing unused tokens before creating a new one — prevents token accumulation and keeps only the latest reset active
  - `reset-password` uses same `db.transaction(() => { ... })()` IIFE pattern as verify-email to atomically update password_hash and mark token used
  - Error messages differentiate between "used" token vs "expired" vs "invalid" for clear UX per AC requirement
  - No new npm packages needed — uuid, bcryptjs, express-validator, nodemailer already available
---

## 2026-02-22 - US-004
- **What was implemented:** Session management — login endpoint, logout endpoint, session DB table, and `requireAuth` middleware with 30-day sliding expiry
- **Files changed:**
  - `src/db/index.js` — added `sessions` table (id, user_id, token, expires_at, last_active_at, created_at)
  - `src/middleware/requireAuth.js` — new middleware; validates Bearer token, slides expiry on each request, sets `req.user` and `req.sessionId`
  - `src/routes/auth.js` — added `POST /api/auth/login` (bcrypt verify, email-verified guard, session creation) and `POST /api/auth/logout` (deletes session)
  - `src/routes/dashboard.js` — added `requireAuth` before `requireEmailVerified` to properly guard protected routes
- **Learnings:**
  - DB-backed sessions (UUID tokens in SQLite) chosen over JWT — fits the synchronous `better-sqlite3` pattern and allows immediate invalidation on logout
  - Sliding 30-day window: each authenticated request updates `last_active_at` and resets `expires_at = now + 30d` in a single UPDATE
  - Expired session cleanup happens inline on the request that encounters the expired token (`DELETE FROM sessions WHERE id = ?`) — no separate cron job needed at this scale
  - Timing-attack protection on login: always run `bcrypt.compare()` even for unknown emails using a dummy hash, so response time doesn't reveal whether an email exists
  - `requireAuth` sets both `req.user` (full user row) and `req.sessionId` — logout uses `req.sessionId` to avoid a second DB lookup
  - `requireEmailVerified` needed no changes; it already depends on `req.user.id` being set by a preceding auth middleware
  - Session token returned as `{ token, expiresAt }` — client stores it and sends `Authorization: Bearer <token>` on subsequent requests
  - 401 = "session expired/invalid", 403 = "email not verified" — clear differentiation for the frontend to redirect appropriately
---

## 2026-02-22 - US-005
- **What was implemented:** Onboarding Step 1 — name, age, gender collection with progress persistence and dashboard guard
- **Files changed:**
  - `src/db/index.js` — added `onboarding_step INTEGER DEFAULT 0` to `users` CREATE TABLE; added `ALTER TABLE users ADD COLUMN` migration wrapped in try/catch for existing DBs
  - `src/routes/onboarding.js` — new file: `GET /api/onboarding/status` (returns current step + saved data for resume) and `POST /api/onboarding/step1` (validates name/age/gender, persists to users table, advances step with `MAX(onboarding_step, 1)`)
  - `src/middleware/requireOnboardingComplete.js` — new middleware; blocks dashboard access if `onboarding_step < TOTAL_ONBOARDING_STEPS` (currently 1); returns 403 with current step so client can redirect
  - `src/routes/dashboard.js` — added `requireOnboardingComplete` after `requireEmailVerified`
  - `src/index.js` — mounted `onboardingRouter` at `/api/onboarding`
- **Learnings:**
  - SQLite doesn't support `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` — use try/catch around `ALTER TABLE` as the standard migration pattern for simple SQLite apps without a migration framework
  - `onboarding_step = MAX(onboarding_step, 1)` in the UPDATE prevents step regression if a user re-submits step 1 after completing later steps
  - `TOTAL_ONBOARDING_STEPS = 1` constant in the middleware makes it easy to bump the threshold as future onboarding steps are added
  - `requireAuth` does `SELECT * FROM users` so `req.user` automatically includes `onboarding_step` after column is added — no changes needed to that middleware
  - 403 response from `requireOnboardingComplete` includes `onboardingStep` field so the client knows which step to redirect to
  - Onboarding routes are mounted before dashboard routes in `index.js` to ensure clean routing order
---

## 2026-02-22 - US-006
- **What was implemented:** Onboarding Step 2 — height, weight, and BMI calculation with motivational category labels
- **Files changed:**
  - `src/routes/onboarding.js` — added `getBmiInfo()` helper, updated `GET /api/onboarding/status` to return height/weight/bmi fields, added `step2Validation` array with cross-field BMI range check, added `POST /api/onboarding/step2`
  - `src/middleware/requireOnboardingComplete.js` — bumped `TOTAL_ONBOARDING_STEPS` from 1 to 2
- **Learnings:**
  - No new DB migrations needed — `height_cm`, `weight_kg`, `bmi`, `bmi_category` were already included in the initial `CREATE TABLE IF NOT EXISTS` from US-001; only `onboarding_step` needed a migration (added in US-005)
  - BMI category is stored internally as `'underweight'|'normal'|'overweight'|'obese_1'|'obese_2'` (matches CHECK constraint), but user-facing labels never include the word 'obese' — two-layer mapping pattern (internal key + display label)
  - Cross-field BMI range validation done via `body('weight_kg').custom()` accessing `req.body.height_cm` — express-validator custom validators receive `{ req }` so cross-field checks are straightforward; use `.bail()` before the custom check to skip it if the primary field already failed
  - BMI rounded to 1 decimal place via `Math.round(bmi * 10) / 10` before storing and returning — avoids floating-point noise in the DB
  - `onboarding_step = MAX(onboarding_step, 2)` pattern prevents step regression on re-submission, consistent with step 1
  - Bumping `TOTAL_ONBOARDING_STEPS` in one constant is all that's needed to gate dashboard access to the new total — confirms the constant pattern from US-005 is working
---

## 2026-02-22 - US-007
- **What was implemented:** BMI-based mascot assignment — mascot assigned at end of onboarding step 2, returned on dashboard with streak-based mood
- **Files changed:**
  - `src/routes/onboarding.js` — added `MASCOT_MAP` constant mapping bmi_category to `{ id, name }`, updated `POST /api/onboarding/step2` to write `mascot_id`/`mascot_name` in the same UPDATE as bmi fields, updated `GET /api/onboarding/status` to SELECT and return mascot fields
  - `src/routes/dashboard.js` — added `db` import, replaced placeholder response with a real DB SELECT returning mascot (with mood), streak, xpTotal, and level
- **Learnings:**
  - `mascot_id` and `mascot_name` columns already existed in the initial `users` CREATE TABLE from US-001 — no migration needed
  - Mascot mood (`"happy"` / `"sad"`) derived from `current_streak > 0`; computed at read-time rather than stored — keeps the field always in sync with latest streak value
  - `MASCOT_MAP` keyed by internal bmi_category string (not numeric ID) — avoids a second lookup after `getBmiInfo()` already returns the category
  - Dashboard re-queries the DB rather than relying on `req.user` from `requireAuth` middleware — `req.user` is set from the sessions SELECT which does `SELECT * FROM users`, but being explicit is safer and avoids hidden dependencies on middleware column lists
  - Mascot in status response returns `null` when `mascot_id` is falsy — handles users who registered before US-007 without mascot data (graceful degradation)
---

## 2026-02-22 - US-008
- **What was implemented:** Onboarding Step 3 — goal selection with BMI-based pre-fills saved to `habits_config` table
- **Files changed:**
  - `src/db/index.js` — added `habits_config` table (id, user_id UNIQUE, daily_steps, hydration_glasses, sleep_hours_min, sleep_hours_max, movement_preference CHECK, vegetables_per_day, created_at, updated_at)
  - `src/routes/onboarding.js` — added `uuid` import, `computeGoalPrefill()` helper, updated `GET /api/onboarding/status` to query `habits_config` and return `goals` + `goalPrefill`, added `step3Validation` and `POST /api/onboarding/step3`
  - `src/middleware/requireOnboardingComplete.js` — bumped `TOTAL_ONBOARDING_STEPS` from 2 to 3
- **Learnings:**
  - Hydration conversion: 1 glass = 250 ml = 0.25 L → `Math.round((weight_kg * 0.033) / 0.25)` — produces ~9 glasses for 70 kg, consistent with standard guidance
  - SQLite upsert pattern for `habits_config`: `INSERT ... ON CONFLICT(user_id) DO UPDATE SET ...` — cleaner than SELECT + INSERT/UPDATE; `user_id UNIQUE` is the conflict target
  - Pre-filled goals (steps, hydration, sleep, veg) are computed server-side from stored weight/bmi_category — user cannot tamper; only `movement_preference` is user-supplied in the step 3 body
  - Step 3 guards against step 2 being skipped: checks `weight_kg` and `bmi_category` are non-null before proceeding, returns 400 with a clear message if not
  - `status` endpoint now returns both `goalPrefill` (what to show before step 3 is submitted) and `goals` (saved config after submission) — client uses whichever is non-null based on `onboardingStep`
  - `TOTAL_ONBOARDING_STEPS = 3` constant in middleware is all that needs changing to extend the onboarding gate — confirms the pattern continues to work correctly
---

## 2026-02-22 - US-009
- **What was implemented:** Onboarding Step 4 — Team Prompt: create a team, join via invite code, or skip with 48-hour reminder
- **Files changed:**
  - `src/db/index.js` — added `teams` table (id, name, invite_code UNIQUE, owner_id, created_at) and `team_members` table (id, team_id, user_id, role, joined_at, UNIQUE(team_id, user_id)); added `ALTER TABLE users ADD COLUMN team_reminder_at TEXT` migration
  - `src/routes/onboarding.js` — updated `GET /api/onboarding/status` to query team membership and include `team` + `teamReminderAt` in data; added `step4Validation` and `POST /api/onboarding/step4` with three action branches (create/join/skip)
  - `src/middleware/requireOnboardingComplete.js` — bumped `TOTAL_ONBOARDING_STEPS` from 3 to 4
  - `src/routes/dashboard.js` — added team membership query; updated `GET /api/dashboard` to return `team` and `teamReminder` fields (reminder only shown if `team_reminder_at` is still in the future)
- **Learnings:**
  - Invite code generation: `v4().replace(/-/g, "").substring(0, 8).toUpperCase()` — yields an 8-char uppercase hex code (~4 billion unique values); simple and doesn't require a new dependency
  - `INSERT OR IGNORE INTO team_members` handles idempotent join (user already in team) without a separate existence check — works with the `UNIQUE(team_id, user_id)` constraint
  - 48-hour reminder stored as an ISO timestamp (`team_reminder_at`) on the user row — no scheduled job needed; the dashboard reads it and only surfaces the reminder while `team_reminder_at > now()`, computed at read-time
  - Three-action step pattern (create/join/skip) maps cleanly to a single endpoint with `action` body param; conditional express-validator `.if(body("action").equals(...))` guards field-specific validation without needing separate routes
  - Team data at dashboard-time requires a JOIN across `team_members` + `teams`; kept as a simple `.get()` since a user belongs to at most one team in this schema (UNIQUE per team_id+user_id, but a user could join multiple teams — current query returns the first match; sufficient for onboarding-era features)
  - `TOTAL_ONBOARDING_STEPS = 4` is the only change needed in the middleware — the TOTAL_ONBOARDING_STEPS constant pattern continues to work cleanly for gating dashboard access
---

## 2026-02-22 - US-010
- **What was implemented:** Onboarding Gate Enforcement — verified all acceptance criteria already satisfied by prior stories (US-005 through US-009); no new code required
- **Files changed:** None (implementation already complete)
- **Learnings:**
  - US-010 is a cross-cutting concern that was organically satisfied by the `requireOnboardingComplete` middleware (US-005) and the incremental `TOTAL_ONBOARDING_STEPS` pattern added through US-006/US-008/US-009
  - AC1 (dashboard blocked until onboarding complete): `requireOnboardingComplete` applied via `router.use` in `dashboard.js`; returns 403 + `onboardingStep: N` for client-side redirect
  - AC2 (per-step persistence with resume): `onboarding_step = MAX(onboarding_step, N)` prevents regression; `GET /api/onboarding/status` exposes all saved fields per step for seamless resume
  - AC3 (server-side completed state): `onboarding_step` stored in SQLite `users` table; gate constant `TOTAL_ONBOARDING_STEPS = 4` compared at middleware time
  - Pattern: gate enforcement stories that depend on multiple prerequisite stories should be verified-only tasks when prerequisites are well-implemented
---

## 2026-02-22 - US-039
- **What was implemented:** Added 5 missing core database tables to complete the full schema: `mascots`, `daily_logs`, `team_challenges`, `challenge_entries`, `notifications_config`
- **Files changed:**
  - `src/db/index.js` — appended 5 new `CREATE TABLE IF NOT EXISTS` blocks inside the existing `db.exec()` call; no migration needed (new tables only)
- **Learnings:**
  - `UNIQUE(user_id, log_date)` on `daily_logs` is a table-level constraint (not column-level) — required because it spans two columns
  - `teams.invite_code TEXT UNIQUE NOT NULL` was already implemented in US-009; AC requirement pre-satisfied
  - `challenge_entries` references `team_challenges(id)` with `ON DELETE CASCADE` — entries are only meaningful in the context of a challenge, so cascading delete is correct
  - `notifications_config` uses `user_id TEXT UNIQUE NOT NULL` (one-to-one with users) — same pattern as `habits_config`
  - `mascots` is a reference/seed table; uses TEXT UUID primary key per AC requirement; `users.mascot_id INTEGER` is a legacy numeric code from US-007 that doesn't FK-reference `mascots.id`
  - All new tables placed within the single `db.exec()` block — keeps schema creation atomic and consistent with the existing pattern
---

## 2026-02-22 - US-040
- **What was implemented:** All core REST API endpoints for users, habits, teams, and stats
- **Files changed:**
  - `src/routes/users.js` — new file: `GET /api/users/me`, `PATCH /api/users/me`, `PATCH /api/users/me/bmi`, `GET /api/users/me/stats`, `GET /api/users/me/streaks`
  - `src/routes/habits.js` — new file: `GET /api/habits/today`, `PATCH /api/habits/today/:category` (categories: steps, hydration, sleep, movement, vegetables)
  - `src/routes/teams.js` — new file: `GET /api/teams`, `POST /api/teams`, `POST /api/teams/join`, `GET /api/teams/:id/leaderboard`, `GET /api/teams/:id/challenges/:challengeId`, `POST /api/teams/:id/challenges/:challengeId`
  - `src/index.js` — mounted `usersRouter`, `habitsRouter`, `teamsRouter` at respective `/api/*` paths
- **Learnings:**
  - All new routes use only `requireAuth` (not `requireEmailVerified`/`requireOnboardingComplete`) — AC explicitly says "all endpoints require authentication except register and login", not full setup
  - `PATCH /api/habits/today/:category` uses `param()` from `express-validator` for URL parameter validation (not just `body()`) — different validator but same `validationResult()` aggregation
  - Dynamic `UPDATE` query built via object key iteration for `PATCH /api/users/me` — avoids multiple conditional SQL branches while staying safe (keys are allowlisted, never from user input)
  - `PATCH /api/habits/today/:category` uses upsert-like logic (SELECT then INSERT/UPDATE) rather than SQLite `INSERT OR REPLACE` to avoid clearing other columns in the same row
  - Team leaderboard membership check gates access (403 if not a member) — prevents leaking team data to non-members
  - `POST /api/teams/:id/challenges/:challengeId` submits a challenge entry for an existing challenge; the challenge must exist first (404 if not) — challenge creation is a separate concern not in this story's AC
  - Auth endpoints (register, login, verify-email, reset-password, logout) were all already implemented in prior stories (US-001 through US-004) — only user/habit/team/stats endpoints were new
---

## 2026-02-22 - US-011
- **What was implemented:** Dashboard home screen enrichment — added `todayChecklist` (habit goals + today's progress) and `adBanner` to the `GET /api/dashboard` response; the other 3 ACs (mascot, streak, XP/level) were already satisfied by US-007
- **Files changed:**
  - `src/routes/dashboard.js` — added 2 DB queries (`daily_logs` for today's progress, `habits_config` for goals), added `todayChecklist` and `adBanner` fields to the JSON response
- **Learnings:**
  - Three of five ACs (mascot display, streak count, XP+level) were already satisfied by US-007/US-009 — partial pre-satisfaction is common when dashboard stories build on prior infrastructure stories
  - `adBanner` for an API layer is represented as `{ enabled: true, placement: "bottom" }` — the client layer owns rendering; the API just surfaces the signal
  - Inline today's checklist on the dashboard response (rather than requiring a separate `/api/habits/today` call) reduces round-trips for the initial page load — same DB queries as the habits route, co-located in the dashboard handler
  - Dashboard now makes 4 DB queries (user, team, daily_logs, habits_config) — all synchronous `better-sqlite3` `.get()` calls, no async overhead
---

## 2026-02-22 - US-012
- **What was implemented:** Daily step logging with manual/Google Fit source tracking, effective-value logic (max of both sources), XP awards on goal completion, and incremental bonus XP
- **Files changed:**
  - `src/db/index.js` — added 4 migration ALTER TABLE statements: `steps_manual INTEGER`, `steps_google_fit INTEGER`, `steps_goal_xp_awarded INTEGER DEFAULT 0`, `steps_last_bonus_at TEXT` on `daily_logs`
  - `src/routes/habits.js` — added `handleStepsUpdate()` helper, added constants (`MAX_MANUAL_STEPS`, `STEP_BONUS_INCREMENT`, `STEP_BONUS_XP`, `TWO_HOURS_MS`), branched `PATCH /today/steps` to dedicated handler, updated `GET /today` response to expose `stepsManual`/`stepsGoogleFit`
- **Learnings:**
  - Effective steps = `Math.max(manual ?? 0, google_fit ?? 0)` — null sources treated as 0 so either source alone works without needing both present
  - Goal XP awarded once per day via `steps_goal_xp_awarded` flag column on `daily_logs`; avoids re-checking whether XP was already in the aggregate `xp_earned` total
  - Bonus XP cooldown tracked via `steps_last_bonus_at TEXT` — stored as ISO timestamp; delta check `Date.now() - new Date(ts).getTime() >= TWO_HOURS_MS`; null treated as epoch 0 (always eligible for first bonus)
  - `db.transaction(() => { ... })()` IIFE used to atomically update both `daily_logs` (xp_earned) and `users` (xp_total) — consistent with prior stories
  - Dynamic UPDATE via `Object.keys(fields).map(k => \`${k} = ?\`).join(", ")` + `...Object.values(fields)` spread — key/value order is stable (insertion order) so alignment is guaranteed
  - Dynamic INSERT uses same object spread pattern with `id`, `user_id`, `log_date`, `created_at` prepended before `...fields` which already contains `updated_at`
  - `source` defaults to `"manual"` when omitted — Google Fit sync is opt-in, not required for basic manual entry
  - Step goal XP: 5,000-step goal → 20 XP; all other goals → 40 XP (covers the 10,000-step case and any custom goal above 5k)
  - Manual cap (50,000) only applied to `source === "manual"` — Google Fit data not capped since device-reported totals are trusted
---

## 2026-02-22 - US-013
- **What was implemented:** Daily movement checklist — preset 3-exercise routines per `movement_preference`, 15 XP awarded on first completion each day, movement routine exposed in habits and dashboard responses
- **Files changed:**
  - `src/db/index.js` — added `movement_xp_awarded INTEGER DEFAULT 0` migration on `daily_logs` to track whether movement XP was already awarded for the day
  - `src/routes/habits.js` — added `MOVEMENT_XP = 15` constant, `MOVEMENT_EXERCISES` map (preference → 3-exercise routine), `handleMovementUpdate()` function (XP award logic, transaction-wrapped DB write); branched `PATCH /today/movement` to dedicated handler; added `movementRoutine` to `GET /today` response; exported `MOVEMENT_EXERCISES` as named export
  - `src/routes/dashboard.js` — imported `MOVEMENT_EXERCISES` from `habits.js`; added `movementRoutine` to `todayChecklist` in `GET /api/dashboard` response
- **Learnings:**
  - `MOVEMENT_EXERCISES` maps each `movement_preference` (`jumping_jacks`, `chair_exercises`, `walking`) to a unique set of 3 exercises drawn from the 4 available options (jumping jacks 20, chair squats 15, shoulder rolls 10, calf raises 20)
  - Movement XP uses a `movement_xp_awarded` flag column (same pattern as `steps_goal_xp_awarded` from US-012) — awarded once per day; toggling back to false does not revoke XP
  - `handleMovementUpdate()` follows the same `db.transaction(() => { ... })()` IIFE + dynamic fields object pattern as `handleStepsUpdate()` — consistent approach across habit categories with special logic
  - Named exports (`export { MOVEMENT_EXERCISES }`) can coexist with `export default router` in ESM — allows sharing the constant with `dashboard.js` without a separate constants file
  - Dashboard can import named exports from route modules to reuse shared constants without duplication — acceptable for small constants shared between 2 files
---

## 2026-02-22 - US-014
- **What was implemented:** Daily hydration checklist — dedicated hydration update handler with per-glass 5 XP awards, one-time 20 XP bonus on hitting daily target, and hydration progress summary on dashboard
- **Files changed:**
  - `src/db/index.js` — added 2 migration ALTER TABLE statements: `hydration_xp_glasses INTEGER DEFAULT 0` (tracks how many glasses have had XP awarded), `hydration_goal_xp_awarded INTEGER DEFAULT 0` (tracks one-time goal bonus) on `daily_logs`
  - `src/routes/habits.js` — added `HYDRATION_GLASS_XP = 5` and `HYDRATION_GOAL_BONUS_XP = 20` constants, `handleHydrationUpdate()` function (per-glass XP + goal bonus, transaction-wrapped DB write), branched `PATCH /today/hydration` to dedicated handler
  - `src/routes/dashboard.js` — added `hydration` summary object to `todayChecklist` with `current`, `target`, and `goalMet` fields for easy client rendering of "X of Y glasses"
- **Learnings:**
  - `hydration_xp_glasses` column tracks the high-water mark of glasses that have had XP awarded — prevents XP revocation if user corrects the count downward (same defensive pattern as `steps_goal_xp_awarded` but for incremental awards)
  - XP delta formula: `max(0, newGlasses - prevXpGlasses) * 5` — only awards XP for net-new glasses above the previous high-water mark
  - Default hydration goal of 8 glasses used when `habits_config` is missing — consistent with standard hydration guidance and the onboarding prefill formula
  - Dashboard `hydration` summary is a convenience object alongside `progress.hydration` — avoids forcing the client to cross-reference `goals.hydration_glasses` with `progress.hydration` for the common "X of Y" display
---

## 2026-02-22 - US-015
- **What was implemented:** Daily sleep checklist — dedicated sleep handler accepting sleep start/end times (HH:MM), auto-calculated sleep hours, XP awards for logging start (5 XP), logging end (5 XP), and 7+ hours bonus (15 XP)
- **Files changed:**
  - `src/db/index.js` — added 5 migration ALTER TABLE statements: `sleep_start TEXT`, `sleep_end TEXT`, `sleep_xp_start_awarded INTEGER DEFAULT 0`, `sleep_xp_end_awarded INTEGER DEFAULT 0`, `sleep_goal_xp_awarded INTEGER DEFAULT 0` on `daily_logs`
  - `src/routes/habits.js` — added `SLEEP_LOG_XP`, `SLEEP_GOAL_BONUS_XP`, `SLEEP_GOAL_HOURS` constants; added `handleSleepUpdate()` function (time parsing, auto-calc hours, XP awards, transaction-wrapped DB write); branched `PATCH /today/sleep` to dedicated handler; made `value` validator conditional to skip sleep (sleep uses `sleepStart`/`sleepEnd` body fields instead); updated `GET /today` response to expose `sleepStart`/`sleepEnd`
  - `src/routes/dashboard.js` — added `sleep` summary object to `todayChecklist` with `sleepStart`, `sleepEnd`, `hours`, `goalMet`; added `sleepStart`/`sleepEnd` to progress section
- **Learnings:**
  - Sleep time calculation across midnight: `endMin >= startMin ? endMin - startMin : 1440 - startMin + endMin` — handles the common case where bedtime is PM and wake-up is AM
  - Sleep uses `sleepStart`/`sleepEnd` body fields instead of the generic `value` field — required making the `value` validator conditional with `.if(param("category").not().equals("sleep"))` so the generic required-check is skipped for sleep
  - Three separate XP-awarded flag columns (`sleep_xp_start_awarded`, `sleep_xp_end_awarded`, `sleep_goal_xp_awarded`) — matches the per-action XP tracking pattern from hydration (per-glass tracking) but adapted for two discrete events + a goal
  - Sleep start and end can be logged independently (partial logging) — `effectiveStart`/`effectiveEnd` merges new input with previously stored values, so the user can log bedtime first and wake-up later
  - Sleep hours only calculated when both start and end are present; stored as `REAL` in `sleep_hours` column (same column used by the old generic handler) for backward compatibility
---

## 2026-02-22 - US-016
- **What was implemented:** Daily food habit checklist — 3 honour-system checkboxes ("Ate 2 servings of vegetables" 10 XP, "Skipped junk food today" 10 XP, "Ate breakfast" 5 XP) with per-item XP awards, exposed on both `/api/habits/today` and `/api/dashboard`
- **Files changed:**
  - `src/db/index.js` — added 6 migration ALTER TABLE statements: `food_vegetables`, `food_no_junk`, `food_breakfast` (boolean checkbox state), `food_veg_xp_awarded`, `food_nojunk_xp_awarded`, `food_breakfast_xp_awarded` (XP tracking flags) on `daily_logs`
  - `src/routes/habits.js` — added `FOOD_HABITS` constant map (item → label/xp/columns), `handleFoodUpdate()` function (validates item+checked, awards XP once per item per day), `buildFoodHabitsResponse()` helper (shared with dashboard), added "food" to `VALID_CATEGORIES`, made `value` validator skip food category; exported `FOOD_HABITS` and `buildFoodHabitsResponse`
  - `src/routes/dashboard.js` — imported `buildFoodHabitsResponse`, added `foodHabits` array to `todayChecklist` in dashboard response
- **Learnings:**
  - Food habits use `item`/`checked` body fields instead of the generic `value` field — required adding a second `.if(param("category").not().equals("food"))` to the value validator, same pattern as sleep
  - `FOOD_HABITS` as a config map (key → {label, xp, col, xpCol}) enables a single generic handler for all 3 items — avoids duplicating handler logic per food item
  - `buildFoodHabitsResponse()` extracted as a shared helper between habits GET and dashboard GET — returns a consistent `[{id, label, xp, checked}]` array for the client to render checkboxes
  - XP-awarded flag columns follow the same "don't revoke on uncheck" pattern as movement (US-013) — once XP is awarded for an item, unchecking doesn't take it back
  - Named exports (`FOOD_HABITS`, `buildFoodHabitsResponse`) added alongside existing `MOVEMENT_EXERCISES` export — confirms the pattern of sharing constants/helpers between route modules
---

## 2026-02-22 - US-017
- **What was implemented:** Daily checklist midnight reset via timezone-aware date computation — user's IANA timezone captured during onboarding step 1 and used to determine "today" in habits and dashboard queries, so the checklist resets at midnight in the user's local time
- **Files changed:**
  - `src/utils/date.js` — new file: `getTodayForTimezone(timezone)` helper using `Intl.DateTimeFormat` with `en-CA` locale (native YYYY-MM-DD format); falls back to UTC if timezone is null/invalid
  - `src/routes/onboarding.js` — added optional `timezone` field to step 1 validation and save logic; added `timezone` to status SELECT and response data
  - `src/routes/habits.js` — imported `getTodayForTimezone`; replaced `new Date().toISOString().slice(0, 10)` with `getTodayForTimezone(req.user.timezone)` in both `GET /today` and `PATCH /today/:category`
  - `src/routes/dashboard.js` — imported `getTodayForTimezone`; replaced UTC date with `getTodayForTimezone(user.timezone)` for today's checklist query; added `timezone` to user SELECT
- **Learnings:**
  - `Intl.DateTimeFormat` with `en-CA` locale natively produces YYYY-MM-DD format — no string manipulation needed; built into Node.js, no external dependency
  - Previous day's logs are inherently preserved by the `UNIQUE(user_id, log_date)` constraint — no deletion or archival logic needed for "reset"
  - "Reset" is implicit: when the date changes in the user's timezone, queries return no existing record, so the UI shows an empty checklist; first habit update creates a new `daily_logs` row
  - `req.user.timezone` is automatically available because `requireAuth` middleware does `SELECT * FROM users` — no additional DB query needed
  - Timezone is optional in step 1 (not all clients may detect it at onboarding time); can also be updated later via `PATCH /api/users/me` which already supports the `timezone` field
  - `PATCH /api/users/me` already accepted `timezone` (from US-040) — no changes needed there
---

## 2026-02-22 - US-019
- **What was implemented:** XP system and level tracking — level calculation from XP thresholds, daily XP cap (~150), level-up detection on every habit completion, level progress info on dashboard and profile
- **Files changed:**
  - `src/utils/xp.js` — new file: `DAILY_XP_CAP`, `LEVEL_THRESHOLDS` (pre-computed array), `getLevelForXp()`, `getXpForNextLevel()`, `capDailyXp()` utilities
  - `src/routes/habits.js` — imported `capDailyXp`/`getLevelForXp`; added `applyXpToUser()` helper (updates xp_total + level in a transaction, returns level-up info); modified all 5 habit handlers (steps, movement, hydration, sleep, food) to cap daily XP before awarding, use `applyXpToUser` instead of raw `UPDATE users`, and return `xpTotal`, `level`, `levelUp` in responses
  - `src/routes/dashboard.js` — imported `getXpForNextLevel`/`DAILY_XP_CAP`; added `xpForNextLevel`, `dailyXpEarned`, `dailyXpCap` to dashboard response
  - `src/routes/users.js` — imported `getXpForNextLevel`; added `xpForNextLevel` to stats response
- **Learnings:**
  - Level thresholds generated from a formula (L1=0, L2=500, L3=1200, then +20% per increment) and stored in a pre-computed array — avoids recomputing on every request; `getLevelForXp()` is a simple linear scan
  - `applyXpToUser()` centralizes the XP→level update logic inside transactions — reads current xp_total/level, computes new level, writes both in one UPDATE; returns `{ previousLevel, newLevel, leveledUp }` for the response
  - Daily XP cap applied via `capDailyXp(currentDayXp, rawDelta)` — uses `daily_logs.xp_earned` as the running total; capping happens before the DB write so the flag columns and xp_earned stay consistent
  - `levelUp` in responses is `null` when no level-up occurred, or `{ previousLevel, newLevel }` when it did — client uses this to trigger animation
  - All 5 handlers follow the same pattern: compute raw XP → cap → build fields → transaction (daily_logs + applyXpToUser) → read updated state → respond with level info
---

## 2026-02-22 - US-020
- **What was implemented:** Streak system — lazy streak evaluation on dashboard/habits access, ≥3/5 category completion threshold, shield consumption on miss, longest streak tracking, categories-completed-today on dashboard
- **Files changed:**
  - `src/db/index.js` — added `streak_last_evaluated_date TEXT` migration on `users` table to track when streak was last evaluated
  - `src/utils/streak.js` — new file: `evaluateStreakIfNeeded(userId, timezone)` evaluates unevaluated days since last check, `countCompletedCategories(userId, dateStr)` counts completed categories (steps/hydration/sleep/movement/food) against goals
  - `src/routes/dashboard.js` — imported and called `evaluateStreakIfNeeded` before reading user data; added `categoriesCompletedToday`, `categoriesRequired`, `onTrack` to streak response object
  - `src/routes/habits.js` — imported and called `evaluateStreakIfNeeded` on habits GET to ensure streak is current even if dashboard isn't visited first
- **Learnings:**
  - Lazy streak evaluation (on first request of the day) avoids the need for a cron job — `streak_last_evaluated_date` tracks the last evaluation date; any gap days between last eval and yesterday are iterated and evaluated individually
  - Date arithmetic on YYYY-MM-DD strings done via `new Date(y, m-1, d)` constructor + `setDate()` — avoids timezone issues inherent in `new Date("YYYY-MM-DD")` which parses as UTC
  - Category completion criteria: steps >= goal, hydration >= goal, sleep >= 7h, movement_done = 1, any food checkbox checked — goals fetched from `habits_config` with sensible defaults (10k steps, 8 glasses)
  - Shield consumption preserves streak but doesn't increment — distinct from streak increment on successful day
  - `evaluateStreakIfNeeded` must be called before reading `current_streak`/`longest_streak` from the user row to ensure values are up to date
  - First-time evaluation (no `streak_last_evaluated_date`) just sets the date without changing streak — prevents penalizing new users for days before they started
---

## 2026-02-22 - US-021
- **What was implemented:** Streak shield mechanism — shield earning on every 7-day streak, max 1 shield in reserve, auto-activation on missed day (already in US-020), shield visibility on dashboard
- **Files changed:**
  - `src/utils/streak.js` — added `SHIELD_STREAK_INTERVAL = 7` and `MAX_SHIELDS = 1` constants; added shield-earning logic inside the streak increment branch of `evaluateStreakIfNeeded()` (awards 1 shield when `currentStreak % 7 === 0` and shields < max)
  - `src/routes/dashboard.js` — added `streak_shields` to user SELECT query; added `shields` field to the `streak` object in the dashboard JSON response
- **Learnings:**
  - Shield consumption (auto-activate on missed day) and `streak_shields` column were already implemented in US-020 — US-021 only needed the earning logic and dashboard visibility
  - Shield earning placed inside the `completed >= STREAK_THRESHOLD` branch ensures shields are only awarded on successful days, not on shield-preserved days
  - Users endpoints (`/me`, `/me/stats`, `/me/streaks`) already included `streak_shields` from US-040 — only the dashboard was missing it
  - `MAX_SHIELDS = 1` constant makes it trivial to adjust the cap later if the game design changes
---
