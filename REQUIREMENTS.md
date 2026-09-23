# SokaSoko Platform — Product Requirements Document

**Version:** 3.1  
**Last Updated:** 2026-09-23  
**Platform:** Mobile (Flutter/Android) + Admin CMS (React) + Backend API (Node.js/Express/MongoDB) — iOS via TestFlight (Path A, in progress)

---

## 1. VISION & PURPOSE

SokaSoko is a football management and discovery ecosystem purpose-built for East Africa (Tanzania, Kenya, Uganda, Rwanda). It connects every stakeholder in the football ecosystem — players, scouts, coaches, academies, schools, agents, referees, sponsors, and vendors — on a single platform.

**Core Purpose:** Eliminate the fragmentation in grassroots and semi-professional football by providing digital tools for match management, player discovery, scouting, reporting, and communication.

---

## 2. USER TYPES

| Type | Description | Key Role |
|------|-------------|----------|
| **PLAYER** | Individual footballer | Builds profile, registers for trials, gets scouted, accesses AI coaching |
| **ACADEMY / CLUB** | Football academy or club | Manages teams, schedules matches, posts trials, registers for tournaments |
| **SCHOOL** | Educational institution with football programme | Manages school team, schedules matches, registers players |
| **COACH** | Licensed or unlicensed coach | Manages teams, posts trials, enters match results, AI advisor |
| **SCOUT** | Professional or freelance scout | Evaluates players, builds Scout CV, assigned to matches/trials, Scout Hub |
| **AGENT** | Player agent | Manages represented players, requests reports, monitors player development |
| **REFEREE** | Match official | Participates in matches as referee or assistant referee |
| **GUARDIAN** | Parent/guardian of a player | Registers players under their care, monitors player activity |
| **VENDOR** | Sports equipment/services provider | Lists profile, owns paid adverts (per-tier caps), boost-your-post promo slots |
| **SPONSOR** | Individual or entity sponsor | Posts sponsorship offers, receives/reviews requests, anonymous mode |
| **FIELD_OWNER** | Owner of a football pitch/venue | Lists venue for bookings and match scheduling |
| **FOOTBALL_ASSOCIATION** | Federation / regional or district FA / TFF / MoFA / sports registrar | District Calendar auto-filter, governance staff roles, free-tier capped |

---

## 3. CORE MODULES

---

### 3.1 USER PROFILES & ACCOUNTS

#### Requirements
- Each user type has a tailored profile with type-specific fields:
  - **Player:** Position, height, weight, foot preference, DOB, nationality, academy affiliation, Free Agent status
  - **Coach:** License level, region
  - **Referee:** License level, region
  - **Academy/Club:** Name, region, TAFOCA registration number
  - **Scout:** Region, professional background
  - **School:** School name, region, class structure
- Profile image upload (camera or gallery)
- Theme color picker (16 preset colors) — tints profile card
- Account number auto-generated for each user
- Profile view tracking — users can see how many times their profile was viewed and by which type
- Public shareable profile page (PDF-friendly)
- Search and discovery: full-text search by name, filter by type, region, position, gender, age group

#### Authentication
- Email/password login
- Session stored locally on device
- Logout clears session

---

### 3.2 MATCH MANAGEMENT

#### Requirements
- **Scheduling:** Team (Academy/Club/School/Coach) schedules match by selecting home team, away team, date/time, venue (required — see below), and optionally: tournament, referee, assistant referees, scout, age level, gender
- **Venue Requirement:** Every match MUST have a venue. Two paths — either pick from the registered Venue collection, OR fill a manual entry (name + region required; district + ward optional). Enforced by a pre-save hook and the POST /matches validator
- **Confirmation:** Away team must confirm or decline the schedule with reason. Score entry blocked until schedule is confirmed
- **Reschedule:** Either team may request reschedule; away team must re-confirm
- **Match Status Flow:** SCHEDULED → CONFIRMED → ONGOING → COMPLETED / CANCELLED (matchId `TFH-M-XXXXXX` auto-issued on COMPLETED)
- **Score Access:** The team account itself PLUS its ACTIVE OrgStaffLink staff in roles OWNER / MANAGER / COACH / SECRETARY — both teams' authorized users see and act on the score
- **Result Entry:** HOME team enters score + per-player stats (goals, assists, yellow/red cards, MOTM). Enter Result screen header shows team names, not the person entering
- **Strict Home → Away → Home Workflow:**
  1. HOME saves result → both `homeConfirmed` and `awayConfirmed` reset to false
  2. AWAY confirms score (Kuthibitisha) → `awayConfirmed = true`
  3. HOME submits final (Funga Matokeo) → `homeConfirmed = true`, status flips to COMPLETED, matchId issued
  - Any HOME edit after step 2 resets `awayConfirmed` — AWAY must reconfirm before HOME can close
  - Buttons on the match card hide/show based on which step is currently valid; unauthorized users see no buttons
- **Notification Fan-out:** Every action (schedule, confirm, decline, result save, confirm, close, cancel, reschedule) fires an inbox notification with `titleKey`/`bodyKey`/`params` to every authorized user on BOTH teams (team account + all score-access staff), minus the actor. Guardian mirror hook cascades to any linked guardian
- **Organizer Override:** Tournament organizers can enter results directly without team confirmation
- **Cancel Match:** Creator can cancel with reason
- **Scout Assignment at Scheduling:** When scheduling, the team can assign a specific scout to the match
- **Official Scout Response:** Assigned scout can accept or decline the assignment
- **Temp Scout (Self-Assignment):** Any scout can self-register to observe a match. Adds to their "My Scouting Matches". Both teams receive an automatic FYI chat notification: "Scout X will be observing the match between Team A and Team B. This is for your information."
- **Scout Evaluation Gate:** Scout can only submit evaluation report after match date has passed

---

### 3.3 TRIAL MANAGEMENT (TRAINING CAMPS / TRY-OUTS)

#### Requirements
- **Create Trial:** Organizer (Academy/Coach/Scout) posts trial with title, description, start/end date, location, gender, age groups (U12/U15/U17/U19/U23), max participants per group, entry fee (optional)
- **Scout Assignment to Trial:** Organizer can assign one or more scouts to the trial; assigned scouts receive notification
- **Scout Response:** Assigned scout can accept or decline; status tracked (PENDING/ACCEPTED/DECLINED); shown on trial detail
- **Player Registration:** Players register for trial, selecting applicable age group; system enforces age eligibility based on DOB
- **Academy Registration:** Academy can register multiple players at once
- **Trial Documents:** Players upload DOB certificate and passport photo for verification
- **Organizer Review:** Organizer can approve or reject individual registrations
- **My Trials (Organizer):** Organizer sees all trials they created
- **My Trials (Scout):** Scout sees both trials they organized AND trials assigned to them ("Assigned to Scout" section)
- **My Trials (Player):** Player sees trials registered for
- **Trial Detail:** Full trial info, registration list with statuses, scout accept/decline banner for assigned scouts
- **Auto-Repair:** System detects and auto-repairs corrupt scout data on load for organizers

---

### 3.4 TOURNAMENT MANAGEMENT

#### Requirements
- **Create Tournament:** Organizer (Academy/Coach) creates tournament with name, dates, type, format
- **Team Registration:** Teams apply to join; organizer approves/rejects
- **Open Tournaments:** Public tournament format with team slots and fixture management
- **Fixture Management:** Add fixtures between registered teams, enter results per fixture
- **Player Tournament Registration:** Individual players register for tournament slots with documents (DOB cert, passport photo); organizer reviews per player
- **Registration Status:** PENDING → APPROVED / REJECTED
- **Organizer Direct Result Entry:** Tournament organizer can bypass team confirmation for fixture results
- **Stats Validation:** Only approved registered players can appear in match stats

---

### 3.5 SCOUTING SYSTEM

#### 3.5.1 Scout Hub (Consolidated Dashboard)
Single screen with 4 tabs for all scout activities:

**Tab 1 — Matches:**
- Nested sub-tabs: Upcoming / Completed
- Lists all scouting matches (official assigned + self-assigned temp)
- Each card: Teams, date/time, venue, Official Scout / Temp Scout badge
- Taps through to full Match Detail screen

**Tab 2 — Evaluations:**
- Lists all evaluation reports submitted by the scout
- Each card shows:
  - Player name, position, overall rating, verdict badge
  - Event link (tappable): "Home vs Away" or "Trial Title" → navigates to match or trial
  - Event date (scheduled match date or trial start date)
  - Report date (when evaluation was submitted)
  - Match or Trial type badge
- Taps through to full Evaluation Detail sheet (score bars, standout trait, deficiency notes)

**Tab 3 — Scouting CV:**
- List of players identified/discovered by the scout
- Each entry: Player name, academy at identification, year identified, verification badge (Verified/Pending)
- FAB: Add new CV entry → AddScoutCvEntry screen
- Delete entry with confirmation dialog

**Tab 4 — AI Reports:**
- List of AI-generated reports requested by the scout
- Status: Pending Payment / Paid / Generating / Ready
- Payment instructions shown for PENDING_PAYMENT reports
- Download PDF button for FULFILLED reports
- FAB: Request new report → bottom sheet with type/gender/position filters

#### 3.5.2 Scout CV (Player Identification Records)
- Scout records every player they have identified/discovered
- Fields: Player name, year identified, academy at identification, current club, optional link to platform player profile
- Player Verification: The linked player is notified and can verify or decline the scout's claim
- Verification Status: UNVERIFIED → PENDING → VERIFIED / DECLINED
- Verified entries display blue checkmark on scout's profile and CV

#### 3.5.3 Scout Evaluation Reports
**Template 1 — Physical Profile:**
- Acceleration (First 5m), Top-End Pace (30m), Agility & Balance, Stamina & Work Rate, Functional Strength

**Template 2 — Technical Baseline:**
- First Touch, Passing Accuracy, Dribbling & Ball Control

**Template 3 — Cognitive & Mental:**
- Scanning Frequency, Composure Under Pressure, Emotional Resilience

**Position Modules (selected based on player position):**
- CB: Aerial Dominance, Tackling 1v1, Line Organization, Progressive Distribution
- FB/WB: Touchline Engine, Wide 1v1 Defending, Delivery Quality, Recovery Positioning
- CM/DM/AM: Body Shape Reception, Spatial Pocket Finding, Tempo Control, Line Breaking Vision
- Wingers: Isolation & Elimination, Unpredictability, Far Post Runs, Counter-Press Trigger
- Strikers: Box Movement Timing, Finishing Efficiency, Hold-Up Play, Defensive Press Leader

**Summary:**
- Standout Trait (free text)
- Primary Deficiency (free text)
- Scout Verdict: Tier 1 / Tier 2 / Tier 3 / Tier 4
- Overall Rating: 1–10

**Evaluation Detail View (Score Display):**
- Linear progress bars per score (color coded: green ≥8, orange ≥5, red <5)
- Standout trait and deficiency blocks

**Evaluation Gating:**
- Match evaluations: only submittable after match scheduledDate has passed
- Trial evaluations: only submittable after trial startDate has passed

---

### 3.6 COMMUNICATION & MESSAGING

#### 3.6.1 Direct Messaging (1-to-1)
- Any two users can message each other
- Real-time via Socket.io
- Paginated history (30 per page)
- Unread count badge on inbox icon
- Mark messages as read

#### 3.6.2 Group Chat
- Create group with name, members, optional description
- Add/remove members
- Send messages to group
- Real-time delivery to all members
- Unread count per group
- Group messages appear in conversations list

#### 3.6.3 Automated Notifications (Chat-Based)
- **Temp Scout FYI:** When a scout self-assigns to a match, both home and away teams automatically receive: "Scout [Name] will be observing the match between [Home] and [Away]. This is for your information."
- Other system messages sent via chat (match confirmations, trial notifications)

#### 3.6.4 Notification Center
- In-app notifications
- Unread badge count
- Mark individual or all as read
- Max 50 most recent

---

### 3.7 ISMAILI AI (Conversational Football Advisor)

#### Requirements
- Conversational AI assistant "Ismaili" powered by Claude Haiku 4.5
- Auto-detects Kiswahili vs English per turn — response mirrors the query language regardless of app locale
- East African football context (Tanzania, Kenya, Uganda, Rwanda leagues, academies, culture); explicit prompt guardrails keep answers on-topic
- Topics: training, tactics, positioning, nutrition, fitness, mental resilience, career development, rules, refereeing law
- Question history kept per user (up to 50)
- **Quota System (per user tier):**
  - Free tier: capped monthly (varies by user type)
  - Active subscription: unlimited
  - Remaining quota shown after each question with paywall CTA on exhaustion
- Ismaili tabs surface a curated knowledge base alongside the chat (Advisory Phase 2a — audio + text contributor content, moderated)

#### Eligible User Types
PLAYER, COACH, SCOUT, ACADEMY, CLUB, SCHOOL, AGENT, REFEREE

---

### 3.8 REPORT REQUESTS (AI-GENERATED REPORTS)

#### Requirements
- Any user can request an AI-generated report
- **Report Types:** Player Report, Team/Academy Report, Market Report
- **Filters:** Region, district, gender, position, nationality, age range, notes
- **Pricing:**
  - Self-reports (player reporting on themselves, under 18): Free
  - Scouts and Agents with active subscription: Free Level 1 report
  - All others: TZS 3,000 per report (paid via AzamPay to SokaSoko business number)
- **Status Flow:** PENDING_PAYMENT → PAID → GENERATING → FULFILLED
- **Payment:** User pays via AzamPay mobile money, includes account number as reference; admin marks as paid
- **Delivery:** PDF with hyperlinked player profiles, downloadable from app
- Scouts access Report Requests via Scout Hub (AI Reports tab)
- All other users access via their profile Speed Dial FAB

---

### 3.9 SUBSCRIPTIONS

#### Plans by User Type

| User Type | Plans | Currencies |
|-----------|-------|------------|
| PLAYER | MONTHLY, TRIANNUAL, ANNUAL | TZS, KES, UGX |
| SCOUT | ANNUAL, BIANNUAL | TZS, KES, UGX |
| AGENT | ANNUAL, BIANNUAL | TZS, KES, UGX |
| COACH | MONTHLY, ANNUAL, BIANNUAL | TZS, KES, UGX |
| ACADEMY | MONTHLY, ANNUAL, BIANNUAL | TZS, KES, UGX |
| CLUB | MONTHLY, ANNUAL, BIANNUAL | TZS, KES, UGX |
| SCHOOL | MONTHLY, ANNUAL, BIANNUAL | TZS, KES, UGX |
| VENDOR | GOLD, PLATINUM, ENTERPRISE | TZS, KES, UGX |
| REFEREE | MONTHLY, ANNUAL | TZS, KES, UGX |

#### Tier Structure
Each user type has STANDARD (free) + one or more paid tiers (GOLD / PLATINUM / ENTERPRISE, or MONTHLY / ANNUAL). Feature caps stored in `FEATURE_CAPS` per (userType, tier). Usage metered per calendar month in `SubscriptionUsage`.

#### Subscription Benefits
- Unlimited Ismaili AI questions
- Free AI-generated reports (Level 1)
- Access to premium scouting features (Scout Report requests, evaluations received cap)
- Priority profile visibility in search rotation
- **VENDOR PLATINUM:** Doc Vetting service bundled; adverts + boost slots
- **VENDOR ENTERPRISE:** Guaranteed advertising rotation slots; broadcast messaging (planned)
- **ACADEMY PLATINUM:** Doc Vetting service bundled

#### Beta Test-Mode Env Flags
- `AUTO_APPROVE_PAYMENTS=true` — payments auto-mark as PAID without waiting for gateway callback
- `USAGE_CAPS_DISABLED=true` — feature caps not enforced
- Both MUST be OFF before public launch

---

### 3.10 MEDIA & FEED

#### Requirements
- Users post media (images, videos, links) with title and description
- Feed is randomized and interleaved with adverts (max 6 ads on first page)
- Like/unlike posts
- Playlist support to organize media collections
- YouTube video library managed by CMS admin
- Profile files — personal documents and certificates uploaded per user

---

### 3.11 SEARCH & DISCOVERY

#### Requirements
- Full-text search by name across all users
- Filter by: type, region, district, position, gender, age group
- Category search pages: Academies, Coaches, Agents, Guardians, Referees
- Public profile access (anyone can view any user's public profile)

---

### 3.12 VENUE MANAGEMENT

#### Requirements
- Venue database: name, region, district
- Bulk import from file (admin)
- Dropdown selection when scheduling matches

---

### 3.13 SPONSORSHIP / WANUFAIKA

#### Requirements
- **Sponsor Posts:** SPONSOR users publish offers (title, budget, target region/age/gender/position, duration). Optional anonymous mode hides sponsor identity from list view
- **Beneficiary Requests:** Any eligible user requests a listed sponsorship; sponsor reviews with accept / polite-decline (templated reasons)
- **Comment & Complain:** Public comment thread per post; complaint reports flow to admin queue
- **30-day Expiry:** Posts auto-expire; sponsor may re-list
- **Anonymous Reveal Gate:** Sponsor identity revealed only after acceptance

---

### 3.14 FOOTBALL CLINIC

#### Requirements
- **Clinic Create:** Organizer (COACH / ACADEMY / CLUB / SPONSOR) publishes clinic with title, description, sessions (multi-day), age groups, cost, capacity, safeguarding advisory link
- **Enrolment:** Players enrol per session; guardian consent required for minors (per-minor letter with signature check)
- **Coach Attendance Panel:** Organizer marks attendance per session
- **Safeguarding Advisory:** Editable safeguarding policy attached to every clinic
- **Talent ID Hub:** Consolidates trials + clinics + open tournaments into one discovery surface

---

### 3.15 LIVE SESSIONS (Broadcast + Jitsi)

#### Requirements
- **Request Live Session:** COACH / SCOUT / ACADEMY / CLUB / SPONSOR requests a live session (title, description, scheduled time, target audience)
- **Admin Approval:** Requests queue for SokaSoko admin review; approval publishes and schedules
- **Jitsi Integration:** Approved sessions launch in an in-app Jitsi WebView room
- **3-Tab Hub:** Upcoming / Live-now / Past
- **Ratiba Agenda:** Session appears on the host's profile Ratiba tab and in the global schedule endpoint
- **LIVE-NOW Banner:** In-app banner surfaces during a session with join CTA
- **24h Advance Notice:** Enforced normally; disabled via env flag during beta

---

### 3.16 CAREER EVENTS (Auto-Tracked Timeline)

#### Requirements
- **CareerEvent Model:** Auto-writes an event on each JOIN / LEAVE of academy, school, or coach linkage (via OrgStaffLink or player.academy field changes)
- **Backfill Script:** One-time job replays historical links → events
- **Manual CV:** Reserved for pre-SokaSoko history only; on-platform tenure is auto-tracked

---

### 3.17 SOKASOKO HOUSE ACCOUNT & SUPPORT

#### Requirements
- **Single House User:** Exactly one User row flagged `isSokaSokoHouse=true`; bypasses friends-only + orphan-guardian chat gates
- **Support Inbox:** Any user can DM the house account; admin dashboard shows a threaded inbox with open / resolved / all filters
- **Broadcast (Planned):** Enterprise-tier venue for advert broadcast + admin announcements
- **Pinned Tile:** House account surfaces as a fixed contact in the app

---

### 3.18 ADVERT PRODUCT

#### Requirements
- **Vendor-Owned Adverts:** VENDOR tier caps `concurrentAdverts` (per subscription level)
- **Boost Your Post:** `promoSlots` per tier let vendors boost their own feed posts to advertising rotation
- **Tier-Weighted Feed:** Feed sampler biases toward higher-tier vendors without full suppression of Standard
- **House-Ad Path:** SokaSoko house account can inject its own adverts alongside vendor content (planned for Enterprise-vendor broadcast)
- **CMS Advert Manager:** Admin creates, schedules, activates adverts

---

### 3.19 FOOTBALL ASSOCIATION (VYAMA)

#### 3.19.1 Account & Governance
- **FA Account Type:** Federations, regional / district FAs, TFF, MoFA, sports registrars registered as `FOOTBALL_ASSOCIATION`
- **Governance Staff Roles:** Extended OrgStaff role set for FA governance (CHAIRPERSON / SECRETARY / ACCOUNTANT)
- **Association Sub-Type:** `association_type` discriminator on FA profile
- **Free Tier Capped:** FA accounts sit on FREE tier by default with trials + clinics enabled; not subscription-eligible in v1

#### 3.19.2 Ratiba za Mechi (Match Schedule)
- FA-only screen listing every match relevant to the FA's district
- **Inclusion rule:** match shows when EITHER the venue is in the FA's region+district (registered venue OR manual venue's region field) OR either team is a registered ACADEMY/CLUB/SCHOOL in that region+district
- Two tabs — Zijazo (upcoming) + Zilizopita (recent, with final score). No per-user configuration; auto-loads

#### 3.19.3 Takwimu Wilaya (District Directory / Stats)
- Companion FA-only screen. Lists Academies / Clubs / Schools registered in the FA's district with public-only fields
- **Muhtasari block** at top — counts of Akademi / Klabu / Shule for the district
- **Type filter chips** (Yote / Akademi / Klabu / Shule)
- Each row: entity name + logo + type chip + accountNumber + registration date
- **Leadership panel** underneath each row — public names + roles (OWNER / MANAGER / SECRETARY / COACH) drawn from ACTIVE OrgStaffLinks. Contact info intentionally NOT surfaced; FA looks up the person via search if they need more
- **Consent model:** entity's obligation — signup carries an amber disclosure that leadership names will appear in the FA directory; entity informs its own staff before registering them

#### 3.19.4 FA Auto-Notifications
- New ACADEMY / CLUB / SCHOOL registering in the FA's district → "Taasisi mpya wilayani" bell (once per entity via `districtNotifiedAt` marker)
- Staff invite accepted → "Mabadiliko ya wafanyakazi" bell to matching FAs (60-second `acceptedAt` age-check prevents re-fires)

---

### 3.20 GUARDIAN ↔ MINOR LIFECYCLE

#### Requirements
- **Guardian Link:** Guardian registers minor players under their account; each minor carries a `guardian` ref
- **Rule 1 — Notification Fan-out:** Every notification created for a minor auto-mirrors to the linked guardian with a `MinorName:` prefix
- **Per-Minor Consent:** Trials, clinics and live-session participation require a per-minor consent letter with signature check
- **Emancipation Flow:** On turning 18, minor gets a pinned notification with opt-out CTA + snooze; guardian + linked orgs notified on emancipation
- **Rules 2–6 (Pending):** Guardian removal, orphaned-minor state, guardian reassign, guardian-initiated player invite-confirmation

---

### 3.21 NOTIFICATIONS & PUSH

#### 3.21.1 Inbox (In-App)
- Persistent per-user `Notification` collection with `titleKey`/`bodyKey`/`params` for bilingual rendering
- Legacy plain `title`/`body` kept as fallback for pre-migration rows
- Guardian mirror hook on every write
- Pinned notifications for critical prompts (e.g. emancipation reminder)
- Unread badge on inbox icon; mark-single / mark-all-read

#### 3.21.2 User Preferences
Per-user `notificationPrefs`:
- **Master:** `push.enabled` toggle
- **Quiet Hours:** `push.quietStart` + `push.quietEnd` (HH:mm UTC)
- **8 Categories (default ON):** myMatches, favourites, invitations, reports, subscription, moderation (always on), sokasoko, chat
- **Device Tokens:** One-to-many `(userId, token, platform)` with unique token index; auto-prune on invalid-token error

#### 3.21.3 Push Transport (Phase B — Firebase)
- `sendPush` helper in `src/Notification/push_sender.js` — installs `firebase-admin` and reads `FIREBASE_CREDENTIALS_JSON` env
- Gated by user prefs (category + master + quiet hours); moderation always pushes
- Foreground vs background handled per platform
- Currently no-op (Phase A) — inbox continues to work; push activates once Firebase project + APNs cert are wired
- iOS APNs blocked until Apple Developer enrollment (Path A) completes

#### 3.21.4 Favourites Fan-Out
- On `MATCH_COMPLETED`, backend reverse-looks up `User.favoriteTeams` and creates a "Timu yako imemaliza mechi · Full-time X 2-1 Y" inbox row + queues a push under the `favourites` category
- Dedupe: users already in the team/staff fan-out are excluded

---

### 3.22 FAVOURITES

#### Requirements
- **Team Favourites:** Users tap ♥ next to a team name (scores screen, match cards) to add/remove from `User.favoriteTeams`
- **Tournament Favourites:** Same heart pattern on tournament chips → `User.favoriteTournaments`
- **Idempotent Toggle:** Server-side `POST /users/:id/favorites/toggle` guarantees clean state; client caches arrays via `UserProvider`
- **Scores Filter Chip:** "Vipendwa" chip filters the scores list to matches involving any favourited team or tournament. Chip order: Yote · Leo · Vipendwa · Karibuni · Zilizopita
- **Notification Hook:** See §3.21.4

---

### 3.23 ONE-TIME REPORT PURCHASE

#### Requirements
- **Per-Report Payment SKUs:** STANDARD-tier users + cap-exhausted GOLD users can pay per report instead of upgrading
- **Basic + Customized SKUs:** Two tiers of one-time report
- **M-Pesa Eligible on iOS:** Local payment rails preserved (see iOS payment blocker)

---

### 3.24 CHAT SAFETY & PRIVACY

#### Requirements
- **Friends-Only Mode:** `friendsOnly` toggle limits DM initiation, full profile view, and scouting requests to accepted friends
- **Friend Requests:** Send / accept / decline flow with pending in/out arrays
- **Block / Unblock:** Blocked users cannot DM or view profile; block list surfaced in Chat Settings
- **Report User:** In-app report with reason categories → mod queue
- **In-App Account Deletion:** Self-service deletion flow that cascades cleanup across posts / links / OrgStaff

---

### 3.25 BETA TESTING INFRASTRUCTURE

#### Requirements
- **`betaTester` Flag:** Boolean field on User; when `BETA_TESTING_ONLY=true` env is set, only beta testers can log in
- **Play Store Internal Testing:** Belt-and-suspenders alongside the backend gate
- **APK Direct Distribution:** For pre-Internal-Testing hand-off to select testers
- **QA Scripts:** Manual test scripts under `sokasokoo/docs/QA_*.md` (score cycle, district calendar, notification settings, scout evaluation, push Phase B, academy/club registration, match lifecycle, Kiswahili checklist)
- **Version Footer:** Beta version tag shown on profile so testers can reference in bug reports

---

### 3.26 TOURNAMENT V2 (Phase 1 shipped)

Extension of §3.4 aimed at general-purpose youth cups (target pitch: Chipkizi Cup 2025 in December).

#### Requirements
- **Types:** `LEAGUE / CUP / KNOCKOUT / ROUND_ROBIN / GROUP_THEN_KNOCKOUT / FRIENDLY`. GROUP_THEN_KNOCKOUT is the common youth format (round-robin groups → knockout bracket)
- **Categories:** `categories[]` on Tournament — multi-select gender × age combos (one tournament can hold many, e.g. Wanaume U14 + Wanawake U16 + Wote OPEN)
- **Structured Prizes:** `firstPrize`, `runnerUpPrize` (strings), `hasNoPrizes` (bool). N/A toggle hides the two fields
- **Location:** `region` (dropdown) + `district` (dropdown filtered by region) — no free text
- **Official Scouts + Referees:** `officialScouts[]`, `officialReferees[]` — arrays, multi-select at creation
- **Publish Gate:** `isPublished` (default false) + `publishedAt`. Organizer preps privately, flips to public via ⋮ menu on their own card
- **Owner-visible drafts:** `GET /v1/tournaments?organizer=<id>` returns own drafts; public list hides `isPublished=false`
- **Team Registrations (`TournamentTeamRegistration`):** teams apply per category → organizer reviews (Approve / Reject with reason / team can Withdraw). On approve → team lands in `Tournament.teams[]`. Notifications on request received + approve/reject
- **Roadmap (not yet shipped):** bracket auto-generation, live standings, public spectator page, entry payment, live scoring, roster locking

---

### 3.27 ENTITY AGE + GENDER COVERAGE

Applies to ACADEMY / CLUB / SCHOOL accounts.

#### Requirements
- **`supportedAgeLevels[]`** — free-form age tags (U10 / U12 / … / SENIOR) the entity fields teams for
- **`supportedGenders[]`** — subset of `MALE` / `FEMALE`. Rendered as Me / Mk chip on the profile card top
- **Set at signup form_two** — FilterChip multi-select. Kept the 3-form structure per user preference
- **Editable on Edit Profile** — same pickers
- **Displayed on `Info Zaidi`** — "Vikundi vya umri" row lists all supported ages

---

### 3.28 ORG-AWARE NAMING (Backend + Client)

Prevents leaking the creator's personal name for org accounts.

#### Requirements
- **`entityLabel(u)` helper** in `src/Utils/utils.js` — checks `academy_name` → `entity_name` → `company_name` → `football_field_name` → personal name. Used on every notification body, inbox row, staff invite copy, scout invoice, sponsorship comment/request, and the chat conversations aggregation (`partnerName` built via `$let`/`$switch` with the same ladder)
- **`localizedGender(context, code)`** + **`localizedFoot(context, code)`** helpers on client (`lib/utils.dart`) — every raw gender / preferred-foot dropdown across signup + edit + search filters localizes to Kike/Kiume + Kushoto/Kulia/Yote
- **Match notification split** — same-team recipients see the acting staff's personal name ("Coach John amepanga…"); opposing-team recipients see the actor's TEAM name ("Yanga amepanga…"). `resolveActorSide` on the backend decides via team-match or ACTIVE OrgStaffLink

---

### 3.29 GEO INPUT — MTAA / SHEHIA + DISTRICT DROPDOWNS

#### Requirements
- **Location dropdowns everywhere** — regions.json → dropdown; districts.json → filtered by region (with " Region" / " District" suffix normalisation); wards from wards.json
- **Shehia switch (Zanzibar):** `MtaaDropdown` watches sibling region control. When region resolves to any of the five Zanzibar regions (Kaskazini/Kusini Unguja, Mjini Magharibi, Kaskazini/Kusini Pemba, with/without suffix), the label / popup title / empty-state warning swap from "Serikali ya Mtaa" to "Shehia"

---

### 3.30 SCORES & MATCH LIFECYCLE V2

Extends §3.2.

#### Requirements
- **Strict Home → Away → Home Workflow** (shipped 2026-09-19): HOME saves → both confirmations reset → AWAY confirms → HOME closes → COMPLETED + matchId `TFH-M-XXXXXX`. HOME edit after AWAY confirm resets AWAY's flag
- **Score Access:** team account + ACTIVE OrgStaffLink staff in OWNER / MANAGER / COACH / SECRETARY roles (SECRETARY added as 4th)
- **Enter Result header:** team names (not the creator's personal name)
- **Fan-out on every action:** schedule / confirm / decline / result save / confirm / close / cancel / reschedule → all authorized users on both teams, minus actor. Guardian mirror cascades
- **Favourites (§3.22):** score-close on any favourited team fires a "Timu yako imemaliza mechi" fan-out to followers (deduped against team/staff recipients)
- **Filter chip order** on Scores: Yote · Leo · Vipendwa · Karibuni · Zilizopita

---

### 3.31 LIVE SESSION AUDIENCE EDIT

Fixes the "Select audience later" dead-end.

#### Requirements
- **PATCH `/v1/live-sessions/:id/audience`** — host-only, allowed while REQUESTED or APPROVED. Accepts `{ audience, audienceUsers[] }`
- **Backfill fan-out:** if session was APPROVED and audience just transitioned from empty → filled, re-runs the standard invite fan-out so the newly-picked audience gets pinged
- **Client affordance:** amber person-add icon on the host's Zangu card when session is APPROVED + SPECIFIC + empty. Opens a bottom sheet: pick "Kila mtu SokaSoko" (flips to GENERAL) or "Wateule maalum" (search modal, pre-populated with existing invitees, add/remove chips)
- **Locked:** once LIVE / ENDED / CANCELLED

---

### 3.32 AUTHENTICATION — Password Reset & Change

#### 3.32.1 Forgot Password (Unauth)
- **`POST /v1/auth/forgot-password`** — body `{ identifier }` (phone or email)
- Generates 6-digit code, hashes with bcrypt, stores on `User.passwordResetCode` + `passwordResetExpiresAt` (15-min TTL)
- Sends via SMS (Beem, existing sender) when phone is available; email transport stubbed (logs to console) until SMTP wires
- **Silent-200** regardless of whether the identifier is registered — prevents account enumeration
- **`POST /v1/auth/reset-password`** — body `{ identifier, code, newPassword }`. Verifies hashed code + expiry, sets fresh bcrypt hash, clears reset fields
- Client: two-step ForgotPasswordScreen reachable via "Umesahau nywila?" link on sign-in. Inline `errorText` on invalid code / mismatched password

#### 3.32.2 Change Password (Auth)
- **`POST /v1/users/:id/change-password`** — body `{ currentPassword, newPassword }`. Verifies current via `User.comparePassword` before mutating
- Client: ChangePasswordScreen accessed via **Badili Nywila** in the profile ⋮ menu
- Common: minimum 6-character password, bilingual `errorKey` on every 4xx

#### 3.32.3 Admin Reset
- `scripts/reset-password.js <accountNumber> <newPassword>` — one-off Render-shell reset when the user can't self-serve (e.g. lost phone AND email)

---

## 4. ADMIN CMS

**Technology:** React + Ant Design  
**Access:** Web browser, admin credentials only

### CMS Modules

| Module | Capabilities |
|--------|-------------|
| **Players** | View, edit, filter player database |
| **Tournaments** | Create and manage tournaments, approve team/player registrations |
| **Matches** | View all matches, manage scheduling and results |
| **Subscriptions** | View active subscriptions, mark payments, manage expiry |
| **Venues** | Import venue data, manage venue list |
| **Sponsors** | Manage sponsor profiles and partnerships |
| **Playlists** | Curate video/media collections |
| **Adverts** | Create, schedule, and manage advertisements |
| **Users** | Admin user management, suspend/ban users |
| **Reports** | Generate platform analytics, export PDFs |
| **YouTube** | Manage video library of football highlights |
| **GeoLocation** | Manage regions and districts |

---

## 5. TECHNICAL ARCHITECTURE

| Component | Technology |
|-----------|-----------|
| Mobile App | Flutter (Dart) — Android & iOS |
| Backend API | Node.js + Express |
| Database | MongoDB (Mongoose ODM) |
| Real-time | Socket.io |
| AI | Anthropic Claude (Haiku 4.5 for AI Advisor) |
| File Storage | Server-side upload (Multer) |
| PDF Export | Server-side PDF generation |
| Admin CMS | React + Ant Design |
| Deployment | Render (API auto-deploys on git push to main) |
| API Version | v1 (all endpoints prefixed `/v1/`) |

---

## 6. NON-FUNCTIONAL REQUIREMENTS

- **Multi-language:** Swahili and English throughout
- **Offline Resilience:** App degrades gracefully without connectivity; cached provider state
- **Pagination:** All list endpoints support `page` and `limit` parameters
- **Search:** Full-text and filter-based user search
- **Security:** Role-based actions (e.g. only organizer repairs trial scouts, only official scout sees accept/decline banner)
- **Data Integrity:** Scout schema migration with auto-repair for legacy corrupt subdocuments
- **Real-time:** Socket.io for chat and live notifications
- **East Africa Focus:** Currency support (TZS, KES, UGX), regional filtering, Swahili language, local league context in AI

---

## 7. KEY USER JOURNEYS

### Journey 1 — Player Gets Discovered
1. Player creates profile with position, DOB, stats
2. Scout discovers player at a match (via temp scout registration or official assignment)
3. Scout submits evaluation report after match date passes
4. Scout adds player to their Scouting CV
5. Player receives notification, verifies the scout's claim
6. Player's verified status improves profile credibility
7. Agent/Academy finds player via search, views public profile and evaluation

### Journey 2 — Academy Schedules a Trial
1. Academy posts trial: title, age groups, dates, location, max per group
2. Academy assigns scouts to trial
3. Scouts receive notification, accept or decline in Trial Detail
4. Players register, upload documents, select age group
5. Academy approves registrations
6. Scouts evaluate players during/after trial
7. Academy reviews evaluations in Scout Hub

### Journey 3 — Match Lifecycle
1. Home team schedules match, selects opponent, date, venue, scout
2. Away team confirms or declines
3. Assigned scout accepts/declines assignment
4. Any other scout can self-assign as temp scout (both teams notified via chat)
5. On match day, results entered by either team
6. Opposing team confirms result
7. Match status → COMPLETED
8. Scout submits evaluation reports for observed players

### Journey 4 — Scout Uses Scout Hub
1. Scout opens Scout Hub from profile FAB
2. Matches tab: sees upcoming assigned matches and temp scout matches
3. Opens a match → can evaluate players after match date
4. Evaluations tab: all submitted reports with player name, match/trial link, both dates
5. Opens evaluation → full score detail with progress bars
6. Scouting CV tab: complete history of identified players with verification status
7. AI Reports tab: requests a player market report, pays TZS 3,000, receives PDF

---

## 8. KNOWN ISSUES & BACKLOG

See `AUDIT_REPORT.md` for full list. Snapshot as of 2026-09-19:

### Shipped in 3.1 (Sept 19–23 2026)
- [x] Match venue required (registered OR manual) + district calendar filter includes venue OR team location
- [x] Tournament v2 Phase 1 (GROUP_THEN_KNOCKOUT type + publish gate + multi-category + structured prizes + team registration)
- [x] Takwimu Wilaya (FA district directory) + auto-notifications for new entity + staff changes
- [x] Entity age/gender coverage on ACADEMY / CLUB / SCHOOL
- [x] Org-aware naming sweep (backend entityLabel + client localizedGender/Foot)
- [x] Shehia label switch on Zanzibar regions in MtaaDropdown
- [x] Live session audience backfill (PATCH /:id/audience + "Ongeza wasikilizaji" affordance)
- [x] Forgot Password + Change Password flows (SMS OTP)
- [x] Guardian consent dialog spacing + inline errorText
- [x] Add-player validation toast fix (only fires on invalid submit)
- [x] Rename "Vippindi/Alika Kwenye Kipindi" → "Mualiko Kwenye Kipindi"
- [x] Notification menu items renamed (Ratiba ya Wilaya → Ratiba za Mechi; Vyombo vya Wilaya → Takwimu Wilaya)

### Shipped Since v2
- [x] Notification schema migrated to `titleKey`/`bodyKey`/`params` (bilingual)
- [x] Guardian mirror hook on every notification
- [x] Strict Home → Away → Home match confirmation workflow
- [x] Team + staff (OWNER / MANAGER / COACH / SECRETARY) score access
- [x] Team-to-team notification fan-out on every match action
- [x] Enter Result header shows team names (not creator personal names)
- [x] Ismaili AI live in beta with per-tier quotas
- [x] Favourites (teams + tournaments) + notification hook
- [x] District Calendar for FA accounts
- [x] Notification Prefs Phase A (schema + endpoints + settings UI)
- [x] Vendor advert product v1
- [x] Sponsorship / Wanufaika end-to-end
- [x] Football Clinic v1
- [x] Live Sessions Phase 1
- [x] CareerEvent auto-tracking
- [x] SokaSoko house account + support inbox
- [x] Minor emancipation flow

### Open — Pre-Launch Blockers
- [ ] Push transport (Phase B): install `firebase-admin`, set `FIREBASE_CREDENTIALS_JSON`, wire `firebase_messaging` on mobile, iOS APNs cert
- [ ] Media storage migration: multer local → S3 / R2 (Render ephemeral disk wipes uploads on redeploy)
- [ ] Rotate MongoDB Atlas credential (currently sokasoko:sokasoko)
- [ ] Turn OFF `AUTO_APPROVE_PAYMENTS` + `USAGE_CAPS_DISABLED` env flags
- [ ] Revert PLAYER STANDARD `evaluationsReceivedPerMonth` cap from 3 → 1
- [ ] Remove demo-seeded PLATINUM VENDOR account
- [ ] Payment gateway integration (M-Pesa primary rail; AzamPay reference retained)
- [ ] iOS Path A completion (Apple Developer enrollment + TestFlight; StoreKit deferred to Path B)
- [ ] Block-user feature per Play Store commitment
- [ ] Org creator name → separate searchable field (currently orgs surface on personal-name search)

### Open — Post-Launch Polish
- [ ] Live "GOAL!" push during match window (piggyback on in-window result save)
- [ ] Scout evaluation category split (currently bundled under `reports`)
- [ ] Guardian ↔ Minor Rules 2–6 (removal, orphan, reassign, invite-confirmation)
- [ ] File Repositories + CV tab (blocked on storage migration)
- [ ] Auth logo size polish + advert portrait crop fix + feed letterbox triage
- [ ] Persistent WebView for playlist videos
- [ ] Migrate remaining 11 UserInfo call-sites to `UserInfo.open()`
- [ ] District Calendar month grid (Phase 2 upgrade from agenda list)
- [ ] Full UX/perf sweep (uploads, sign-in, video, forms, CloudFront via CLI)
- [ ] Franchise architecture (federated per-country instances + Global Portal)
- [ ] Advisory Phase 2 knowledge base with RAG + retrieval-linked compensation
- [ ] Doc Vetting service order/payment/review flow
- [ ] Enterprise-vendor broadcast pipeline (fan-out + moderation)
- [ ] Home feed paid-tier bias audit
- [ ] Play Console Data Safety: flip Fitness + Audio flags if features ship
- [ ] Stats endpoints (player, team, coach, referee career stats)
- [ ] CMS filter/search polish
