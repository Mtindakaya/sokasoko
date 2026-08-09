# PLAYER Subscription — Status Sheet

_Locked plan and implementation snapshot as of 2026-08-09._

---

## 1. The plan (locked)

### Eligibility
- **Subject to subscription:** PLAYER, COACH, ACADEMY, CLUB, AGENT, REFEREE, SCOUT, VENDOR, FIELD_OWNER
- **Excluded (permanently free):** GUARDIAN, SPONSOR, SCHOOL

### PLAYER pricing (TSh)

| Tier     | Monthly | Quarterly (3mo) | Bi-annual (6mo) |
|----------|--------:|----------------:|----------------:|
| Standard |       0 |               0 |               0 |
| Gold     |   5,000 |          10,000 |          20,000 |
| Platinum |  10,000 |          25,000 |          40,000 |

### PLAYER feature caps

| Feature | Standard | Gold | Platinum |
|---|---|---|---|
| Account visible / can be viewed | ✓ | ✓ | ✓ |
| DM chat: post + engage | ✓ | ✓ | ✓ |
| AI (Ismaili) queries / month | 0 | 100 | Unlimited (fair-use 30/hr, 300/day) |
| Reports received / month (view own) | 1 | 5 | Unlimited |
| Evaluations received / month | 1 (report withheld) | 10 (shared) | Unlimited (shared) |
| Evaluation requests initiated / month | 0 | 2 | Unlimited |
| Challenges — can compete | ✗ | ✓ | ✓ |

**Standard quirks:** can BE evaluated (1/mo) but the report body is withheld — upgrade pressure. Cannot request scouts. Zero AI. Cannot compete in challenges.

**Platinum "unlimited":** advertised as unlimited; enforced with soft caps of 30/hr + 300/day at the endpoint to protect API cost. Estimated worst-case monthly AI spend per Platinum user ≈ TSh 4,500 (well inside the TSh 10k revenue).

### Lapse behaviour (locked)
- On `endDate`: subscription flips **ACTIVE → GRACE** (5-day grace period).
- On `gracePeriodEndsAt`: **GRACE → EXPIRED**, effective tier drops back to Standard.
- No user-facing service loss during grace; bell notifications sent at both transitions.

---

## 2. Backend — what's implemented

### Data models

**`src/Subscription/subscription.model.js`** (rewritten)
- Fields: `user`, `userType`, `tier`, `plan`, `currency`, `amount`, `paymentMethod`, `status`, `startDate`, `endDate`, `gracePeriodEndsAt`, `activatedBy`, `activatedAt`, `notes`, `transactionId`, `promoSlotsUsed/Total`.
- Enums:
  - `tier`: `['STANDARD','GOLD','PLATINUM','ENTERPRISE']`
  - `plan`: `['MONTHLY','QUARTERLY','BIANNUAL','ANNUAL']`
  - `status`: `['ACTIVE','GRACE','EXPIRED','PENDING','CANCELLED']`
  - `userType`: all 9 subscription-eligible types
- Statics:
  - `getEffectiveTier(userId, userType)` → `'STANDARD' | 'GOLD' | 'PLATINUM' | 'FREE'`
  - `getActiveSubscription(userId)` returns highest-tier live (ACTIVE or GRACE) sub
  - `isUserSubscribed(userId)` boolean
  - `getFeatureCaps(userType, tier)` returns the caps dict
- Instance: `activate()` sets dates for MONTHLY / QUARTERLY (3mo) / BIANNUAL (6mo) / ANNUAL + computes `gracePeriodEndsAt = endDate + 5 days`.
- Exports: `PRICES` (nested by userType→tier→plan→currency), `FEATURE_CAPS`, `TIERS`, `PLAN_TYPES`, `SUBSCRIPTION_ELIGIBLE_TYPES`, `NON_SUBSCRIPTION_TYPES`, `GRACE_PERIOD_DAYS`.

**`src/Subscription/subscription_usage.model.js`** (new)
- One doc per `(user, period, periodKey)`. Periods: `MONTH` / `DAY` / `HOUR`.
- Counters: `ai`, `reports`, `evaluationsReceived`, `evaluationRequests`.
- TTL index on `expiresAt` so DAY/HOUR buckets auto-clean.
- `SubscriptionUsage.consume({user, userType, feature})` — atomic bump + cap check. Returns `{allowed, cap, remaining, reason, tier}`. Reasons: `TIER_DISALLOWED`, `MONTHLY_CAP`, `HOURLY_FAIR_USE`, `DAILY_FAIR_USE`.
- `SubscriptionUsage.snapshot(userId, userType)` — current-month usage per feature.

### HTTP endpoints (`src/Subscription/subscription.http.router.js`)

| Method | Path | Purpose |
|---|---|---|
| GET  | `/v1/subscriptions/catalog` | Public plan + feature matrix |
| GET  | `/v1/subscriptions/prices`  | Legacy price table alias |
| GET  | `/v1/subscriptions/me?userId=&userType=` | Effective tier + usage snapshot |
| GET  | `/v1/subscriptions` | Admin list (filter by status/tier/userType) |
| GET  | `/v1/subscriptions/user/:userId` | Active sub for a user |
| POST | `/v1/subscriptions` | Create sub (STANDARD auto-activates; paid tiers → PENDING) |
| POST | `/v1/subscriptions/:id/activate` | Admin manual activation |
| POST | `/v1/subscriptions/:id/cancel`   | Admin cancel |
| POST | `/v1/subscriptions/lapse-sweep`  | Cron/admin trigger for grace/expire sweep |
| GET  | `/v1/subscriptions/:id` | Single record |

### Enforcement wired in

- **Ismaili AI** — `POST /v1/ai/ismaili`
  - Consumes `ai` before answering.
  - Bilingual 429 messages for STANDARD block (`TIER_DISALLOWED`), GOLD monthly cap (`MONTHLY_CAP`), PLATINUM fair-use (`HOURLY_FAIR_USE` / `DAILY_FAIR_USE`).
  - Legacy 30/hr + 200/day blanket cap still runs as a safety net for user types without `FEATURE_CAPS` defined yet.

- **Scout reports view** — `GET /v1/scout-reports` (when `userType=PLAYER`)
  - Filters current-month reports to `caps.reportsPerMonth`.
  - STANDARD tier redacts report body (keeps envelope + `locked: true`, `lockReason: 'TIER_HIDES_CONTENT'`).
  - Overflow items are returned with `lockReason: 'MONTHLY_CAP'` so the client can render an upgrade prompt in place.
  - Response now includes `tier` and `capThisMonth`.

- **Scout reports create** — `POST /v1/scout-reports`
  - Consumes `evaluationsReceived` on the target PLAYER.
  - 429 with the player's tier + cap when full.

- **Match request-scout** — `POST /v1/matches/:id/request-scout`
  - PLAYER-initiated requests consume `evaluationRequests`.
  - STANDARD blocked, GOLD capped at 2/mo, PLATINUM unlimited.
  - Team-owner (ACADEMY/CLUB) requests bypass this cap.

### Scheduler (`src/scheduler.js`)

- `runSubscriptionLapseSweep` (cron: every 6 hours)
  - `ACTIVE → GRACE` when `endDate <= now`
  - `GRACE → EXPIRED` when `gracePeriodEndsAt <= now`
  - Creates `SUBSCRIPTION` bell notifications on both transitions.

---

## 3. Not yet addressed

### Backend
- **Challenges enforcement** — spec says STANDARD blocked, GOLD/PLATINUM allowed. No `src/Challenge` module exists in the repo yet, so nothing is gated.
- **Non-PLAYER tier catalogs** — COACH, ACADEMY, CLUB, AGENT, REFEREE, SCOUT, VENDOR, FIELD_OWNER only have a free STANDARD floor. Their `FEATURE_CAPS` entries are missing. Ismaili safety-net still applies for them.
- **Payment integration** — M-Pesa / Selcom / Azampay / Play Billing not wired. Paid subs are created as `PENDING` and require admin `/activate`.
- **User-initiated upgrade endpoint** — the mobile app has no "click here to subscribe" server flow. Today it goes: create sub (POST `/v1/subscriptions`) → wait for admin to activate. When payments land, this becomes: create sub → payment webhook → auto-activate.
- **Renewal reminders in-app** — bell notifications fire on transition into GRACE and EXPIRED, but there's no mid-grace reminder cadence (e.g. day 3 nudge). SMS reminders also not wired for subscription lapse.
- **Migration script** — none written. Existing rows are test data per user confirmation on 2026-08-09; if that ever changes, a backfill for `tier = 'STANDARD'` on legacy rows is needed.
- **Analytics / usage reporting** — `SubscriptionUsage` collects counters but there's no admin dashboard querying them (revenue by tier, top-N AI users, conversion rate STANDARD→GOLD, etc.).

### Mobile app (Flutter)
- **Tier selector UI** — no screen for the user to view catalog + choose a tier.
- **Upgrade prompts** — no client rendering of the `locked` / `lockReason` markers on reports; no in-line "Upgrade to Gold" CTAs on Ismaili refusal; no interception of the `evaluationRequests` 429.
- **Usage snapshot** — `GET /v1/subscriptions/me` is available but no profile-tab surface shows "72 / 100 AI queries used this month".
- **Grace-period banner** — no in-app banner when the user is in GRACE.
- **Standard evaluation notice** — the "your report exists but you can't see it" upgrade nudge for STANDARD players needs UI.

### Product / ops
- **Pricing for other user types** — pending.
- **Enterprise tier** — schema supports it but no pricing / feature caps defined; treat as bespoke deal until product decides.
- **Refund / prorated downgrade policy** — undefined. Current cancel only sets status to `CANCELLED` and takes no financial action.
- **Store listing + Play Console** — Data Safety currently declares no subscription purchases. If Play Billing is chosen, Data Safety + IAP declarations need updating before any paid release.

---

## 4. Quick reference — files touched

```
src/Subscription/subscription.model.js         [rewritten]
src/Subscription/subscription_usage.model.js   [new]
src/Subscription/subscription.http.router.js   [expanded]
src/Ismaili/ismaili.http.router.js             [enforcement wired]
src/ScoutReport/scout_report.http.router.js    [list-filter + create cap]
src/Match/match.http.router.js                 [request-scout cap]
src/scheduler.js                               [lapse sweep every 6h]
```
