# Product Requirements Document
## LifePush — Daily Health Habit Tracker

**Version:** 1.0
**Date:** 2026-02-22
**Status:** Draft
**Author:** Product Team

---

## 1. Product Vision

LifePush is a web-first habit tracking application that nudges non-gym users and busy professionals into building sustainable daily health routines through minimum-effort habit completion, gamified progress (XP, streaks, mascots), and team accountability challenges. The product meets users where they are — no gym, no equipment, no excuses.

---

## 2. Problem Statement

Over 80% of adults fail to meet basic daily physical activity guidelines, not because they lack motivation, but because traditional fitness apps target gym-goers and assume time/resources most people don't have. Busy professionals skip health entirely because the bar feels too high.

**Core pain points:**
- No lightweight, non-intimidating entry point for basic daily health
- No accountability layer that doesn't require a gym buddy
- Existing apps don't personalize to body type (BMI) or realistic lifestyle
- No fun/reward mechanism to maintain habits beyond week one

---

## 3. Target Audience

### Primary Users
- **Non-gym goers** aged 25–45 who want to start small
- **Busy professionals** with 15–30 minutes max per day for health activities
- **Sedentary office workers** who sit 6+ hours daily

### Secondary Users
- HR teams / employers building wellness programs
- Friends groups running informal health challenges

---

## 4. Goals and Objectives

| Goal | Objective | Timeline |
|------|-----------|----------|
| User Activation | 70% of registered users complete onboarding + first daily checklist | Week 1 |
| Retention | 40% Day-30 retention rate | Month 1 |
| Engagement | Average 5 sessions/week per active user | Month 2 |
| Revenue | 10,000 DAU to support ad revenue baseline | Month 3 |
| Team Feature | 25% of users join or create a team within 30 days of signup | Month 2 |

---

## 5. Success Metrics (KPIs)

**Acquisition**
- Weekly new registrations
- Onboarding completion rate (target: >75%)

**Engagement**
- Daily Active Users (DAU) / Monthly Active Users (MAU)
- Daily checklist completion rate (target: >60% of active users)
- Average streak length (target: >7 days)
- Team challenge participation rate

**Retention**
- Day 1, Day 7, Day 30 retention
- Churn rate by cohort

**Revenue**
- Ad impressions per session
- eCPM (effective cost per thousand impressions)
- Ad click-through rate

**Health Impact**
- Average steps logged per user per week
- Average hydration logged vs. target
- BMI check-in update rate (monthly prompt)

---

## 6. User Personas

### Persona 1 — "Desk-Bound Daniel"
- Age: 32, Software Engineer
- Works 9–10 hours/day at a desk
- Never goes to the gym, feels guilty about it
- Goals: lose weight gradually, stop feeling sluggish
- Tech: Chrome on laptop, occasionally checks phone
- Pain: starts apps, abandons them in 2 weeks

### Persona 2 — "Overloaded Olivia"
- Age: 38, Marketing Manager, 2 kids
- Has 20 minutes in the morning max
- Wants accountability but no pressure
- Goals: build energy, sleep better, eat less junk
- Pain: everything feels like "too much" commitment

### Persona 3 — "Team Leader Trevor"
- Age: 45, Department Head
- Wants to start a team wellness initiative at work
- Values friendly competition and group accountability
- Goals: get his team moving, lead by example

---

## 7. User Onboarding Flow

```
[Landing Page]
    → Sign Up (Email + Password)
    → Email Verification
    → Onboarding Step 1: Name + Age + Gender
    → Onboarding Step 2: Height + Weight input
        → BMI calculated automatically
        → BMI category displayed with explanation
        → Mascot assigned based on BMI
    → Onboarding Step 3: Goal selection
        (system pre-fills based on BMI, user cannot skip)
        → Daily step goal (pre-set: 5,000 or 10,000)
        → Movement preference (chair exercises / walking / jumping jacks)
        → Hydration target (auto-calculated: weight × 0.033 liters)
        → Sleep goal (default: 7–8 hours)
        → Food habit goal (e.g., eat 2 vegetables per day)
    → Onboarding Step 4: Team prompt
        → Create a team OR join via invite code OR skip (reminded in 48h)
    → Dashboard (Home)
```

**Rule:** Onboarding is a hard gate. Users cannot access the dashboard without completing all steps including BMI entry.

---

## 8. BMI Classification Logic

| BMI Range | Category | Label Shown to User |
|-----------|----------|---------------------|
| < 18.5 | Underweight | "Let's build strength" |
| 18.5 – 24.9 | Normal | "Great foundation" |
| 25.0 – 29.9 | Overweight | "Let's get moving" |
| 30.0 – 34.9 | Obese Class I | "Every step counts" |
| ≥ 35.0 | Obese Class II+ | "Your journey starts now" |

**Formula:** `BMI = weight(kg) / height(m)²`

BMI is recalculated on manual update only (prompted monthly via notification).

---

## 9. Mascot Allocation Logic

Mascots are assigned at onboarding based on BMI category and evolve as users level up.

| BMI Category | Starter Mascot | Level 5 Evolution | Level 10 Evolution |
|---|---|---|---|
| Underweight | Baby Flamingo | Flamingo | Dancing Flamingo |
| Normal | Energetic Fox | Swift Fox | Blazing Fox |
| Overweight | Chunky Bear | Active Bear | Power Bear |
| Obese Class I | Sleepy Panda | Walking Panda | Champion Panda |
| Obese Class II+ | Cozy Sloth | Motivated Sloth | Racing Sloth |

**Mascot behavior:**
- Mascot reacts to streak status (happy = streak active, sad = streak broken)
- Mascot visible on dashboard home screen prominently
- Mascot animates on checklist completion (CSS animation)
- Mascot name is user-customizable

---

## 10. Habit Categories and Checklist Design

Each habit category has one primary daily task and optional bonus tasks.

### Category 1: Steps
| Task | XP | Notes |
|------|-----|-------|
| Reach 5,000 steps | 20 XP | Auto-synced or manual |
| Reach 10,000 steps | 40 XP | Replaces 5k goal for Normal/Underweight BMI |
| Bonus: 500 steps every 2 hours | +5 XP | Manual log |

### Category 2: Movement
| Task | XP | Notes |
|------|-----|-------|
| Complete daily movement (3 exercises) | 15 XP | Preset routine based on BMI |
| Movement options: jumping jacks (20), chair squats (15), shoulder rolls (10), calf raises (20) | — | User picks 3 |

### Category 3: Hydration
| Task | XP | Notes |
|------|-----|-------|
| Log each glass of water | 5 XP | Tap to log |
| Hit daily water target | 20 XP | Auto-calculated at onboarding |

### Category 4: Sleep
| Task | XP | Notes |
|------|-----|-------|
| Log sleep start time | 5 XP | Manual entry |
| Log wake-up time | 5 XP | Manual entry |
| Hit 7+ hours sleep | 15 XP | Calculated from log |

### Category 5: Food Habits
| Task | XP | Notes |
|------|-----|-------|
| Log 2 servings of vegetables | 10 XP | Simple yes/no checklist |
| Skip junk food today | 10 XP | Honor system checkbox |
| Eat breakfast | 5 XP | Honor system checkbox |

**Daily max XP possible: ~150 XP**

---

## 11. XP, Streak, and Reward System

### XP System
- XP accumulates to determine user level
- Level thresholds: Level 1 = 0 XP, Level 2 = 500 XP, Level 3 = 1200 XP (each level requires ~20% more XP)
- Level-ups trigger mascot evolution at Level 5 and Level 10

### Streak System
- A streak is maintained if the user completes ≥ 3 of 5 habit categories each day
- Streak counter resets at midnight (user's local timezone)
- **Streak Shield:** Users earn 1 shield per 7-day streak. Shield auto-activates on first missed day to preserve streak (max 1 shield in reserve)

### Rewards
| Milestone | Reward |
|-----------|--------|
| 7-day streak | Mascot accessory (hat) unlocked |
| 30-day streak | Mascot background theme unlocked |
| Level 5 | Mascot evolution + badge |
| Level 10 | Mascot evolution + "Champion" profile badge |
| First team challenge won | Team trophy displayed on profile |

---

## 12. Team / Group Challenge System

### Team Creation
- User creates a team with a name and optional description
- System generates a 6-character invite code
- Team size: minimum 2, maximum 20 members
- Team creator is admin

### Challenge Types (MVP)
| Challenge | Duration | Win Condition |
|-----------|----------|---------------|
| Most Steps This Week | 7 days | Highest total steps |
| Hydration Champion | 7 days | Most water goals hit |
| Perfect Week | 7 days | Most days with all 5 habits complete |
| Longest Streak | 30 days | Highest current streak at end |

### Team Dashboard
- Leaderboard showing all members ranked by challenge metric
- Real-time updates (polling every 5 minutes)
- Admin can start new challenges, remove members
- Push notification when a teammate overtakes your rank

---

## 13. Functional Requirements

### Authentication
- FR-01: User can register with email + password (min 8 chars, 1 uppercase, 1 number)
- FR-02: Email verification required before accessing app
- FR-03: Password reset via email link (expires in 1 hour)
- FR-04: Session token expires after 30 days of inactivity

### Onboarding
- FR-05: BMI form is mandatory; height in cm, weight in kg (no unit switching in MVP)
- FR-06: System calculates BMI and assigns mascot automatically
- FR-07: User cannot navigate to dashboard until all onboarding steps complete
- FR-08: Onboarding progress is saved per step (resumable if browser closes)

### Daily Checklist
- FR-09: Checklist resets daily at midnight (user's local timezone)
- FR-10: Each habit item shows current progress vs. target
- FR-11: Completed items are visually marked and XP is awarded immediately
- FR-12: Steps can be synced from Google Fit API (web) or entered manually
- FR-13: Manual entries cannot exceed physically plausible limits (steps: max 50,000/day)

### Gamification
- FR-14: XP is awarded per task immediately upon completion
- FR-15: Streak counter increments at end of day if ≥ 3 categories completed
- FR-16: Streak Shield activates automatically on first missed day if available
- FR-17: Mascot evolves at Level 5 and Level 10 with animation
- FR-18: Badges are displayed on user profile page

### Team Features
- FR-19: User can create a team and receive a unique invite code
- FR-20: User can join a team via invite code
- FR-21: Team admin can initiate a challenge from preset list
- FR-22: Challenge leaderboard updates every 5 minutes
- FR-23: User can be member of maximum 3 teams simultaneously
- FR-24: Notifications sent when user is overtaken in an active challenge

### Notifications
- FR-25: Daily reminder notification at user-defined time (default 8:00 AM)
- FR-26: Streak at-risk alert if < 3 habits done by 8:00 PM
- FR-27: Monthly BMI update reminder
- FR-28: Team challenge start/end notification
- FR-29: User can configure or disable all notification types

### Ads
- FR-30: Ad banner displayed on dashboard (bottom of page, non-intrusive)
- FR-31: Interstitial ad shown once per session (on app open, skippable after 5 seconds)
- FR-32: No ads shown during active habit logging (UX protection)
- FR-33: Ad network: Google AdSense (web MVP)

---

## 14. Non-Functional Requirements

| Category | Requirement |
|----------|-------------|
| Performance | Page load < 2.5 seconds on 4G connection |
| Uptime | 99.5% monthly uptime SLA |
| Scalability | Architecture supports 100K concurrent users without re-design |
| Security | Passwords hashed with bcrypt (cost factor 12); HTTPS enforced |
| Data Privacy | GDPR-compliant: explicit consent, data export, account deletion |
| Browser Support | Chrome 100+, Firefox 100+, Safari 15+, Edge 100+ |
| Responsive Design | Fully functional on mobile browser (375px min width) |
| Accessibility | WCAG 2.1 AA compliance for core flows |
| Localization | English only in MVP; i18n-ready architecture |

---

## 15. Database Schema

### `users`
```sql
id              UUID PRIMARY KEY
email           VARCHAR(255) UNIQUE NOT NULL
password_hash   VARCHAR(255) NOT NULL
name            VARCHAR(100)
age             INTEGER
gender          ENUM('male', 'female', 'other')
height_cm       DECIMAL(5,1)
weight_kg       DECIMAL(5,1)
bmi             DECIMAL(4,1)
bmi_category    ENUM('underweight', 'normal', 'overweight', 'obese_1', 'obese_2')
mascot_id       INTEGER FK → mascots
mascot_name     VARCHAR(50)
xp_total        INTEGER DEFAULT 0
level           INTEGER DEFAULT 1
current_streak  INTEGER DEFAULT 0
longest_streak  INTEGER DEFAULT 0
streak_shields  INTEGER DEFAULT 0
timezone        VARCHAR(50)
created_at      TIMESTAMP
last_active_at  TIMESTAMP
email_verified  BOOLEAN DEFAULT FALSE
```

### `daily_logs`
```sql
id              UUID PRIMARY KEY
user_id         UUID FK → users
log_date        DATE NOT NULL
steps_count     INTEGER
water_glasses   INTEGER
sleep_start     TIME
sleep_end       TIME
sleep_hours     DECIMAL(3,1)
veg_servings    INTEGER
junk_skipped    BOOLEAN
breakfast_eaten BOOLEAN
movement_done   BOOLEAN
xp_earned       INTEGER
categories_done INTEGER  -- count of 5 categories completed
streak_counted  BOOLEAN DEFAULT FALSE
created_at      TIMESTAMP
UNIQUE (user_id, log_date)
```

### `habits_config`
```sql
id              UUID PRIMARY KEY
user_id         UUID FK → users
step_goal       INTEGER DEFAULT 5000
water_goal_ml   INTEGER
sleep_goal_hrs  DECIMAL(3,1) DEFAULT 7.5
movement_set    JSON  -- array of chosen exercises
updated_at      TIMESTAMP
```

### `mascots`
```sql
id              INTEGER PRIMARY KEY
name            VARCHAR(50)
bmi_category    ENUM
level_required  INTEGER
asset_url       VARCHAR(255)
```

### `teams`
```sql
id              UUID PRIMARY KEY
name            VARCHAR(100)
invite_code     CHAR(6) UNIQUE
admin_user_id   UUID FK → users
created_at      TIMESTAMP
```

### `team_members`
```sql
team_id         UUID FK → teams
user_id         UUID FK → users
joined_at       TIMESTAMP
PRIMARY KEY (team_id, user_id)
```

### `team_challenges`
```sql
id              UUID PRIMARY KEY
team_id         UUID FK → teams
type            ENUM('steps', 'hydration', 'perfect_week', 'streak')
start_date      DATE
end_date        DATE
status          ENUM('active', 'completed', 'cancelled')
winner_user_id  UUID FK → users (nullable)
created_at      TIMESTAMP
```

### `challenge_entries`
```sql
id              UUID PRIMARY KEY
challenge_id    UUID FK → team_challenges
user_id         UUID FK → users
metric_value    DECIMAL(10,2)
updated_at      TIMESTAMP
UNIQUE (challenge_id, user_id)
```

### `notifications_config`
```sql
user_id             UUID FK → users PRIMARY KEY
daily_reminder_time TIME DEFAULT '08:00'
streak_alert        BOOLEAN DEFAULT TRUE
bmi_reminder        BOOLEAN DEFAULT TRUE
team_updates        BOOLEAN DEFAULT TRUE
```

---

## 16. Daily Reset Logic

A scheduled job runs daily at **00:01 AM UTC**, processes each user by timezone:

```
FOR each user WHERE current time = midnight in user.timezone:
  1. Evaluate yesterday's daily_log:
     - IF categories_done >= 3:
         increment current_streak
         UPDATE longest_streak if current > longest
         SET streak_counted = TRUE
         Award streak_shield IF current_streak % 7 == 0 AND shields < 2
     - ELSE IF categories_done < 3:
         IF streak_shields > 0:
           decrement streak_shields by 1
           preserve current_streak (shield activated)
         ELSE:
           reset current_streak to 0

  2. Create new empty daily_log for today

  3. Send streak-at-risk notification at 8:00 PM
     if today's categories_done < 3 by 8 PM local time
```

---

## 17. Notification Strategy

| Notification | Trigger | Channel | Time |
|---|---|---|---|
| Daily reminder | Every day | Web push / email | User-configured (default 8 AM) |
| Streak at risk | < 3 habits done by 8 PM | Web push | 8:00 PM local |
| Streak achieved | End of day streak counted | In-app | On next open |
| Level up | XP threshold crossed | In-app animation | Immediate |
| Team challenge started | Admin starts challenge | Web push + in-app | Immediate |
| Leaderboard overtaken | Rank changes in challenge | Web push | Within 5 min |
| BMI update reminder | Monthly (day of sign-up) | Email | 9 AM local |
| Password reset | User-triggered | Email | Immediate |

---

## 18. Edge Cases

| Scenario | Handling |
|----------|---------|
| User logs 0 steps but has a shield | Shield activates, streak preserved, shield count -1 |
| User completes all habits at 11:59 PM | Log saved, streak evaluated at next reset cycle |
| Steps synced from Google Fit exceed manual entry | Use higher value; log both sources |
| User changes timezone | Applies from next day; no retroactive log changes |
| Team admin leaves team | Oldest member is promoted to admin automatically |
| Challenge ends with a tie | Both users marked as co-winners; both receive badge |
| User attempts to update BMI to implausible value | Reject if BMI result would be < 10 or > 60 |
| User loses internet mid-checklist | Local state cached in localStorage; syncs on reconnect |
| Duplicate habit log submission | Idempotent API: second submission returns 200 with existing record |
| Ad blocker active | Ads silently suppressed; no app functionality blocked |

---

## 19. Assumptions

- Users have access to modern web browsers (Chrome/Firefox/Safari)
- Step data from Google Fit is available via OAuth for users on Android Chrome
- iPhone users will primarily use manual step entry (Apple Health web API not available)
- Users are honest with honor-system food habit checkboxes
- The mascot system provides sufficient motivation without requiring social sharing
- GDPR applies as user base will include European users

---

## 20. Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Low Day-7 retention due to habit difficulty | High | High | Ensure goals are genuinely low-bar; celebrate small wins |
| Google Fit API access revoked/deprecated | Medium | Medium | Manual entry as fallback; abstract data layer |
| Ad revenue insufficient at early scale | High | Medium | Supplement with optional premium tier in V2 |
| BMI stigma causing user drop-off at onboarding | Medium | High | Use neutral, motivational language; never show "obese" label to user |
| Team feature complexity delays MVP | Medium | Medium | Reduce team size cap; launch challenges as V1.5 if needed |
| GDPR non-compliance in EU markets | Low | High | Legal review before EU launch; data processing agreement |
| Mascot asset production time | Medium | Low | Commission artist early; use placeholder SVGs in beta |

---

## 21. Out of Scope (MVP)

- Native iOS / Android apps
- Apple Health integration
- Social media sharing
- Paid/premium subscription tier
- Calorie counting or macro tracking
- Workout video library
- AI-generated workout plans
- Wearable device integrations (Fitbit, Garmin)
- Coach or personal trainer marketplace
- Community forum or chat
- Corporate wellness dashboard (B2B)
- Multiple language support

---

## 22. MVP Scope

The MVP delivers a fully functional web application with:

1. **Auth:** Email/password registration + verification
2. **Onboarding:** BMI collection → mascot assignment → habit goal setup
3. **Dashboard:** Daily checklist across all 5 categories
4. **Gamification:** XP system, level tracking, streaks, streak shields, mascot evolution
5. **Teams:** Create/join teams, 4 challenge types, leaderboard
6. **Notifications:** Web push + email for key triggers
7. **Ads:** Google AdSense banner + session interstitial
8. **Profile:** Level, badges, mascot display, streak history

---

## 23. Version 2 Roadmap

| Feature | Priority | Notes |
|---------|----------|-------|
| Native iOS + Android apps | P0 | React Native preferred for code reuse |
| Apple Health integration | P0 | Unlocks iPhone step auto-sync |
| Premium subscription (ad-free) | P1 | Freemium conversion layer |
| Friend leaderboard (non-team) | P1 | Public or friends-only option |
| Habit library (user-customizable) | P1 | Beyond the 5 core categories |
| Progress charts and history | P2 | Weekly/monthly trend graphs |
| AI habit suggestions based on streak data | P2 | ML-based nudges |
| Corporate wellness portal | P3 | B2B channel |
| Multi-language support | P3 | i18n groundwork in MVP |

---

## 24. Monetization Strategy

**MVP: Ad-Supported (Free)**
- Google AdSense banner: persistent on dashboard bottom
- Interstitial ad: once per session on load (skippable at 5 seconds)
- No ads during habit logging to preserve UX

**Revenue Projections (illustrative)**
- Target: 10,000 DAU × 4 sessions/day × $2 eCPM = ~$80/day (~$2,400/month)
- Growth target: 50,000 DAU by Month 6

**V2 Addition: Freemium**
- $4.99/month or $39.99/year removes all ads
- Premium unlocks: extended streak history, mascot accessories, custom challenge types

---

## 25. Analytics Tracking Plan

### Events to Track

| Event Name | Properties | Trigger |
|---|---|---|
| `user_registered` | source, platform | Successful registration |
| `onboarding_completed` | bmi_category, mascot_assigned | Final onboarding step |
| `onboarding_dropped` | last_step_completed | Session end before completion |
| `habit_logged` | category, value, method (auto/manual) | Checklist item completed |
| `daily_checklist_completed` | categories_count, xp_earned | All 5 done |
| `streak_updated` | new_streak, shield_used | End-of-day job |
| `streak_broken` | streak_length_lost | Streak resets to 0 |
| `level_up` | new_level, mascot_evolved | XP threshold crossed |
| `team_created` | team_id | Team creation |
| `team_joined` | team_id, via_invite | Join event |
| `challenge_started` | challenge_type, team_id | Admin starts challenge |
| `challenge_completed` | winner_user_id, challenge_type | End date reached |
| `ad_impression` | ad_type (banner/interstitial) | Ad renders |
| `ad_clicked` | ad_type | Ad click |
| `notification_sent` | type | Notification dispatched |
| `notification_opened` | type | User opens via notification |

### Dashboards to Build
1. **Retention Dashboard:** D1/D7/D30 cohort retention
2. **Habit Completion Funnel:** % users completing each category
3. **Gamification Health:** Average XP/day, streak distribution, shield usage
4. **Team Engagement:** Teams created, challenge participation rate
5. **Ad Revenue:** Daily impressions, clicks, eCPM trend

---

## 26. API Considerations

### Internal API Endpoints (REST)

```
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/logout
POST   /api/auth/verify-email
POST   /api/auth/reset-password

GET    /api/users/me
PATCH  /api/users/me
PATCH  /api/users/me/bmi

GET    /api/habits/today
PATCH  /api/habits/today/:category

GET    /api/teams
POST   /api/teams
POST   /api/teams/join
GET    /api/teams/:id/leaderboard
POST   /api/teams/:id/challenges
GET    /api/teams/:id/challenges/:challengeId

GET    /api/users/me/stats
GET    /api/users/me/streaks
```

### External Integrations
- **Google Fit REST API:** OAuth 2.0 for step data (Android Chrome)
- **Google AdSense:** Script embed for ad delivery
- **SendGrid / Mailgun:** Transactional email delivery
- **Web Push API (browser-native):** Push notification delivery

---

*End of PRD — LifePush v1.0*