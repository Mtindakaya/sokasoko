const mongoose = require('mongoose');
const actions = require('mongoose-rest-actions');

const { Schema, model } = mongoose;

const SCHEMA_OPTIONS = {
  id: false,
  timestamps: true,
  toJSON: { getters: true },
  toObject: { getters: true },
  emitIndexErrors: true,
};

// Grace period after endDate before tier auto-downgrades to STANDARD.
const GRACE_PERIOD_DAYS = 5;

// REFEREE-specific thresholds. Referees officiate free until they hit
// the game count; then a subscription is required. Warning fires at
// REFEREE_WARN_AT_GAMES so they have a chance to subscribe before block.
const REFEREE_FREE_GAME_THRESHOLD = 10;
const REFEREE_WARN_AT_GAMES = 8;

const PLAN_TYPES = ['MONTHLY', 'QUARTERLY', 'BIANNUAL', 'ANNUAL'];
const TIERS = ['STANDARD', 'GOLD', 'PLATINUM', 'ENTERPRISE', 'MINOR', 'ADULT', 'PRO'];
const CURRENCIES = ['TZS', 'USD'];
const PAYMENT_METHODS = [
  'MANUAL', 'SELCOM', 'AZAMPAY', 'MPESA', 'PAYPAL', 'GOOGLE_PAY', 'CARD',
];
const STATUS = ['ACTIVE', 'GRACE', 'EXPIRED', 'PENDING', 'CANCELLED'];

// User types subject to subscription tiers.
const SUBSCRIPTION_ELIGIBLE_TYPES = [
  'PLAYER', 'COACH', 'ACADEMY', 'CLUB', 'AGENT',
  'REFEREE', 'SCOUT', 'VENDOR',
];
// User types excluded from subscriptions entirely.
const NON_SUBSCRIPTION_TYPES = ['GUARDIAN', 'SPONSOR', 'SCHOOL', 'FIELD_OWNER'];

// PRICES[userType][tier][plan][currency]. `null` = plan not offered for tier.
// STANDARD is universally free. Only PLAYER tiers are locked as of 2026-08-09.
const PRICES = {
  PLAYER: {
    STANDARD: {
      MONTHLY:   { TZS: 0, USD: 0 },
      QUARTERLY: { TZS: 0, USD: 0 },
      BIANNUAL:  { TZS: 0, USD: 0 },
    },
    GOLD: {
      MONTHLY:   { TZS: 5000,  USD: null },
      QUARTERLY: { TZS: 10000, USD: null },
      BIANNUAL:  { TZS: 20000, USD: null },
    },
    PLATINUM: {
      MONTHLY:   { TZS: 10000, USD: null },
      QUARTERLY: { TZS: 25000, USD: null },
      BIANNUAL:  { TZS: 40000, USD: null },
    },
  },
  // ACADEMY: three tiers, same shape as COACH but scaled up for the
  // higher-volume org (rosters, trials, tournaments, doc vetting).
  ACADEMY: {
    STANDARD: {
      MONTHLY:   { TZS: 0, USD: 0 },
      QUARTERLY: { TZS: 0, USD: 0 },
      BIANNUAL:  { TZS: 0, USD: 0 },
    },
    GOLD: {
      MONTHLY:   { TZS: 20000,  USD: null },
      QUARTERLY: { TZS: 50000,  USD: null },
      BIANNUAL:  { TZS: 100000, USD: null },
    },
    PLATINUM: {
      MONTHLY:   { TZS: 50000,  USD: null },
      QUARTERLY: { TZS: 120000, USD: null },
      BIANNUAL:  { TZS: 200000, USD: null },
    },
  },
  // CLUB: three tiers. Unlike PLAYER/COACH/ACADEMY, CLUB Standard is
  // PAID from day 1 (professional org). 30-day auto-Gold trial still
  // applies for onboarding — after that, no tier is free.
  CLUB: {
    STANDARD: {
      MONTHLY:   { TZS: 20000,  USD: null },
      QUARTERLY: { TZS: 50000,  USD: null },
      BIANNUAL:  { TZS: 100000, USD: null },
    },
    GOLD: {
      MONTHLY:   { TZS: 50000,  USD: null },
      QUARTERLY: { TZS: 120000, USD: null },
      BIANNUAL:  { TZS: 200000, USD: null },
    },
    PLATINUM: {
      MONTHLY:   { TZS: 100000, USD: null },
      QUARTERLY: { TZS: 250000, USD: null },
      BIANNUAL:  { TZS: 500000, USD: null },
    },
  },
  // Other eligible types: pricing not yet locked. STANDARD free floor only.
  COACH: {
    STANDARD: {
      MONTHLY:   { TZS: 0, USD: 0 },
      QUARTERLY: { TZS: 0, USD: 0 },
      BIANNUAL:  { TZS: 0, USD: 0 },
    },
    GOLD: {
      MONTHLY:   { TZS: 5000,  USD: null },
      QUARTERLY: { TZS: 10000, USD: null },
      BIANNUAL:  { TZS: 20000, USD: null },
    },
    PLATINUM: {
      MONTHLY:   { TZS: 10000, USD: null },
      QUARTERLY: { TZS: 25000, USD: null },
      BIANNUAL:  { TZS: 40000, USD: null },
    },
  },
  // AGENT: two paid tiers only. Standard exists on the enum as the
  // "locked out" state after trial expires — it grants nothing. Gold
  // is the standard paid tier. Enterprise pricing is null everywhere
  // (contact-us / negotiated per account, admin sets amount manually).
  AGENT: {
    STANDARD: {
      MONTHLY:   { TZS: 0, USD: 0 },
      QUARTERLY: { TZS: 0, USD: 0 },
      BIANNUAL:  { TZS: 0, USD: 0 },
    },
    GOLD: {
      MONTHLY:   { TZS: 100000, USD: null },
      QUARTERLY: { TZS: 250000, USD: null },
      BIANNUAL:  { TZS: 500000, USD: null },
    },
    ENTERPRISE: {
      MONTHLY:   { TZS: null, USD: null },
      QUARTERLY: { TZS: null, USD: null },
      BIANNUAL:  { TZS: null, USD: null },
    },
  },
  // SCOUT: single PRO tier. No free STANDARD — an unsubscribed scout
  // cannot be selected for official work, cannot evaluate players, and
  // cannot file reports.
  SCOUT: {
    PRO: {
      MONTHLY:   { TZS: 10000, USD: null },
      QUARTERLY: { TZS: 25000, USD: null },
      BIANNUAL:  { TZS: 40000, USD: null },
    },
  },
  // VENDOR: four paid tiers. Key differentiator is ad space + reach.
  // Enterprise pricing is negotiated (nulls; admin sets amount on activation).
  VENDOR: {
    STANDARD: {
      MONTHLY:   { TZS: 30000,   USD: null },
      QUARTERLY: { TZS: 75000,   USD: null },
      BIANNUAL:  { TZS: 150000,  USD: null },
    },
    GOLD: {
      MONTHLY:   { TZS: 100000,  USD: null },
      QUARTERLY: { TZS: 250000,  USD: null },
      BIANNUAL:  { TZS: 500000,  USD: null },
    },
    PLATINUM: {
      MONTHLY:   { TZS: 300000,  USD: null },
      QUARTERLY: { TZS: 750000,  USD: null },
      BIANNUAL:  { TZS: 1500000, USD: null },
    },
    ENTERPRISE: {
      MONTHLY:   { TZS: null, USD: null },
      QUARTERLY: { TZS: null, USD: null },
      BIANNUAL:  { TZS: null, USD: null },
    },
  },
  // REFEREE: two age-based tiers. Server auto-picks MINOR vs ADULT from
  // user.dob at subscribe time; user does not choose. There is no free
  // STANDARD tier here — free access is granted via the game-count
  // free-trial (see REFEREE_FREE_GAME_THRESHOLD) rather than as a tier.
  REFEREE: {
    MINOR: {
      MONTHLY:   { TZS: 5000,  USD: null },
      QUARTERLY: { TZS: 10000, USD: null },
    },
    ADULT: {
      MONTHLY:   { TZS: 10000, USD: null },
      QUARTERLY: { TZS: 25000, USD: null },
      BIANNUAL:  { TZS: 40000, USD: null },
    },
  },
};

// Feature caps per userType/tier. `null` = unlimited (with any fair-use
// caps applied at the endpoint). Only PLAYER is locked; other types will
// be filled in as their tier plans are defined.
const FEATURE_CAPS = {
  PLAYER: {
    STANDARD: {
      ai: 0,
      reportsPerMonth: 1,
      evaluationsReceivedPerMonth: 1,
      evaluationsShareWithPlayer: false,
      evaluationRequestsInitiatedPerMonth: 0,
      canJoinChallenges: false,
    },
    GOLD: {
      ai: 100,
      reportsPerMonth: 5,
      evaluationsReceivedPerMonth: 10,
      evaluationsShareWithPlayer: true,
      evaluationRequestsInitiatedPerMonth: 2,
      canJoinChallenges: true,
    },
    PLATINUM: {
      ai: null, // unlimited with fair-use
      aiFairUsePerHour: 30,
      aiFairUsePerDay: 300,
      reportsPerMonth: null,
      evaluationsReceivedPerMonth: null,
      evaluationsShareWithPlayer: true,
      evaluationRequestsInitiatedPerMonth: null,
      canJoinChallenges: true,
    },
  },
  // REFEREE tiers only gate one thing: match-assignment eligibility. Both
  // MINOR and ADULT unlock the same behaviour — the tier controls pricing,
  // not features.
  REFEREE: {
    MINOR: { matchAssignmentEligible: true },
    ADULT: { matchAssignmentEligible: true },
  },
  // SCOUT: PRO tier unlocks three things simultaneously — being pickable
  // for official scouting work, performing player evaluations, and filing
  // scout reports. All are gated together (no partial subscription).
  SCOUT: {
    PRO: {
      scoutAssignmentEligible: true,
      canEvaluatePlayers: true,
      canSubmitScoutReports: true,
    },
  },
  // ACADEMY: three tiers. Standard restricts roster composition to a
  // single age level + single gender. Gold opens 3 age levels + mixed
  // gender + trials/tournaments/scouting. Platinum unlocks everything
  // (nation-wide reach, featured placement, advanced analytics, monthly
  // academy report, doc-vetting included).
  ACADEMY: {
    STANDARD: {
      ai: 30,
      reportsGeneratedPerMonth: 0,
      playerReportQueriesPerMonth: 0,
      homeFeedPostsPerMonth: 5,
      canPostTrials: false,
      canRequestScouting: false,
      canCreateTournaments: false,
      canAddScoutsToOwnMatches: false,
      canPerformOfficialScouting: false,
      maxTournamentTeams: 0,
      maxTeamBasedTrialTeams: 0,
      maxAgeLevels: 1,
      mixedGender: false,
      docVettingIncluded: false,
      advancedAnalytics: false,
      monthlyAcademyReport: false,
      featuredPlacement: false,
      reachScope: 'REGIONAL',
      staffSeats: 0,
    },
    GOLD: {
      ai: 200,
      reportsGeneratedPerMonth: 10,
      playerReportQueriesPerMonth: 20,
      homeFeedPostsPerMonth: 25,
      canPostTrials: true,
      canRequestScouting: true,
      canCreateTournaments: true,
      canAddScoutsToOwnMatches: true,
      canPerformOfficialScouting: false,
      maxTournamentTeams: 8,
      maxTeamBasedTrialTeams: 8,
      maxAgeLevels: 3,
      mixedGender: true,
      docVettingIncluded: false,
      advancedAnalytics: false,
      staffSeats: 3,
      canPostClinics: true,
      monthlyAcademyReport: false,
      featuredPlacement: false,
      reachScope: 'REGIONAL',
    },
    PLATINUM: {
      ai: null,
      aiFairUsePerHour: 30,
      aiFairUsePerDay: 300,
      reportsGeneratedPerMonth: null,
      playerReportQueriesPerMonth: null,
      homeFeedPostsPerMonth: null,
      canPostTrials: true,
      canRequestScouting: true,
      canCreateTournaments: true,
      canAddScoutsToOwnMatches: true,
      canPerformOfficialScouting: false,
      maxTournamentTeams: null,
      maxTeamBasedTrialTeams: null,
      maxAgeLevels: null,
      mixedGender: true,
      docVettingIncluded: true,
      advancedAnalytics: true,
      monthlyAcademyReport: true,
      featuredPlacement: true,
      reachScope: 'NATIONAL',
      staffSeats: 5,
      canPostClinics: true,
    },
  },
  // CLUB: mirrors ACADEMY caps for the initial launch. Deltas will be
  // introduced as CLUB-specific features (transfer market, official
  // league standings, etc.) are defined.
  CLUB: {
    STANDARD: {
      ai: 30,
      reportsGeneratedPerMonth: 0,
      playerReportQueriesPerMonth: 0,
      homeFeedPostsPerMonth: 5,
      canPostTrials: false,
      canRequestScouting: false,
      canCreateTournaments: false,
      canAddScoutsToOwnMatches: false,
      canPerformOfficialScouting: false,
      maxTournamentTeams: 0,
      maxTeamBasedTrialTeams: 0,
      maxAgeLevels: 1,
      mixedGender: false,
      docVettingIncluded: false,
      advancedAnalytics: false,
      monthlyClubReport: false,
      featuredPlacement: false,
      reachScope: 'REGIONAL',
      staffSeats: 0,
    },
    GOLD: {
      ai: 200,
      reportsGeneratedPerMonth: 10,
      playerReportQueriesPerMonth: 20,
      homeFeedPostsPerMonth: 25,
      canPostTrials: true,
      canRequestScouting: true,
      canCreateTournaments: true,
      canAddScoutsToOwnMatches: true,
      canPerformOfficialScouting: false,
      maxTournamentTeams: 8,
      maxTeamBasedTrialTeams: 8,
      maxAgeLevels: 3,
      mixedGender: true,
      docVettingIncluded: false,
      advancedAnalytics: false,
      monthlyClubReport: false,
      featuredPlacement: false,
      reachScope: 'REGIONAL',
      staffSeats: 3,
      canPostClinics: true,
    },
    PLATINUM: {
      ai: null,
      aiFairUsePerHour: 30,
      aiFairUsePerDay: 300,
      reportsGeneratedPerMonth: null,
      playerReportQueriesPerMonth: null,
      homeFeedPostsPerMonth: null,
      canPostTrials: true,
      canRequestScouting: true,
      canCreateTournaments: true,
      canAddScoutsToOwnMatches: true,
      canPerformOfficialScouting: false,
      maxTournamentTeams: null,
      maxTeamBasedTrialTeams: null,
      maxAgeLevels: null,
      mixedGender: true,
      docVettingIncluded: true,
      advancedAnalytics: true,
      monthlyClubReport: true,
      featuredPlacement: true,
      reachScope: 'NATIONAL',
      staffSeats: 5,
      canPostClinics: true,
    },
  },
  // AGENT: two-tier model. Standard = locked-out state (post-trial,
  // pre-subscription). Gold = paying agent with player reports +
  // evaluations + trials + analysis. Enterprise = customised reports,
  // priority, unlimited everything (negotiated per account).
  AGENT: {
    STANDARD: {
      ai: 0,
      reportsGeneratedPerMonth: 0,
      playerReportQueriesPerMonth: 0,
      homeFeedPostsPerMonth: 0,
      canPostTrials: false,
      canRequestScouting: false,
      canViewPlayerEvaluations: false,
      canGeneratePlayerReport: false,
      canGenerateTeamReport: false,
      canGenerateMarketReport: false,
      canGenerateCustomAnalysis: false,
      advancedAnalytics: false,
      reachScope: 'REGIONAL',
    },
    GOLD: {
      ai: 200,
      reportsGeneratedPerMonth: 10,
      playerReportQueriesPerMonth: 20,
      homeFeedPostsPerMonth: 25,
      canPostTrials: true,
      canRequestScouting: true,
      canViewPlayerEvaluations: true,
      canGeneratePlayerReport: true,
      canGenerateTeamReport: false,
      canGenerateMarketReport: false,
      canGenerateCustomAnalysis: false,
      advancedAnalytics: false,
      reachScope: 'REGIONAL',
    },
    ENTERPRISE: {
      ai: null,
      aiFairUsePerHour: 30,
      aiFairUsePerDay: 300,
      reportsGeneratedPerMonth: null,
      playerReportQueriesPerMonth: null,
      homeFeedPostsPerMonth: null,
      canPostTrials: true,
      canRequestScouting: true,
      canViewPlayerEvaluations: true,
      canGeneratePlayerReport: true,
      canGenerateTeamReport: true,
      canGenerateMarketReport: true,
      canGenerateCustomAnalysis: true,
      advancedAnalytics: true,
      monthlyAgentReport: true,
      featuredPlacement: true,
      reachScope: 'NATIONAL',
    },
  },
  // COACH: three tiers with meaningful spread. Standard = free onboarding
  // (also acts as a 30-day auto-Gold trial from account creation).
  // Gold = paying coach — can post trials/tournaments, run player reports,
  // and their Coach account satisfies the "official scouting" gate.
  // Platinum = premium — nation-wide reach, featured placement, advanced
  // analytics, and access to Team + Market shortlist reports.
  COACH: {
    STANDARD: {
      ai: 30,
      reportsGeneratedPerMonth: 0,
      playerReportQueriesPerMonth: 0,
      canPerformOfficialScouting: false,
      canCreateTrials: false,
      canCreateTournaments: false,
      canAddScoutsToOwnMatches: false,
      canUsePlayerRequests: false,
      canGeneratePlayerReport: false,
      canGenerateTeamReport: false,
      canGenerateMarketReport: false,
      maxTournamentTeams: 0,
      maxManagedTeams: 1,
      featuredPlacement: false,
      advancedAnalytics: false,
      reachScope: 'REGIONAL',
    },
    GOLD: {
      ai: 200,
      reportsGeneratedPerMonth: 10,
      playerReportQueriesPerMonth: 20,
      canPerformOfficialScouting: true,
      canCreateTrials: true,
      canPostClinics: true,
      canCreateTournaments: true,
      canAddScoutsToOwnMatches: true,
      canUsePlayerRequests: true,
      canGeneratePlayerReport: true,
      canGenerateTeamReport: false,
      canGenerateMarketReport: false,
      maxTournamentTeams: 8,
      maxManagedTeams: 1,
      featuredPlacement: false,
      advancedAnalytics: false,
      reachScope: 'REGIONAL',
    },
    PLATINUM: {
      ai: null,
      aiFairUsePerHour: 30,
      aiFairUsePerDay: 300,
      reportsGeneratedPerMonth: null,
      playerReportQueriesPerMonth: null,
      canPerformOfficialScouting: true,
      canCreateTrials: true,
      canPostClinics: true,
      canCreateTournaments: true,
      canAddScoutsToOwnMatches: true,
      canUsePlayerRequests: true,
      canGeneratePlayerReport: true,
      canGenerateTeamReport: true,
      canGenerateMarketReport: true,
      maxTournamentTeams: null,
      maxManagedTeams: null,
      featuredPlacement: true,
      advancedAnalytics: true,
      reachScope: 'NATIONAL',
    },
  },
  // VENDOR: four tiers. Ad space + reach is the differentiator. Enterprise
  // adds broadcast-to-all + guaranteed Sokasoko house-account slots.
  // Product-listings and promo-slot caps are Vendor-specific — the
  // consumers (advert routes, product listings) may not exist yet for
  // some fields; caps stand and enforcement will follow when endpoints ship.
  VENDOR: {
    STANDARD: {
      ai: 30,
      productListings: 5,
      promoSlotsPerMonth: 2,
      homeFeedPostsPerMonth: 5,
      flashSalesPerMonth: 0,
      adInHomeFeed: false,
      featuredInVendorDirectory: false,
      analyticsLevel: 'BASIC',       // BASIC | ADVANCED | ADVANCED_EXPORT
      canBroadcastToAll: false,
      sokasokoAccountSlot: 'NONE',   // NONE | PRIORITY | GUARANTEED
      reachScope: 'LOCAL',           // LOCAL | REGIONAL | NATIONAL
      featuredPlacement: false,
    },
    GOLD: {
      ai: 100,
      productListings: 25,
      promoSlotsPerMonth: 5,
      homeFeedPostsPerMonth: 25,
      flashSalesPerMonth: 1,
      adInHomeFeed: true,
      featuredInVendorDirectory: false,
      analyticsLevel: 'BASIC',
      canBroadcastToAll: false,
      sokasokoAccountSlot: 'NONE',
      reachScope: 'REGIONAL',
      featuredPlacement: false,
    },
    PLATINUM: {
      ai: 300,
      productListings: 100,
      promoSlotsPerMonth: 15,
      homeFeedPostsPerMonth: 75,
      flashSalesPerMonth: 4,
      adInHomeFeed: true,
      featuredInVendorDirectory: true,
      analyticsLevel: 'ADVANCED',
      canBroadcastToAll: false,
      sokasokoAccountSlot: 'PRIORITY',
      reachScope: 'NATIONAL',
      featuredPlacement: true,
      canPostClinics: true,
    },
    ENTERPRISE: {
      ai: null,
      aiFairUsePerHour: 30,
      aiFairUsePerDay: 300,
      productListings: null,
      promoSlotsPerMonth: null,
      homeFeedPostsPerMonth: null,
      flashSalesPerMonth: null,
      adInHomeFeed: true,
      featuredInVendorDirectory: true,
      analyticsLevel: 'ADVANCED_EXPORT',
      canBroadcastToAll: true,
      sokasokoAccountSlot: 'GUARANTEED',
      reachScope: 'NATIONAL',
      featuredPlacement: true,
      canPostClinics: true,
    },
  },
  // SCHOOL: not subscription-eligible, but a fixed budget of delegated
  // sports-teacher seats is bundled with every school by fiat. Each of
  // those seats runs at COACH GOLD tier (see resolveDelegatedTier).
  SCHOOL: {
    FREE: {
      ai: 30,
      canPostTrials: false,
      canCreateTournaments: false,
      canAddScoutsToOwnMatches: false,
      staffSeats: 3,
    },
  },
  // GUARDIAN: not subscription-eligible. These are the free-tier caps that
  // apply to any GUARDIAN not currently a linked staff of an org.
  GUARDIAN: {
    FREE: {
      ai: 30,
      maxMinors: 15,
      maxRefereeMinors: 5,
      canPostTrials: false,
      canScheduleMatches: false,
      playerReportQueriesOwnMinorsOnly: true,
      canGeneratePlayerReport: true,
      canGenerateTeamReport: false,
      canGenerateMarketReport: false,
      canGenerateCustomAnalysis: false,
      canPerformOfficialScouting: false,
    },
  },
};

// COACH / ACADEMY onboarding trial: first N days from account creation
// grant the Standard user an auto-Gold experience so they can build a
// roster and evaluate the platform before the paywall kicks in.
const COACH_TRIAL_DAYS = 30;
const ACADEMY_TRIAL_DAYS = 30;
const CLUB_TRIAL_DAYS = 30;
const AGENT_TRIAL_DAYS = 30;
const VENDOR_TRIAL_DAYS = 30;

// Free promotion video slots per month per user type (legacy VENDOR feature).
const FREE_PROMO_SLOTS = {
  PLAYER: 0,
  SCOUT:  0,
  VENDOR: 2,
};

const SubscriptionSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'user is required'],
      index: true,
    },
    userType: {
      type: String,
      enum: SUBSCRIPTION_ELIGIBLE_TYPES,
      required: [true, 'userType is required'],
      index: true,
    },
    tier: {
      type: String,
      enum: TIERS,
      default: 'STANDARD',
      index: true,
    },
    plan: {
      type: String,
      enum: PLAN_TYPES,
      required: [true, 'plan is required'],
    },
    currency: {
      type: String,
      enum: CURRENCIES,
      default: 'TZS',
    },
    amount: {
      type: Number,
      required: [true, 'amount is required'],
    },
    paymentMethod: {
      type: String,
      enum: PAYMENT_METHODS,
      default: 'MANUAL',
    },
    status: {
      type: String,
      enum: STATUS,
      default: 'PENDING',
      index: true,
    },
    startDate: {
      type: Date,
      default: null,
    },
    endDate: {
      type: Date,
      default: null,
      index: true,
    },
    gracePeriodEndsAt: {
      type: Date,
      default: null,
    },
    activatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    activatedAt: {
      type: Date,
      default: null,
    },
    notes: {
      type: String,
      trim: true,
    },
    transactionId: {
      type: String,
      trim: true,
    },
    promoSlotsUsed: {
      type: Number,
      default: 0,
    },
    promoSlotsTotal: {
      type: Number,
      default: 0,
    },
  },
  SCHEMA_OPTIONS
);

// Auto-set amount from price table if not provided.
SubscriptionSchema.pre('save', function (next) {
  if (this.amount == null && this.userType && this.tier && this.plan && this.currency) {
    const price = PRICES[this.userType]?.[this.tier]?.[this.plan]?.[this.currency];
    if (price != null) this.amount = price;
  }
  next();
});

// Activate a subscription: set dates based on plan.
SubscriptionSchema.methods.activate = function (adminUserId) {
  const now = new Date();
  this.status = 'ACTIVE';
  this.startDate = now;
  this.activatedBy = adminUserId;
  this.activatedAt = now;
  this.promoSlotsTotal = FREE_PROMO_SLOTS[this.userType] || 0;
  this.promoSlotsUsed = 0;

  const end = new Date(now);
  if (this.plan === 'MONTHLY')   end.setMonth(end.getMonth() + 1);
  if (this.plan === 'QUARTERLY') end.setMonth(end.getMonth() + 3);
  if (this.plan === 'BIANNUAL')  end.setMonth(end.getMonth() + 6);
  if (this.plan === 'ANNUAL')    end.setFullYear(end.getFullYear() + 1);
  this.endDate = end;
  this.gracePeriodEndsAt = new Date(end.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);

  return this.save();
};

// True if the subscription is currently ACTIVE or within grace period.
SubscriptionSchema.methods.isActive = function () {
  if (this.status === 'ACTIVE' && this.endDate > new Date()) return true;
  if (this.status === 'GRACE' && this.gracePeriodEndsAt > new Date()) return true;
  return false;
};

SubscriptionSchema.methods.hasPromoSlots = function () {
  return this.promoSlotsUsed < this.promoSlotsTotal;
};

SubscriptionSchema.methods.usePromoSlot = function () {
  if (!this.hasPromoSlots()) return false;
  this.promoSlotsUsed += 1;
  this.save();
  return true;
};

// Any ACTIVE-or-GRACE subscription counts as subscribed.
SubscriptionSchema.statics.isUserSubscribed = async function (userId) {
  const sub = await this.findOne({
    user: userId,
    status: { $in: ['ACTIVE', 'GRACE'] },
  });
  if (!sub) return false;
  return sub.isActive();
};

// Prefer the highest-tier active (or grace) subscription.
SubscriptionSchema.statics.getActiveSubscription = async function (userId) {
  const subs = await this.find({
    user: userId,
    status: { $in: ['ACTIVE', 'GRACE'] },
  });
  const alive = subs.filter((s) => s.isActive());
  if (alive.length === 0) return null;
  const weight = { PLATINUM: 3, GOLD: 2, STANDARD: 1, ENTERPRISE: 4 };
  alive.sort((a, b) => (weight[b.tier] || 0) - (weight[a.tier] || 0));
  return alive[0];
};

// Resolve the tier a user is currently entitled to.
// Returns 'STANDARD' for eligible types with no paid subscription,
// 'FREE' for non-subscription types (GUARDIAN/SPONSOR/SCHOOL).
// Special case: COACH accounts younger than COACH_TRIAL_DAYS get
// promoted to GOLD for the onboarding period even if unsubscribed.
SubscriptionSchema.statics.getEffectiveTier = async function (userId, userType) {
  if (NON_SUBSCRIPTION_TYPES.includes(userType)) return 'FREE';
  if (!SUBSCRIPTION_ELIGIBLE_TYPES.includes(userType)) return 'FREE';
  const sub = await this.getActiveSubscription(userId);
  if (sub) return sub.tier;
  // COACH / ACADEMY / CLUB / AGENT auto-Gold onboarding trial. AGENT falls
  // to STANDARD (locked-out) once the trial expires — there's no free
  // fallback tier that grants features.
  const trialTypes = {
    COACH:   COACH_TRIAL_DAYS,
    ACADEMY: ACADEMY_TRIAL_DAYS,
    CLUB:    CLUB_TRIAL_DAYS,
    AGENT:   AGENT_TRIAL_DAYS,
    VENDOR:  VENDOR_TRIAL_DAYS,
  };
  if (trialTypes[userType]) {
    try {
      const User = mongoose.model('User');
      const u = await User.findById(userId).select('createdAt').lean();
      if (u && u.createdAt) {
        const ageDays = (Date.now() - new Date(u.createdAt).getTime())
          / (24 * 60 * 60 * 1000);
        if (ageDays < trialTypes[userType]) return 'GOLD';
      }
    } catch (_) { /* fall through */ }
  }
  return 'STANDARD';
};

// True if this user is authorised to do OFFICIAL scouting work — either
// as a paid PRO scout OR as a Gold/Platinum coach (coaches double as
// scouts once they pay). Used by scout-picker + match creation gates.
SubscriptionSchema.statics.canPerformOfficialScouting = async function (userId) {
  const User = mongoose.model('User');
  const u = await User.findById(userId).select('type').lean();
  if (!u) return false;
  if (u.type === 'SCOUT') {
    const sub = await this.getActiveSubscription(userId);
    return !!sub && sub.tier === 'PRO';
  }
  if (u.type === 'COACH') {
    const tier = await this.getEffectiveTier(userId, 'COACH');
    return tier === 'GOLD' || tier === 'PLATINUM';
  }
  return false;
};

// Vendor eligibility snapshot — subscribed=true when on any paid tier
// (Standard is paid too for VENDOR).
SubscriptionSchema.statics.getVendorEligibility = async function (userId) {
  const User = mongoose.model('User');
  const [user, sub, tier] = await Promise.all([
    User.findById(userId).select('createdAt').lean(),
    this.getActiveSubscription(userId),
    this.getEffectiveTier(userId, 'VENDOR'),
  ]);
  const subscribed = !!sub && ['STANDARD', 'GOLD', 'PLATINUM', 'ENTERPRISE'].includes(sub.tier);
  let trialActive = false;
  let trialEndsAt = null;
  if (!subscribed && user?.createdAt) {
    trialEndsAt = new Date(new Date(user.createdAt).getTime()
      + VENDOR_TRIAL_DAYS * 24 * 60 * 60 * 1000);
    trialActive = trialEndsAt > new Date();
  }
  return {
    tier,
    subscribed,
    subscription: sub || null,
    trialActive,
    trialEndsAt,
    trialDays: VENDOR_TRIAL_DAYS,
  };
};

// Agent eligibility snapshot — subscribed=true only for GOLD or ENTERPRISE.
SubscriptionSchema.statics.getAgentEligibility = async function (userId) {
  const User = mongoose.model('User');
  const [user, sub, tier] = await Promise.all([
    User.findById(userId).select('createdAt').lean(),
    this.getActiveSubscription(userId),
    this.getEffectiveTier(userId, 'AGENT'),
  ]);
  const subscribed = !!sub && ['GOLD', 'ENTERPRISE'].includes(sub.tier);
  let trialActive = false;
  let trialEndsAt = null;
  if (!subscribed && user?.createdAt) {
    trialEndsAt = new Date(new Date(user.createdAt).getTime()
      + AGENT_TRIAL_DAYS * 24 * 60 * 60 * 1000);
    trialActive = trialEndsAt > new Date();
  }
  return {
    tier,
    subscribed,
    subscription: sub || null,
    trialActive,
    trialEndsAt,
    trialDays: AGENT_TRIAL_DAYS,
  };
};

// Club eligibility snapshot — mirrors the academy helper.
SubscriptionSchema.statics.getClubEligibility = async function (userId) {
  const User = mongoose.model('User');
  const [user, sub, tier] = await Promise.all([
    User.findById(userId).select('createdAt').lean(),
    this.getActiveSubscription(userId),
    this.getEffectiveTier(userId, 'CLUB'),
  ]);
  const subscribed = !!sub && ['STANDARD', 'GOLD', 'PLATINUM'].includes(sub.tier);
  let trialActive = false;
  let trialEndsAt = null;
  if (!subscribed && user?.createdAt) {
    trialEndsAt = new Date(new Date(user.createdAt).getTime()
      + CLUB_TRIAL_DAYS * 24 * 60 * 60 * 1000);
    trialActive = trialEndsAt > new Date();
  }
  return {
    tier,
    subscribed,
    subscription: sub || null,
    trialActive,
    trialEndsAt,
    trialDays: CLUB_TRIAL_DAYS,
  };
};

// Academy eligibility snapshot — mirrors the coach helper.
SubscriptionSchema.statics.getAcademyEligibility = async function (userId) {
  const User = mongoose.model('User');
  const [user, sub, tier] = await Promise.all([
    User.findById(userId).select('createdAt').lean(),
    this.getActiveSubscription(userId),
    this.getEffectiveTier(userId, 'ACADEMY'),
  ]);
  const subscribed = !!sub && ['GOLD', 'PLATINUM'].includes(sub.tier);
  let trialActive = false;
  let trialEndsAt = null;
  if (!subscribed && user?.createdAt) {
    trialEndsAt = new Date(new Date(user.createdAt).getTime()
      + ACADEMY_TRIAL_DAYS * 24 * 60 * 60 * 1000);
    trialActive = trialEndsAt > new Date();
  }
  return {
    tier,
    subscribed,
    subscription: sub || null,
    trialActive,
    trialEndsAt,
    trialDays: ACADEMY_TRIAL_DAYS,
  };
};

// Coach eligibility snapshot for the mobile subscription screen.
SubscriptionSchema.statics.getCoachEligibility = async function (userId) {
  const User = mongoose.model('User');
  const [user, sub, tier] = await Promise.all([
    User.findById(userId).select('createdAt').lean(),
    this.getActiveSubscription(userId),
    this.getEffectiveTier(userId, 'COACH'),
  ]);
  const subscribed = !!sub && ['GOLD', 'PLATINUM'].includes(sub.tier);
  let trialActive = false;
  let trialEndsAt = null;
  if (!subscribed && user?.createdAt) {
    trialEndsAt = new Date(new Date(user.createdAt).getTime()
      + COACH_TRIAL_DAYS * 24 * 60 * 60 * 1000);
    trialActive = trialEndsAt > new Date();
  }
  return {
    tier,               // effective tier including trial promotion
    subscribed,
    subscription: sub || null,
    trialActive,
    trialEndsAt,
    trialDays: COACH_TRIAL_DAYS,
  };
};

// Convenience: look up the cap dict for a user type + tier.
SubscriptionSchema.statics.getFeatureCaps = function (userType, tier) {
  return FEATURE_CAPS[userType]?.[tier] || null;
};

// Delegation: if the caller is an ACTIVE staff link of an org, return
// { org, orgType, orgTier, role, caps } — the "effective" tier + caps
// they inherit. Returns null when not linked (or linked but not ACTIVE).
// School sports teachers inherit COACH GOLD. Academy/Club OWNER/MANAGER/
// COACH inherit the org's own tier. OTHER roles inherit chat-only.
SubscriptionSchema.statics.resolveDelegatedTier = async function (userId) {
  let OrgStaffLink;
  try {
    OrgStaffLink = mongoose.model('OrgStaffLink');
  } catch (_) { return null; }
  const link = await OrgStaffLink.findOne({ staff: userId, status: 'ACTIVE' }).lean();
  if (!link) return null;
  const User = mongoose.model('User');
  const org = await User.findById(link.org).select('type').lean();
  if (!org) return null;
  const orgType = org.type;
  if (link.role === 'SPORTS_TEACHER' && orgType === 'SCHOOL') {
    return {
      org: link.org, orgType, orgTier: 'GOLD', role: link.role,
      caps: FEATURE_CAPS.COACH?.GOLD || null,
      effectiveUserType: 'COACH',
    };
  }
  if (['OWNER', 'MANAGER', 'COACH'].includes(link.role)
      && ['ACADEMY', 'CLUB'].includes(orgType)) {
    const orgTier = await this.getEffectiveTier(link.org, orgType);
    return {
      org: link.org, orgType, orgTier, role: link.role,
      caps: FEATURE_CAPS[orgType]?.[orgTier] || null,
      effectiveUserType: orgType,
    };
  }
  // OTHER role or unmatched combinations — chat-only elevation.
  return {
    org: link.org, orgType, orgTier: null, role: link.role,
    caps: null,
    effectiveUserType: null,
  };
};

// Current ACTIVE staff count for an org (used for seat-quota checks).
SubscriptionSchema.statics.countActiveStaff = async function (orgId) {
  try {
    const OrgStaffLink = mongoose.model('OrgStaffLink');
    return OrgStaffLink.countDocuments({ org: orgId, status: 'ACTIVE' });
  } catch (_) { return 0; }
};

// Effective context for enforcement checks — honours delegation.
// If the caller is a delegated staff with elevated powers, returns the
// org's effective userType + tier + caps (so a school sports teacher
// behaves like COACH GOLD; an academy-linked COACH inherits the academy
// tier). Otherwise falls back to the user's own type + tier.
SubscriptionSchema.statics.getEffectiveContext = async function (userId) {
  const User = mongoose.model('User');
  const u = await User.findById(userId).select('type').lean();
  if (!u) return null;
  const delegated = await this.resolveDelegatedTier(userId);
  if (delegated && delegated.effectiveUserType && delegated.caps) {
    return {
      userType: delegated.effectiveUserType,
      tier: delegated.orgTier,
      caps: delegated.caps,
      delegated: true,
      delegatedFrom: delegated.org,
      delegatedRole: delegated.role,
      actualUserType: u.type,
    };
  }
  const tier = await this.getEffectiveTier(userId, u.type);
  return {
    userType: u.type,
    tier,
    caps: FEATURE_CAPS[u.type]?.[tier] || null,
    delegated: false,
    actualUserType: u.type,
  };
};

// SCOUT eligibility: strict subscription gate — no free trial. Returns
// { eligible, subscribed, subscription }. Used to gate assignment,
// evaluation, and report submission for scouts.
SubscriptionSchema.statics.getScoutEligibility = async function (userId) {
  const sub = await this.getActiveSubscription(userId);
  const subscribed = !!sub && sub.tier === 'PRO';
  return {
    eligible: subscribed,
    subscribed,
    reason: subscribed ? 'SUBSCRIBED' : 'SUBSCRIPTION_REQUIRED',
    subscription: sub || null,
  };
};

// Count matches the referee has officiated (as head ref OR either
// assistant) that reached COMPLETED status.
SubscriptionSchema.statics.getRefereeGameCount = async function (userId) {
  const Match = mongoose.model('Match');
  return Match.countDocuments({
    status: 'COMPLETED',
    $or: [
      { referee: userId },
      { assistantReferee1: userId },
      { assistantReferee2: userId },
    ],
  });
};

// Which age bracket a referee's subscription should use, based on DOB.
// Under 18 → MINOR; 18+ or missing DOB → ADULT (safe default).
SubscriptionSchema.statics.getRefereeAgeBracket = function (dob) {
  if (!dob) return 'ADULT';
  const d = new Date(dob);
  if (isNaN(d.getTime())) return 'ADULT';
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age < 18 ? 'MINOR' : 'ADULT';
};

// Full eligibility snapshot for a referee. Returns:
//   { eligible, reason, gamesOfficiated, subscribed, tier, threshold, warnAt }
SubscriptionSchema.statics.getRefereeEligibility = async function (userId) {
  const [sub, games] = await Promise.all([
    this.getActiveSubscription(userId),
    this.getRefereeGameCount(userId),
  ]);
  const subscribed = !!sub && ['MINOR', 'ADULT'].includes(sub.tier);
  const tier = subscribed ? sub.tier : null;

  if (subscribed) {
    return {
      eligible: true, reason: 'SUBSCRIBED',
      gamesOfficiated: games, subscribed: true, tier,
      threshold: REFEREE_FREE_GAME_THRESHOLD,
      warnAt: REFEREE_WARN_AT_GAMES,
    };
  }
  if (games < REFEREE_FREE_GAME_THRESHOLD) {
    return {
      eligible: true, reason: 'FREE_TRIAL',
      gamesOfficiated: games, subscribed: false, tier: null,
      threshold: REFEREE_FREE_GAME_THRESHOLD,
      warnAt: REFEREE_WARN_AT_GAMES,
    };
  }
  return {
    eligible: false, reason: 'SUBSCRIPTION_REQUIRED',
    gamesOfficiated: games, subscribed: false, tier: null,
    threshold: REFEREE_FREE_GAME_THRESHOLD,
    warnAt: REFEREE_WARN_AT_GAMES,
  };
};

mongoose.plugin(actions);

module.exports = {
  Subscription: model('Subscription', SubscriptionSchema),
  PRICES,
  FEATURE_CAPS,
  PLAN_TYPES,
  TIERS,
  CURRENCIES,
  PAYMENT_METHODS,
  STATUS,
  FREE_PROMO_SLOTS,
  SUBSCRIPTION_ELIGIBLE_TYPES,
  NON_SUBSCRIPTION_TYPES,
  GRACE_PERIOD_DAYS,
  REFEREE_FREE_GAME_THRESHOLD,
  REFEREE_WARN_AT_GAMES,
  COACH_TRIAL_DAYS,
  ACADEMY_TRIAL_DAYS,
  CLUB_TRIAL_DAYS,
  AGENT_TRIAL_DAYS,
  VENDOR_TRIAL_DAYS,
};
