const mongoose = require('mongoose');
const actions = require('mongoose-rest-actions');
const bcrypt = require('bcryptjs');

const { generateHash } = require('../Utils/utils');

const { Schema, model } = mongoose;

const SCHEMA_OPTIONS = {
  id: false,
  timestamps: true,
  toJSON: { getters: true },
  toObject: { getters: true },
  emitIndexErrors: true,
};

const positions = [
  'GOALKEEPER',
  'CENTER BACK',
  'RIGHT BACK',
  'LEFT BACK',
  'WING BACK',
  'OFFENSIVE MIDFIELD',
  'DEFENSIVE MIDFIELD',
  'STRIKER',
  'WINGER',
];

const foot = ['RIGHT', 'LEFT', 'BOTH'];

const types = [
  'PLAYER',
  'COACH',
  'GUARDIAN',
  'ACADEMY',
  'SCHOOL',
  'VENDOR',
  'CLUB',
  'SPONSOR',
  'AGENT',
  'REFEREE',
  'SCOUT',
  'FIELD_OWNER',
];

const FREE_TRIAL_DAYS = 60;
const GRACE_PERIOD_DAYS = 5;
const NOTIFY_BEFORE_DAYS = 7;

const UserSchema = new Schema(
  {
    firstName: {
      type: String,
      required: [true, 'firstName is required'],
      searchable: true,
      trim: true,
    },
    middleName: {
      type: String,
      searchable: true,
      trim: true,
    },
    lastName: {
      type: String,
      required: [true, 'lastName is required'],
      searchable: true,
      trim: true,
    },
    accountNumber: {
      type: String,
      trim: true,
      index: true,
      exists: true,
    },
    phone: {
      type: String,
      index: true,
      trim: true,
    },
    region: {
      type: String,
      trim: true,
      index: true,
      searchable: true,
      default: 'Dar es Salaam',
    },
    district: {
      type: String,
      trim: true,
      index: true,
      searchable: true,
      default: 'Ilala Municipal',
    },
    type: { type: String, enum: types, default: types[0] },
    ward: {
      type: String,
      trim: true,
      index: true,
      searchable: true,
      default: 'Ilala',
    },
    dob: {
      type: Date,
      required: false,
      default: null,
    },
    age: { type: Number },
    nationality: {
      type: String,
    },
    gender: {
      type: String,
      index: true,
      searchable: true,
      enum: ['FEMALE', 'MALE'],
    },
    weight: {
      type: Number,
    },
    height: {
      type: Number,
      index: true,
      searchable: true,
    },
    position: {
      type: String,
      trim: true,
      enum: positions,
      index: true,
      searchable: true,
    },
    foot: {
      type: String,
      enum: foot,
      trim: true,
      index: true,
      searchable: true,
    },
    profileImage: {
      type: String,
      default: 'https://sokasoko.s3.us-west-2.amazonaws.com/avatar.png',
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    // Relationship a guardian declared to the minor at registration time.
    // Internal only — NOT surfaced on public profile view.
    // Values: PARENT | GUARDIAN | SIBLING | TEACHER | OTHER
    guardianRelationship: {
      type: String,
      enum: ['PARENT', 'GUARDIAN', 'SIBLING', 'TEACHER', 'OTHER', ''],
      default: '',
    },
    // Freeform description when guardianRelationship === 'OTHER'.
    guardianRelationshipOther: { type: String, trim: true, default: '' },

    // --- Guardian ↔ Minor lifecycle (see project_guardian_minor_relationship memory) ---
    // The GUARDIAN user currently responsible for this minor. Nullable
    // for non-players and for orphaned minors between guardians.
    guardian: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    // A minor with no active guardian. Restricts chat/match/scout/profile
    // for this user until reattached. Only meaningful when type=='PLAYER'.
    guardianOrphaned: { type: Boolean, default: false, index: true },
    // Set on ACADEMY/CLUB/SCHOOL orgs when their ACTIVE staff count first
    // exceeds their tier's staffSeats cap. Cleared once trimmed. If left
    // stamped for >5 days, the scheduler disables all their staff links.
    staffOverQuotaSince: { type: Date, default: null },
    // Set to the previous guardian's id on removal so the new guardian's
    // acceptance can notify them: "minor X is now with guardian Y".
    previousGuardian: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    suspend: { type: Boolean, default: false },
    playlistOverride: { type: Boolean, default: false },
    themeColor: { type: String, trim: true },
    street: String,
    email: { type: String, trim: true },
    contact_number: { type: String, trim: true },
    facebook: { type: String, trim: true },
    youtube: { type: String, trim: true },
    instagram: { type: String, trim: true },
    twitter: { type: String, trim: true },
    linkedin: { type: String, trim: true },
    website: { type: String, trim: true },
    contact_email: { type: String, trim: true },
    subAccount: { type: Boolean, default: false },
    password: { type: String, required: true },
    fifaId: { type: String, trim: true },
    license_level: { type: String, trim: true },
    education_level: { type: String, trim: true },
    sponsor_type: { type: String, trim: true },
    // Sponsor-only privacy toggle. When true, public reads (GET /users/:id,
    // list, search) surface name/photo/socials/location as "Anonymous" /
    // stripped. The record itself is unchanged — admins and the sponsor
    // themselves still see everything. Reversible any time.
    isAnonymous: { type: Boolean, default: false },
    academy_name: { type: String, trim: true },
    entity_name: { type: String, trim: true },
    company_name: { type: String, trim: true },
    company_title: { type: String, trim: true },
    vendor_type: { type: String, trim: true },
    company_description: { type: String, trim: true },
    academy_registration: { type: String, trim: true },
    // CLUB-specific fields. academy_name / academy_registration /
    // academy_description double as club_name / TFF-reg / club-description
    // (labels change in the mobile UI); these two are club-only.
    club_division: {
      type: String,
      enum: ['PREMIER_LEAGUE', 'CHAMPIONSHIP', 'LEAGUE_ONE', 'LIGI_YA_MKOA', 'NONE', ''],
      default: '',
    },
    club_membership: { type: Boolean, default: false },
    coach_registration: { type: String, trim: true },
    coach_license: { type: String, trim: true },
    linkedAcademy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    owner: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    ownerName: { type: String, trim: true },
    secretary: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    secretaryName: { type: String, trim: true },
    academy_description: { type: String, trim: true },
    school_type: { type: String, trim: true, enum: ['PRIMARY', 'SECONDARY', 'CHUO'] },
    school_gender: { type: String, trim: true, enum: ['ALL_GIRLS', 'ALL_BOYS', 'MIXED'] },
    academic_teacher: { type: Schema.Types.ObjectId, ref: 'User', default: null, autopopulate: true },
    sports_teacher_1: { type: Schema.Types.ObjectId, ref: 'User', default: null, autopopulate: true },
    sports_teacher_2: { type: Schema.Types.ObjectId, ref: 'User', default: null, autopopulate: true },
    school: { type: Schema.Types.ObjectId, ref: 'User', default: null, autopopulate: true },
    school_class: { type: String, trim: true },
    school_jersey_number: { type: String, trim: true },
    has_football_field: { type: Boolean, default: false },
    football_field_name: { type: String, trim: true },
    field_accessible_to_community: { type: Boolean, default: false },
    school_id: { type: String, trim: true, index: true },
    referee_license_level: { type: String, trim: true },
    tafoca: { type: String, enum: ['YES', 'NO'] },
    talent_id_training: { type: String, enum: ['YES', 'NO'], trim: true },
    national_team_call: { type: Number, default: 0 },
    national_youth_call: { type: Number, default: 0 },
    umiseta_games: { type: String },
    umitashumta_games: { type: String },
    short_bio: { type: String },
    academy: {
      type: Schema.Types.ObjectId,
      ref: 'Academy',
      default: null,
      autopopulate: true,
    },
    agent: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      autopopulate: true,
    },
    advertVideo: {
      type: String,
      default: 'https://www.youtube.com/watch?v=eyGPIpZ7208',
    },
    advertDuration: {
      type: Number,
      default: 5,
    },
    is_mandatory: {
      type: Boolean,
      default: false,
    },

    // --- Rate per game (SCOUT + REFEREE) ---
    // Fee charged per game engagement. For SCOUT: full-team scouting.
    // For REFEREE: officiating one match. Same field, same units (TSh).
    // Consumed by the SokaSoko Recommend scoring formula.
    costPerGame: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Cost the scout charges per individual player evaluation request.
    // (SCOUT-only; separate from per-game because it's a different service.)
    costPerPlayer: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Scout has completed formal scout training. Feeds the SokaSoko
    // Recommend score at 25%. Default false — new signups and existing
    // scouts start off untrained until they explicitly opt in on the
    // edit-profile screen. Not scored for non-SCOUT users.
    scoutTraining: {
      type: Boolean,
      default: false,
    },

    // --- System agents (AI assistant "Ismaili", etc.) ---
    // Marks a User row as an automated system persona. Filtered out of the
    // opponent typeahead, scout picker, user search, and forward pickers so
    // the persona never appears where a human is expected.
    isSystemAgent: {
      type: Boolean,
      default: false,
      index: true,
    },

    // --- Blocked users (user-level moderation) ---
    // Users this account has blocked. Blocking is unilateral and one-way
    // in the schema, but the enforcement in chat / feed / search treats
    // either direction as an active block — see chat.http.router.js and
    // the feed / search endpoints.
    blockedUsers: [{
      type: Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    }],

    // --- Friends-only privacy mode ---
    // When true, only users in `friends` can DM this account, view
    // their full profile, or request scouting. All other interactions
    // remain public. Enforced in chat + profile endpoints.
    friendsOnly: { type: Boolean, default: false, index: true },
    // Accepted friendships (mutual). Add via /v1/users/:id/friend/accept.
    friends: [{
      type: Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    }],
    // Pending outgoing friend requests (this user has asked these people).
    friendRequestsSent: [{
      type: Schema.Types.ObjectId,
      ref: 'User',
    }],
    // Pending incoming friend requests (these people have asked this user).
    friendRequestsReceived: [{
      type: Schema.Types.ObjectId,
      ref: 'User',
    }],

    // --- Closed-beta testing gate ---
    // When the env flag BETA_TESTING_ONLY=true is set on the backend, only
    // users with betaTester=true are allowed to log in. Belt-and-suspenders
    // control alongside Google Play Internal Testing so a leaked APK still
    // can't sign in against production.
    betaTester: {
      type: Boolean,
      default: false,
      index: true,
    },

    // --- SokaSoko house account (customer service portal) ---
    // Marks the single SokaSoko official-account user row. Any account
    // with this flag bypasses friendsOnly + orphan-guardian chat gates
    // (users must always be able to reach support) and is surfaced as
    // a pinned tile in the mobile app. Exactly one User should carry
    // this flag; created by scripts/seed-sokasoko-account.js.
    isHouseAccount: {
      type: Boolean,
      default: false,
      index: true,
    },

    // --- Admin (customer service agent) ---
    // Grants access to the SokaSoko Support Inbox screen + the reply-
    // as-SokaSoko endpoint. Flip manually in the DB (or via
    // scripts/grant-admin.js). Distinct from isSystemAgent (that flag
    // is for AI personas, this one is for human support agents).
    isAdmin: {
      type: Boolean,
      default: false,
      index: true,
    },

    // --- SokaSoko support conversation state ---
    // Only meaningful on regular user rows (not the house account
    // itself). Set to a Date when an admin marks the user's support
    // conversation as resolved; cleared automatically when the user
    // sends a new message to SokaSoko. Powers the "resolved / open"
    // filter on the admin inbox.
    sokasokoSupportResolvedAt: {
      type: Date,
      default: null,
    },

    // --- SokaSoko support menu state ---
    // Tracks where the user is in the menu-driven help flow.
    //   area  : null | 'ROOT' | <area code from support_menu.AREAS>
    //   updatedAt: Date used to expire stale menu context after
    //              STATE_TTL_MIN minutes so a long-gone menu doesn't
    //              intercept a fresh support question.
    sokasokoSupportMenu: {
      area: { type: String, default: null },
      updatedAt: { type: Date, default: null },
    },

    // --- Free Trial ---
    freeTrialEndDate: {
      type: Date,
      default: null,
      index: true,
    },
    gracePeriodEndDate: {
      type: Date,
      default: null,
      index: true,
    },
    trialExpiredNotifiedAt: {
      type: Date,
      default: null,
    },
    gracePeriodNotifiedAt: {
      type: Date,
      default: null,
    },
  },
  SCHEMA_OPTIONS
);

UserSchema.index({
  firstName: 'text',
  lastName: 'text',
  middleName: 'text',
  accountNumber: 'text',
  academy_name: 'text',
  type: 'text',
  company_name: 'text',
});

// Hot query paths for the guardian roster + orphan-exclusion filter
// on PATH_LIST. Without this the guardian's dependents fetch is a full
// scan every time.
UserSchema.index({ createdBy: 1, type: 1, guardianOrphaned: 1 });
UserSchema.index({ guardian: 1, type: 1, guardianOrphaned: 1 });
UserSchema.index({ type: 1, createdAt: -1 });
UserSchema.index({ accountNumber: 1 });

// Auto-set free trial dates on first save for PLAYER and SCOUT
UserSchema.pre('save', function preValidate(done) {
  if (this.isNew && (this.type === 'PLAYER' || this.type === 'SCOUT')) {
    const now = new Date();

    const trialEnd = new Date(now);
    trialEnd.setDate(trialEnd.getDate() + FREE_TRIAL_DAYS);
    this.freeTrialEndDate = trialEnd;

    const graceEnd = new Date(trialEnd);
    graceEnd.setDate(graceEnd.getDate() + GRACE_PERIOD_DAYS);
    this.gracePeriodEndDate = graceEnd;
  }
  return this.preValidate(done);
});

UserSchema.methods.preValidate = async function preValidate(done) {
  return done();
};

// Get the current access status of this user
UserSchema.methods.getAccessStatus = function getAccessStatus() {
  const now = new Date();
  const type = this.type;

  // Only PLAYER and SCOUT have trial/subscription restrictions
  if (type !== 'PLAYER' && type !== 'SCOUT') {
    return { status: 'UNRESTRICTED', daysRemaining: null };
  }

  const trialEnd = this.freeTrialEndDate;
  const graceEnd = this.gracePeriodEndDate;

  if (!trialEnd) {
    return { status: 'UNRESTRICTED', daysRemaining: null };
  }

  const msPerDay = 1000 * 60 * 60 * 24;

  // Still in free trial
  if (now <= trialEnd) {
    const daysRemaining = Math.ceil((trialEnd - now) / msPerDay);
    const notifySoon = daysRemaining <= NOTIFY_BEFORE_DAYS;
    return {
      status: 'FREE_TRIAL',
      daysRemaining,
      notifySoon,
      freeTrialEndDate: trialEnd,
      gracePeriodEndDate: graceEnd,
    };
  }

  // In grace period
  if (now <= graceEnd) {
    const daysRemaining = Math.ceil((graceEnd - now) / msPerDay);
    return {
      status: 'GRACE_PERIOD',
      daysRemaining,
      freeTrialEndDate: trialEnd,
      gracePeriodEndDate: graceEnd,
    };
  }

  // Fully expired
  return {
    status: 'EXPIRED',
    daysRemaining: 0,
    freeTrialEndDate: trialEnd,
    gracePeriodEndDate: graceEnd,
  };
};

UserSchema.methods.comparePassword = function comparePassword(password, done) {
  bcrypt.compare(password, this.password, function cb(err, isMatch) {
    if (err) {
      return done(err, false);
    }
    return done(null, isMatch);
  });
};

UserSchema.methods.changePassword = async function changePassword(password) {
  const hash = await generateHash(password);
  await mongoose.model('User').findByIdAndUpdate(this._id, { $set: { password: hash } });
  this.password = hash;
};

UserSchema.methods.setAccountNumber = async function setAccountNumber(criteria) {
  await mongoose.model('User').findByIdAndUpdate(this._id, { $set: { accountNumber: criteria } });
  this.accountNumber = criteria;
};

mongoose.plugin(actions);

module.exports = model('User', UserSchema);
module.exports.FREE_TRIAL_DAYS = FREE_TRIAL_DAYS;
module.exports.GRACE_PERIOD_DAYS = GRACE_PERIOD_DAYS;
module.exports.NOTIFY_BEFORE_DAYS = NOTIFY_BEFORE_DAYS;
