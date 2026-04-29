# Changelog

All notable changes to the SokaSoko backend (API) are documented here.

---

## [Unreleased] – since 2026-04-24

### Added

#### Scout Module
- **`src/ScoutCv/scout_cv.model.js`** — New Mongoose model for a scout's scouted-player history.
  - Fields: `scout` (ref User), `playerRef` (ref User, optional), `playerName` (required string), `yearIdentified`, `academyAtIdentification` (ref User, optional), `academyAtIdentificationName` (string fallback), `currentClub` (ref User, optional), `currentClubName` (string fallback), `verificationStatus` (enum: UNVERIFIED | PENDING | VERIFIED | DECLINED).
- **`src/ScoutCv/scout_cv.http.router.js`** — REST routes for the Scout CV feature:
  - `GET  /v1/scout-cv/pending/:playerId` — fetch entries awaiting verification for a player.
  - `GET  /v1/scout-cv/:scoutId` — all CV entries for a scout (populated with academy / club / player names).
  - `POST /v1/scout-cv` — create entry; sets status PENDING if a linked player account is supplied, UNVERIFIED otherwise.
  - `PATCH /v1/scout-cv/:id` — edit entry; re-triggers PENDING if playerRef changes.
  - `DELETE /v1/scout-cv/:id` — remove entry.
  - `POST /v1/scout-cv/:id/respond` — player responds: `verify` → status VERIFIED; `decline` → entry auto-deleted.
- Registered `ScoutCvRouter` in **`src/server.js`**.

#### User Model & Search
- **`src/User/user.model.js`** — Added `talent_id_training` field (`String`, enum: YES/NO) for SCOUT accounts. SCOUT was already present in the `types` enum.
- **`src/User/user.http.router.js`** — Updated `PATH_SEARCH` (`GET /v1/users/search`):
  - Added optional `type` query param so callers can filter results by user type (e.g. `?type=PLAYER`).
  - Added `entity_name` to the `$or` search fields.
  - Reads text from both `mquery.filter.text` and the raw `request.query.filter.text` for compatibility.

#### Other ongoing features (pre-existing, now committed)
- Match scheduling, results, confirmation, and decline flows (`src/Match/`).
- Tournament management (`src/Tournament/`).
- Venue import and management (`src/Venue/`).
- Subscription handling (`src/Subscription/`).
- Reservation system (`src/Reservation/`).
- Profile views tracking (`src/User/profile_view.model.js`, `src/User/profile_view.router.js`).
- Academy player links (`src/User/academy_links.router.js`).
- Scheduler for background jobs (`src/scheduler.js`).

### Fixed
- **`src/ScoutCv/scout_cv.http.router.js`** — populate for `academyAtIdentification` and `currentClub` now selects `academy_name`, `entity_name`, `company_name`, `firstName`, `lastName` so entities that store their name in different fields display correctly.
- **`src/User/user.http.router.js`** — removed `type` from the `$or` full-text search array (prevented false matches on the word "player", "scout" etc.).

---

## Notes on deployment
- Runs on Node.js with `--openssl-legacy-provider` not required on the backend (only on the CMS).
- Push to `heroku` remote deploys to `sokasoka-api.herokuapp.com`.
