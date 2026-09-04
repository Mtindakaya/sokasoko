const {
  getByIdFor,
  getFor,
  deleteFor,
  Router,
  postFor,
  patchFor,
  putFor,
  schemaFor,
} = require('@lykmapipo/express-rest-actions');
const { getString } = require('@lykmapipo/env');
const _ = require('lodash');
const { requireAdminKey } = require('../middleware/adminAuth');
const { uploadFor } = require('../Utils/uploader');
const Counter = require('../Counter/counter.model');
const { leftFillNum, sendSms, generateHash } = require('../Utils/utils');
const { Subscription } = require('../Subscription/subscription.model');
const mongoose = require('mongoose');
const ProfileView = require('./profile_view.model');
const Media = require('../Media/media.model');
const Advert = require('../Advert/advert.model');

const attachPrimaryVideoUrls = async (users) => {
  const ids = users.map((u) => u._id).filter(Boolean);
  if (ids.length === 0) return users;
  const medias = await Media
    .find({
      type: 'Link',
      $or: [{ player: { $in: ids } }, { createdBy: { $in: ids } }],
    })
    .select('player createdBy url order')
    .sort({ order: 1, createdAt: 1 })
    .lean();
  const byUser = new Map();
  for (const m of medias) {
    const key = (m.player || m.createdBy || '').toString();
    if (key && !byUser.has(key)) byUser.set(key, m.url);
  }
  for (const u of users) {
    const key = u._id && u._id.toString();
    if (key && byUser.has(key)) u.primaryVideoUrl = byUser.get(key);
  }
  return users;
};

const API_VERSION = getString('API_VERSION', '1.0.0');

const PATH_SINGLE = '/users/:id';
const PATH_RESET = '/users/reset/:id';
const PATH_SUSPEND = '/users/suspend/:id';
const PATH_UNSUSPEND = '/users/unsuspend/:id';
const PATH_REMOVE_AGENT = '/users/agent/:id';
const PATH_LIST = '/users';
const PATH_SEARCH = '/users/search';
const PATH_LOGIN = '/users/login';
const PATH_SCHEMA = '/users/schema/';
const PATH_EXPIRING = '/users/expiring';
const PATH_STATUS = '/users/status/:id';

const User = require('./user.model');
const GuardianRequest = require('./guardian_request.model');
const ChatMessage = require('../Chat/chat.model');
const Notification = require('../Notification/notification.model');

const router = new Router({
  version: API_VERSION,
});

const RESTRICTED_FIELDS = [
  'phone', 'email', 'contact_number', 'street',
  'facebook', 'instagram', 'twitter', 'youtube',
  'linkedin', 'agent', 'academy', 'password',
];

const stripRestrictedFields = (user) => {
  const obj = _.isFunction(user.toObject) ? user.toObject() : user;
  RESTRICTED_FIELDS.forEach((field) => { delete obj[field]; });
  return obj;
};

// If the target user is a SPONSOR with isAnonymous=true and the requester
// is not the sponsor themselves, mask identity fields in the outgoing
// payload. Backend data is untouched — we only rewrite what leaves the
// API. Admins can hit the record directly via admin routes.
const anonymizeSponsor = (user, requestingUserId) => {
  if (!user) return user;
  const obj = _.isFunction(user.toObject) ? user.toObject() : user;
  if (obj.type !== 'SPONSOR' || !obj.isAnonymous) return obj;
  if (requestingUserId && String(requestingUserId) === String(obj._id)) return obj;
  return _.assign({}, obj, {
    firstName: 'Anonymous',
    lastName: '',
    middleName: '',
    entity_name: 'Anonymous',
    company_name: 'Anonymous',
    company_title: '',
    company_description: '',
    profileImage: 'https://sokasoko.s3.us-west-2.amazonaws.com/avatar.png',
    region: '',
    district: '',
    ward: '',
    street: '',
    phone: '',
    email: '',
    contact_number: '',
    contact_email: '',
    facebook: '',
    instagram: '',
    twitter: '',
    youtube: '',
    linkedin: '',
    website: '',
  });
};

const canViewFullProfile = async (requestingUserId, targetUser) => {
  if (_.get(targetUser, 'type') !== 'PLAYER') return true;
  if (!requestingUserId) return false;
  const requestingUser = await User.findById(requestingUserId);
  if (!requestingUser) return false;
  if (requestingUser.type !== 'SCOUT') return true;
  const accessStatus = requestingUser.getAccessStatus();
  if (
    accessStatus.status === 'FREE_TRIAL' ||
    accessStatus.status === 'GRACE_PERIOD' ||
    accessStatus.status === 'UNRESTRICTED'
  ) return true;
  const isSubscribed = await Subscription.isUserSubscribed(requestingUserId);
  return isSubscribed;
};

router.get(PATH_SCHEMA, schemaFor({
  getSchema: (query, done) => {
    const jsonSchema = User.jsonSchema();
    return done(null, jsonSchema);
  },
}));

router.get(PATH_EXPIRING, async (request, response) => {
  try {
    const now = new Date();
    const in7Days = new Date(now);
    in7Days.setDate(in7Days.getDate() + 7);
    const fields = 'firstName lastName phone type accountNumber freeTrialEndDate gracePeriodEndDate';

    const expiringSoon = await User.find({
      type: { $in: ['PLAYER', 'SCOUT'] },
      freeTrialEndDate: { $gte: now, $lte: in7Days },
      suspend: { $ne: true },
    }).select(fields);

    const inGracePeriod = await User.find({
      type: { $in: ['PLAYER', 'SCOUT'] },
      freeTrialEndDate: { $lt: now },
      gracePeriodEndDate: { $gte: now },
      suspend: { $ne: true },
    }).select(fields);

    const expired = await User.find({
      type: { $in: ['PLAYER', 'SCOUT'] },
      gracePeriodEndDate: { $lt: now },
      suspend: { $ne: true },
    }).select(fields);

    return response.ok({ expiringSoon, inGracePeriod, expired });
  } catch (err) {
    return response.error(err);
  }
});

router.get(PATH_STATUS, async (request, response) => {
  const { id } = request.params;
  try {
    const user = await User.findById(id);
    if (!user) return response.notFound();
    const accessStatus = user.getAccessStatus();
    return response.status(200).json({ ...accessStatus, type: user.type });
  } catch (err) {
    return response.error(err);
  }
});

router.get(PATH_LIST, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(parseInt(req.query.limit) || 20, 500);
    const filter = { suspend: { $ne: true }, isSystemAgent: { $ne: true } };
    if (req.query.type) filter.type = req.query.type;
    if (req.query.school) filter.school = req.query.school;
    if (req.query.gender) filter.gender = req.query.gender;
    if (req.query.createdBy) {
      // A guardian's roster should include everyone currently under them
      // (new `guardian` field) plus legacy minors created before the
      // guardian-lifecycle rollout (still linked only via `createdBy`,
      // and not yet re-attached to someone else). This handles both
      // legacy minors and minors newly accepted by request.
      const gid = req.query.createdBy;
      filter.$or = [
        { guardian: gid },
        { createdBy: gid, guardian: null },
      ];
    }
    if (req.query.academy) filter.academy = req.query.academy;
    if (req.query.agent) filter.agent = req.query.agent;
    // Exclude orphaned minors from PLAYER/REFEREE lists by default so a
    // guardian's roster instantly reflects removals. Callers who want to
    // see orphans (e.g. admin tools) can pass ?includeOrphaned=1.
    if (
      ['PLAYER', 'REFEREE'].includes(req.query.type) &&
      !req.query.includeOrphaned
    ) {
      filter.guardianOrphaned = { $ne: true };
    }
    if (req.query.position) filter.position = req.query.position;
    if (req.query.foot) filter.foot = req.query.foot;
    if (req.query.education_level) filter.education_level = req.query.education_level;
    if (req.query.region) filter.region = req.query.region;
    if (req.query.district) filter.district = req.query.district;
    if (req.query.ward) filter.ward = req.query.ward;
    if (req.query.street) filter.street = req.query.street;

    // Free-text keyword search. Two surfaces are searched and unioned:
    //   1) bio-shaped fields on the User (short_bio, company_*, etc.)
    //   2) title/description on the user's Adverts (non-expired) and
    //      Media posts — so time-bound content ("Sale on boots today")
    //      is findable without requiring the user to update their bio.
    // Bios change rarely; posts/adverts do the heavy lifting for
    // time-bound discovery and roll off naturally on expiry.
    if (req.query.keyword && String(req.query.keyword).trim()) {
      const kw = String(req.query.keyword).trim();
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = { $regex: escaped, $options: 'i' };

      const bioOr = [
        { short_bio: rx },
        { company_name: rx },
        { company_description: rx },
        { academy_name: rx },
        { academy_description: rx },
        { entity_name: rx },
      ];

      // Pull owner IDs of any matching Advert (still live) and Media
      // post. .distinct returns just the ObjectIds so this stays cheap
      // even on a growing corpus.
      const now = new Date();
      const [advertOwners, mediaOwners] = await Promise.all([
        Advert.distinct('advertiser', {
          $and: [
            { $or: [{ title: rx }, { description: rx }] },
            { $or: [{ endDate: null }, { endDate: { $exists: false } }, { endDate: { $gte: now } }] },
          ],
        }),
        Media.distinct('createdBy', {
          $or: [{ title: rx }, { description: rx }],
        }),
      ]);
      const contentOwnerIds = Array.from(new Set(
        [...advertOwners, ...mediaOwners]
          .filter(Boolean)
          .map((id) => String(id))
      )).map((id) => new mongoose.Types.ObjectId(id));

      const keywordOr = [...bioOr];
      if (contentOwnerIds.length > 0) {
        keywordOr.push({ _id: { $in: contentOwnerIds } });
      }

      if (filter.$or) {
        filter.$and = [{ $or: filter.$or }, { $or: keywordOr }];
        delete filter.$or;
      } else {
        filter.$or = keywordOr;
      }
    }

    // Age group → DOB range. Categories cover both academy age brackets
    // (U9..U20) and the legal-minor/adult split.
    const ageGroup = req.query.ageGroup;
    if (ageGroup) {
      const now = new Date();
      const cutoff = (yearsAgo) => {
        const d = new Date(now);
        d.setFullYear(d.getFullYear() - yearsAgo);
        return d;
      };
      const ranges = {
        U9:    { $gte: cutoff(9)  },
        U11:   { $gte: cutoff(11) },
        U13:   { $gte: cutoff(13) },
        U15:   { $gte: cutoff(15) },
        U17:   { $gte: cutoff(17) },
        MINOR: { $gte: cutoff(18) },
        U20:   { $gte: cutoff(20) },
        ADULT: { $lt:  cutoff(18) },
      };
      if (ranges[ageGroup]) filter.dob = ranges[ageGroup];
    }

    // Anonymous sponsors are undiscoverable in the general list too —
    // even the SPONSOR type-browse view drops them. The sponsor
    // themselves still sees their own row (viewerId escape hatch).
    const requestingUserIdForAnon = req.query.viewerId;
    if (requestingUserIdForAnon) {
      const excludeAnon = { $or: [
        { isAnonymous: { $ne: true } },
        { _id: new mongoose.Types.ObjectId(requestingUserIdForAnon) },
      ] };
      filter.$and = [...(filter.$and || []), excludeAnon];
    } else {
      filter.$and = [...(filter.$and || []), { isAnonymous: { $ne: true } }];
    }

    const [data, total] = await Promise.all([
      User.find(filter)
        .select('firstName lastName academy_name company_name entity_name profileImage type accountNumber position sponsor_type vendor_type region tafoca gender school school_class school_jersey_number dob themeColor isAnonymous')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      User.countDocuments(filter),
    ]);

    // Apply sponsor anonymization before we surface the list. Uses the
    // caller's viewerId — the sponsor themselves still sees their real
    // name in their own results.
    const requestingUserId = req.query.viewerId;
    for (let i = 0; i < data.length; i++) {
      data[i] = anonymizeSponsor(data[i], requestingUserId);
    }

    await attachPrimaryVideoUrls(data);

    // Referee results: attach subscription status so the picker can badge
    // subscribed refs and, when asked, surface them first.
    if (req.query.type === 'REFEREE' && data.length) {
      const { Subscription } = require('../Subscription/subscription.model');
      const statuses = await Promise.all(
        data.map(u => Subscription.getActiveSubscription(u._id))
      );
      data.forEach((u, i) => {
        const s = statuses[i];
        u.refereeSubscribed = !!s && ['MINOR', 'ADULT'].includes(s.tier);
      });
      if (req.query.sortBySubscribed === '1' || req.query.sortBySubscribed === 'true') {
        data.sort((a, b) =>
          (b.refereeSubscribed ? 1 : 0) - (a.refereeSubscribed ? 1 : 0));
      }
    }
    // Scout results: attach subscription status. Because unsubscribed
    // scouts cannot be selected for official work at all, pickers can
    // pass `onlySubscribed=1` to filter them out entirely.
    if (req.query.type === 'SCOUT' && data.length) {
      const { Subscription } = require('../Subscription/subscription.model');
      const statuses = await Promise.all(
        data.map(u => Subscription.getActiveSubscription(u._id))
      );
      data.forEach((u, i) => {
        const s = statuses[i];
        u.scoutSubscribed = !!s && s.tier === 'PRO';
      });
      if (req.query.onlySubscribed === '1' || req.query.onlySubscribed === 'true') {
        for (let i = data.length - 1; i >= 0; i--) {
          if (!data[i].scoutSubscribed) data.splice(i, 1);
        }
      }
    }

    // Referee-eligibility filter. When onlyEligible=1 is set, drop refs
    // who cannot officiate right now (free-game threshold + no active
    // subscription). Used by the schedule-match picker so ineligible
    // refs never even appear in the dropdown.
    if (
      req.query.type === 'REFEREE' &&
      data.length &&
      (req.query.onlyEligible === '1' || req.query.onlyEligible === 'true')
    ) {
      const { Subscription } = require('../Subscription/subscription.model');
      const eligibility = await Promise.all(
        data.map(u => Subscription.getRefereeEligibility(u._id))
      );
      for (let i = data.length - 1; i >= 0; i--) {
        if (!eligibility[i]?.eligible) data.splice(i, 1);
      }
    }

    // Time-conflict filter. Pass ?scheduledDate=<iso> (and optionally
    // ?excludeMatchId=<id> when rescheduling) and any user already
    // booked in the relevant window is dropped:
    //   REFEREE / SCOUT → ±2h assignment window
    //   ACADEMY / CLUB / SCHOOL / COACH → team window (-2h / +3h)
    if (req.query.scheduledDate && data.length) {
      const { busyUserIds, busyTeamIds } =
        require('../Match/conflict.helper');
      const ids = data.map(u => u._id);
      const excludeMatchId = req.query.excludeMatchId || null;
      const teamTypes = ['ACADEMY', 'CLUB', 'SCHOOL', 'COACH'];
      let busy;
      if (['REFEREE', 'SCOUT'].includes(req.query.type)) {
        busy = await busyUserIds(ids, req.query.scheduledDate,
          { excludeMatchId });
      } else if (teamTypes.includes(req.query.type)) {
        busy = await busyTeamIds(ids, req.query.scheduledDate,
          { excludeMatchId });
      } else {
        busy = new Set();
      }
      if (busy.size) {
        for (let i = data.length - 1; i >= 0; i--) {
          if (busy.has(String(data[i]._id))) data.splice(i, 1);
        }
      }
    }

    return res.status(200).json({ data, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Type keyword lookup. Lets a plain-text search like "vendor" or "coaches"
// return every user of that type, not just names that happen to contain the
// word. Add singular + plural + common Kiswahili synonyms per row.
const TYPE_KEYWORDS = {
  PLAYER:      ['player', 'players', 'mchezaji', 'wachezaji'],
  COACH:       ['coach', 'coaches', 'mkocha', 'makocha'],
  ACADEMY:     ['academy', 'academies', 'akademia'],
  SCHOOL:      ['school', 'schools', 'shule'],
  CLUB:        ['club', 'clubs', 'timu'],
  VENDOR:      ['vendor', 'vendors', 'muuzaji', 'wauzaji'],
  GUARDIAN:    ['guardian', 'guardians', 'mzazi', 'wazazi'],
  REFEREE:     ['referee', 'referees', 'ref', 'refs', 'mwamuzi', 'waamuzi'],
  AGENT:       ['agent', 'agents', 'wakala', 'mawakala'],
  SPONSOR:     ['sponsor', 'sponsors', 'mfadhili', 'wafadhili'],
  SCOUT:       ['scout', 'scouts', 'skauti'],
  FIELD_OWNER: ['field owner', 'field_owner', 'ground owner'],
  OTHERS:      ['other', 'others'],
};

function typeFromKeyword(text) {
  const q = String(text || '').trim().toLowerCase();
  if (!q) return null;
  for (const [type, aliases] of Object.entries(TYPE_KEYWORDS)) {
    if (aliases.includes(q)) return type;
  }
  return null;
}

router.get(PATH_SEARCH, async (request, response) => {
  const { mquery } = request;
  // The Flutter client sends `?query[text]=…` (via Dio's nested map
  // serializer). express-mquery only parses filter/select/etc., so
  // mquery.filter.text is empty in that case — fall back to the raw
  // request.query.query.text. Keep filter.text lookups too for older
  // callers that use `?filter[text]=…`.
  const query = _.get(mquery, 'filter.text', '')
    || _.get(request, 'query.filter.text', '')
    || _.get(request, 'query.query.text', '')
    || _.get(request, 'query.q', '');
  const requestingUserId = _.get(request, 'query.viewerId');
  const limit = Math.min(parseInt(_.get(request, 'query.limit', '50')), 100);
  // Explicit ?type= wins; otherwise infer a type from the query keyword
  // (e.g. "vendors" → VENDOR) so typing a role name lists every user of
  // that role. Falls back to the regex name/entity match when no keyword
  // hits.
  const explicitType = request.query.type;
  const inferredType = explicitType ? null : typeFromKeyword(query);
  const typeFilter = explicitType
    ? { type: explicitType }
    : (inferredType ? { type: inferredType } : {});

  try {
    const baseFilter = {
      suspend: { $ne: true },
      isSystemAgent: { $ne: true },
      ...typeFilter,
    };

    // Top bar keyword surface: names + bios + owners of any non-expired
    // matching Advert. Media posts are intentionally excluded here —
    // hashtag-on-posts search lives only on the filter modal, so the
    // top bar stays snappy and free of high-volume post noise.
    let contentOwnerIds = [];
    if (!inferredType && query) {
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const advRx = { $regex: escaped, $options: 'i' };
      const now = new Date();
      const advertOwners = await Advert.distinct('advertiser', {
        $and: [
          { $or: [{ title: advRx }, { description: advRx }] },
          { $or: [{ endDate: null }, { endDate: { $exists: false } }, { endDate: { $gte: now } }] },
        ],
      });
      contentOwnerIds = Array.from(new Set(
        advertOwners.filter(Boolean).map((id) => String(id))
      )).map((id) => new mongoose.Types.ObjectId(id));
    }

    // Anonymous sponsors must be undiscoverable — anonymising the
    // outgoing payload isn't enough because the query still matches
    // their real firstName/lastName/entity_name. Drop them from every
    // result unless the caller IS the anonymous sponsor themselves
    // (they still need to find their own account).
    const excludeAnon = requestingUserId
      ? { $or: [
          { isAnonymous: { $ne: true } },
          { _id: new mongoose.Types.ObjectId(requestingUserId) },
        ] }
      : { isAnonymous: { $ne: true } };

    const finalFilter = inferredType
      ? { $and: [baseFilter, excludeAnon] }
      : {
          $and: [
            {
              ...baseFilter,
              $or: [
                { firstName: { $regex: query, $options: 'i' } },
                { lastName: { $regex: query, $options: 'i' } },
                { accountNumber: { $regex: query, $options: 'i' } },
                { academy_name: { $regex: query, $options: 'i' } },
                { company_name: { $regex: query, $options: 'i' } },
                { entity_name: { $regex: query, $options: 'i' } },
                { short_bio: { $regex: query, $options: 'i' } },
                { company_description: { $regex: query, $options: 'i' } },
                { academy_description: { $regex: query, $options: 'i' } },
                ...(contentOwnerIds.length > 0 ? [{ _id: { $in: contentOwnerIds } }] : []),
              ],
            },
            excludeAnon,
          ],
        };
    const data = await User.find(finalFilter)
      .select('firstName lastName academy_name company_name entity_name profileImage type accountNumber position sponsor_type vendor_type region tafoca dob themeColor isAnonymous')
      .limit(limit)
      .lean();

    for (let i = 0; i < data.length; i++) {
      data[i] = anonymizeSponsor(data[i], requestingUserId);
    }

    await attachPrimaryVideoUrls(data);

    return response.ok({ data });
  } catch (error) {
    return response.error(error);
  }
});

// GET /v1/users/eligible-scouts — everyone the platform treats as a scout
// for pickers/dropdowns: registered SCOUT users, plus any user referenced
// as sports_teacher_1 or sports_teacher_2 on a SCHOOL user record. Sports
// teachers are considered de-facto scouts by policy. MUST be registered
// before PATH_SINGLE ('/users/:id') so Express does not try to cast the
// literal 'eligible-scouts' to an ObjectId. Path is written without a
// '/v1' prefix — the versioned Router adds it during mount(); writing
// '/v1/users/...' would double-prefix to '/v1/v1/users/...'.
router.get('/users/eligible-scouts', async (req, res) => {
  try {
    const [scouts, schools] = await Promise.all([
      User.find({ type: 'SCOUT', isSystemAgent: { $ne: true } })
        .select('firstName lastName accountNumber type profileImage costPerGame costPerPlayer')
        .lean(),
      User.find({ type: 'SCHOOL' })
        .select('sports_teacher_1 sports_teacher_2')
        .lean(),
    ]);
    const teacherIds = new Set();
    for (const s of schools) {
      if (s.sports_teacher_1) teacherIds.add(String(s.sports_teacher_1));
      if (s.sports_teacher_2) teacherIds.add(String(s.sports_teacher_2));
    }
    // Defensively restrict sports-teacher pull-in to COACH-typed users only.
    // Schools have occasionally been seen linking a GUARDIAN / PLAYER by
    // data-entry mistake as sports_teacher_1/2, and those shouldn't leak
    // into the scout-picker list.
    const teachers = teacherIds.size === 0
      ? []
      : await User.find({
          _id: { $in: Array.from(teacherIds) },
          type: 'COACH',
        })
          .select('firstName lastName accountNumber type profileImage costPerGame costPerPlayer')
          .lean();
    const byId = new Map();
    for (const u of [...scouts, ...teachers]) {
      byId.set(String(u._id), u);
    }
    const list = Array.from(byId.values());
    // Attach scoutSubscribed on SCOUT entries so the picker can grey out
    // unsubscribed scouts. Sports-teacher (COACH) rows pass through
    // untouched — coaching subscription is separate.
    try {
      const { Subscription } = require('../Subscription/subscription.model');
      const scoutRows = list.filter(u => u.type === 'SCOUT');
      const subs = await Promise.all(
        scoutRows.map(u => Subscription.getActiveSubscription(u._id))
      );
      scoutRows.forEach((u, i) => {
        u.scoutSubscribed = !!subs[i] && subs[i].tier === 'PRO';
      });
    } catch (_) { /* enrichment is best-effort */ }

    let finalList = list;
    // Drop unsubscribed scouts entirely when the schedule-match picker
    // asks for onlyEligible=1 — coaches double as scouts once they pay,
    // so we defer to canPerformOfficialScouting for the final call.
    if (req.query.onlyEligible === '1' || req.query.onlyEligible === 'true') {
      const { Subscription } = require('../Subscription/subscription.model');
      const eligible = await Promise.all(
        finalList.map((u) => Subscription.canPerformOfficialScouting(u._id))
      );
      finalList = finalList.filter((_, i) => eligible[i]);
    }
    // Time-conflict filter — same ±2h window as ref/scout POST reject.
    if (req.query.scheduledDate && finalList.length) {
      const { busyUserIds } = require('../Match/conflict.helper');
      const ids = finalList.map((u) => u._id);
      const excludeMatchId = req.query.excludeMatchId || null;
      const busy = await busyUserIds(ids, req.query.scheduledDate,
        { excludeMatchId });
      if (busy.size) {
        finalList = finalList.filter((u) => !busy.has(String(u._id)));
      }
    }
    return res.status(200).json({ data: finalList });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get(PATH_SINGLE, getByIdFor({
  getById: async (options, done) => {
    const id = _.get(options, 'id');
    const requestingUserId = _.get(options, 'query.viewerId');
    // populate('academy') — without this the profile vCard renders
    // every player as "Free Agent" because Flutter's User.fromJson
    // only recognises the field when it comes back as a nested doc,
    // not as the bare ObjectId that findById() returns by default.
    User.findById(id).populate('academy').exec(async (err, user) => {
      if (err) return done(err, null);
      if (!user) return done(null, null);
      const canView = await canViewFullProfile(requestingUserId, user);
      // Track profile view (fire and forget)
      if (requestingUserId && requestingUserId !== id) {
        User.findById(requestingUserId).then(viewer => {
          if (viewer) {
            ProfileView.create({ profile: id, viewer: requestingUserId, viewerType: viewer.type });
          }
        }).catch(() => {});
      }
      if (!canView) return done(null, stripRestrictedFields(user));
      return done(null, anonymizeSponsor(user, requestingUserId));
    });
  },
}));

router.post(PATH_RESET, requireAdminKey, postFor({
  post: async (options, done) => {
    try {
      const id = _.get(options, 'params.id');
      const newPassword = _.get(options, 'password');
      if (!newPassword) return done(new Error('New password is required'), null);
      const user = await User.findById(id);
      if (!user) return done(new Error('User not found'), null);
      await user.changePassword(newPassword);
      return done(null, user);
    } catch (e) {
      return done(e, null);
    }
  },
}));

router.post(PATH_SUSPEND, requireAdminKey, postFor({
  post: (options, done) => {
    const id = _.get(options, 'params.id');
    const message = _.get(options, 'message', 'Account Suspended');
    User.findById(id, async (error, user) => {
      if (error) return done(error, null);
      user.suspend = true;
      user.save();
      if (user.phone) {
        await sendSms(
          `Sokasoko Account Suspended due to ${message}`,
          user.phone.replace(user.phone.charAt(0), '255')
        );
      }
      return done(null, user);
    });
  },
}));

router.post(PATH_UNSUSPEND, requireAdminKey, postFor({
  post: (options, done) => {
    const id = _.get(options, 'params.id');
    const message = 'Your Account has been reactivated';
    User.findById(id, async (error, user) => {
      if (error) return done(error, null);
      user.suspend = false;
      user.save();
      if (user.phone) {
        await sendSms(message, user.phone.replace(user.phone.charAt(0), '255'));
      }
      return done(null, user);
    });
  },
}));

router.post(PATH_REMOVE_AGENT, postFor({
  post: (options, done) => {
    const id = _.get(options, 'params.id');
    User.findById(id, async (error, user) => {
      if (error) return done(error, null);
      user.agent = null;
      user.save();
      return done(null, user);
    });
  },
}));

router.post(PATH_LIST, uploadFor(), postFor({
  post: async (body, done) => {
    const userType = _.get(body, 'type', 'PLAYER');
    const phoneRaw = _.get(body, 'phone');

    // GUARDIAN caps — enforce the 15 minors + 5 referee-minors limits.
    // Only fires when a GUARDIAN is creating a PLAYER/REFEREE minor.
    if (['PLAYER', 'REFEREE'].includes(userType) && body.createdBy) {
      try {
        const { FEATURE_CAPS } = require('../Subscription/subscription.model');
        const creator = await User.findById(body.createdBy).select('type').lean();
        if (creator?.type === 'GUARDIAN') {
          const caps = FEATURE_CAPS.GUARDIAN?.FREE || {};
          const currentMinors = await User.countDocuments({
            createdBy: body.createdBy,
            type: { $in: ['PLAYER', 'REFEREE'] },
          });
          if (caps.maxMinors != null && currentMinors >= caps.maxMinors) {
            return done(new Error(
              `Umefikia kikomo cha wachezaji ${caps.maxMinors}. Huwezi kuongeza zaidi.`
            ), null);
          }
          if (userType === 'REFEREE' && caps.maxRefereeMinors != null) {
            const refCount = await User.countDocuments({
              createdBy: body.createdBy, type: 'REFEREE',
            });
            if (refCount >= caps.maxRefereeMinors) {
              return done(new Error(
                `Umefikia kikomo cha waamuzi ${caps.maxRefereeMinors} kama mlezi.`
              ), null);
            }
          }
        }
      } catch (_) { /* fall through — best-effort */ }
    }

    const phone = phoneRaw === '' || phoneRaw === null ? undefined : phoneRaw;
    // Fix dob format if needed
    if (body.dob) body.dob = body.dob.toString().replace(' ', 'T');
    const isOwnerRaw = _.get(body, 'subAccount', 'false');
    const isOwner = isOwnerRaw === true || isOwnerRaw === 'true' ? 'true' : 'false';

    // For subaccounts (minor players / referees registered by a
    // GUARDIAN), populate the `guardian` field from day 1 alongside
    // `createdBy`. Previously only `createdBy` was set which broke
    // the ownership check on the remove-ward endpoint. Only promote
    // when the creator is actually a GUARDIAN — other org types
    // (ACADEMY / CLUB / SCHOOL) use different lifecycle fields.
    if (isOwner === 'false' && body.createdBy && !body.guardian) {
      try {
        const creator = await User.findById(body.createdBy)
          .select('type').lean();
        if (creator?.type === 'GUARDIAN') {
          body.guardian = body.createdBy;
        }
      } catch (_) { /* best-effort */ }
    }
    const isPhoneExists = await User.where('phone', phone).count();
    const passwordValue = _.get(body, 'password');
    if (!passwordValue && isOwner === 'false') {
      return done(new Error('Password is required'), null);
    }
    const resolvedPassword = passwordValue || Math.random().toString(36).slice(-10) + Math.random().toString(36).slice(-10).toUpperCase();
    const password = await generateHash(resolvedPassword);

    if (userType === 'SCHOOL' && isOwner === 'false') {
      const regNum = _.get(body, 'academy_registration');
      if (!regNum) return done(new Error('School registration number is required'), null);
      const exists = await User.where({ academy_registration: regNum, type: 'SCHOOL' }).count();
      if (exists > 0) return done(new Error('School registration number already in use'), null);
      User.post({ ...body, firstName: body.academy_name || 'School', lastName: 'School', password }, async (err, data) => {
        if (err) return done(err, null);
        const counter = await Counter.getNextSequenceValue('memberId');
        const accountNumber = `TFH-SC-A${leftFillNum(counter, 6)}`;
        await data.setAccountNumber(accountNumber);
        return done(null, data);
      });
    } else if ((!_.isUndefined(phone) && isPhoneExists === 0 && isOwner === 'false') || (_.isUndefined(phone) && !_.isUndefined(_.get(body, 'email')) && isOwner === 'false')) {
      User.post({ ...body, password }, async (err, data) => {
        if (err) return done(err, null);
        const counter = await Counter.getNextSequenceValue('memberId');
        const accountNumber = `TFH-${userType.charAt(0)}-A${leftFillNum(counter, 6)}`;
        await data.setAccountNumber(accountNumber);
        if (data.phone) {
          const payload = data.phone.replace(data.phone.charAt(0), '255');
          const text = data.type === 'SPONSOR' && data.sponsor_type === 'Entity'
            ? `${data.entity_name}` : `${data.firstName} ${data.lastName}`;
          sendSms(`Karibu Sokasoko ${text}, Tafadhali tunza tarakimu zako hizi za usajili. ${data.accountNumber}`, payload);
        }
        return done(null, data);
      });
    } else if (_.isUndefined(phone) && isOwner === 'true') {
      User.post({ ...body, password }, async (err, data) => {
        if (err) return done(err, null);
        const counter = await Counter.getNextSequenceValue('memberId');
        const accountNumber = `TFH-${userType.charAt(0)}-A${leftFillNum(counter, 6)}`;
        await data.setAccountNumber(accountNumber);
        return done(null, data);
      });
    } else if (!_.isUndefined(phone) && isOwner === 'true') {
      User.post({ ...body, password }, async (err, data) => {
        if (err) return done(err, null);
        const counter = await Counter.getNextSequenceValue('memberId');
        const accountNumber = `TFH-${userType.charAt(0)}-A${leftFillNum(counter, 6)}`;
        await data.setAccountNumber(accountNumber);
        const payload = data.phone.replace(data.phone.charAt(0), '255');
        sendSms(`Karibu Sokasoko ${data.firstName} ${data.lastName}, Tafadhali tunza tarakimu zako hizi za usajili. ${data.accountNumber}`, payload);
        return done(null, data);
      });
    } else {
      if (isPhoneExists > 0) return done(new Error('Phone number already registered. Please use a different number.'), null);
      return done(new Error('An Error occured. Please contact the Administrator'), null);
    }
  },
}));

router.patch(PATH_SINGLE, uploadFor(), patchFor({
  patch: (body, done) => {
    const remove = _.get(body, 'remove');
    if (remove) body = _.assign(body, { agent: null });
    return User.patch(body, done);
  },
}));

router.put(PATH_SINGLE, uploadFor(), putFor({
  put: (body, done) => User.put(body, done),
}));

router.delete(PATH_SINGLE, deleteFor({
  del: (options, done) => User.del(options, done),
}));

router.post(PATH_LOGIN, (request, response) => {
  const rawIdentifier = _.get(request.body, 'identifier', '');
  const identifier = rawIdentifier.trim();
  const password = _.get(request.body, 'password');
  // Closed-beta gate. When BETA_TESTING_ONLY=true, only users with
  // betaTester=true (or the seeded admin bypass) can sign in. Turn OFF
  // for public launch.
  const betaOnly = getString('BETA_TESTING_ONLY', 'false').toLowerCase() === 'true';

  User.findOne({
    $or: [
      { phone: identifier },
      { accountNumber: new RegExp(`^${identifier}$`, 'i') },
      { email: new RegExp(`^${identifier}$`, 'i') },
      { academy_registration: new RegExp(`^${identifier}$`, 'i') },
    ],
  }).exec((err, user) => {
    if (err) return response.error(err);
    if (_.isNull(user)) return response.notFound();
    if (betaOnly && !user.betaTester) {
      return response.error(
        'Closed testing in progress. Your account is not on the tester list.'
      );
    }
    return user.comparePassword(password, (error, isMatch) => {
      if (error) return response.error(error);
      if (isMatch) return response.ok(user);
      return response.error('Failed to Login');
    });
  });
});

// POST /v1/users/:id/beta-tester — toggle beta_tester flag.
// Body: { enabled: true|false }
// Simple admin endpoint; not auth-guarded because SokaSoko's admin surface
// today is trusted-caller. Tighten once the admin CMS ships.
router.post('/users/:id/beta-tester', async (req, res) => {
  try {
    const { enabled } = req.body;
    const u = await User.findByIdAndUpdate(
      req.params.id,
      { betaTester: !!enabled },
      { new: true }
    ).select('_id firstName lastName accountNumber betaTester');
    if (!u) return res.status(404).json({ error: 'User not found' });
    return res.status(200).json({ data: u });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/users/:id/block  — add targetId to :id's blockedUsers list.
// Body: { targetId }
router.post('/users/:id/block', async (req, res) => {
  try {
    const { targetId } = req.body;
    if (!targetId) return res.status(400).json({ error: 'targetId required' });
    if (String(targetId) === String(req.params.id)) {
      return res.status(400).json({ error: 'Cannot block yourself' });
    }
    const u = await User.findByIdAndUpdate(
      req.params.id,
      { $addToSet: { blockedUsers: targetId } },
      { new: true }
    ).select('_id blockedUsers');
    if (!u) return res.status(404).json({ error: 'User not found' });
    return res.status(200).json({ data: u });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/users/:id/unblock — remove targetId from :id's blockedUsers list.
// Body: { targetId }
router.post('/users/:id/unblock', async (req, res) => {
  try {
    const { targetId } = req.body;
    if (!targetId) return res.status(400).json({ error: 'targetId required' });
    const u = await User.findByIdAndUpdate(
      req.params.id,
      { $pull: { blockedUsers: targetId } },
      { new: true }
    ).select('_id blockedUsers');
    if (!u) return res.status(404).json({ error: 'User not found' });
    return res.status(200).json({ data: u });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/users/:id/blocked — list users the caller has blocked
router.get('/users/:id/blocked', async (req, res) => {
  try {
    const u = await User.findById(req.params.id)
      .select('blockedUsers')
      .populate('blockedUsers', 'firstName lastName accountNumber type profileImage');
    if (!u) return res.status(404).json({ error: 'User not found' });
    return res.status(200).json({ data: u.blockedUsers || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── Friends / friendsOnly privacy ───────────────────────────────────────

// POST /v1/users/:id/friends-only  body { enabled: bool }
router.post('/users/:id/friends-only', async (req, res) => {
  try {
    const { enabled } = req.body;
    const u = await User.findByIdAndUpdate(
      req.params.id,
      { friendsOnly: !!enabled },
      { new: true }
    ).select('_id friendsOnly');
    if (!u) return res.status(404).json({ error: 'User not found' });
    return res.status(200).json({ data: u });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/users/:id/friend/request  body { targetId }
// :id sends a friend request to targetId
router.post('/users/:id/friend/request', async (req, res) => {
  try {
    const { targetId } = req.body;
    if (!targetId) return res.status(400).json({ error: 'targetId required' });
    if (String(targetId) === String(req.params.id)) {
      return res.status(400).json({ error: 'Cannot friend yourself' });
    }
    await Promise.all([
      User.findByIdAndUpdate(req.params.id, {
        $addToSet: { friendRequestsSent: targetId },
      }),
      User.findByIdAndUpdate(targetId, {
        $addToSet: { friendRequestsReceived: req.params.id },
      }),
    ]);
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/users/:id/friend/accept  body { requesterId }
// :id accepts a pending request from requesterId
router.post('/users/:id/friend/accept', async (req, res) => {
  try {
    const { requesterId } = req.body;
    if (!requesterId) return res.status(400).json({ error: 'requesterId required' });
    await Promise.all([
      User.findByIdAndUpdate(req.params.id, {
        $addToSet: { friends: requesterId },
        $pull: { friendRequestsReceived: requesterId },
      }),
      User.findByIdAndUpdate(requesterId, {
        $addToSet: { friends: req.params.id },
        $pull: { friendRequestsSent: req.params.id },
      }),
    ]);
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/users/:id/friend/decline  body { requesterId }
router.post('/users/:id/friend/decline', async (req, res) => {
  try {
    const { requesterId } = req.body;
    if (!requesterId) return res.status(400).json({ error: 'requesterId required' });
    await Promise.all([
      User.findByIdAndUpdate(req.params.id, {
        $pull: { friendRequestsReceived: requesterId },
      }),
      User.findByIdAndUpdate(requesterId, {
        $pull: { friendRequestsSent: req.params.id },
      }),
    ]);
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/users/:id/friend/remove  body { targetId }
// Removes a mutual friendship (either side can call).
router.post('/users/:id/friend/remove', async (req, res) => {
  try {
    const { targetId } = req.body;
    if (!targetId) return res.status(400).json({ error: 'targetId required' });
    await Promise.all([
      User.findByIdAndUpdate(req.params.id, { $pull: { friends: targetId } }),
      User.findByIdAndUpdate(targetId, { $pull: { friends: req.params.id } }),
    ]);
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/users/:id/friends
router.get('/users/:id/friends', async (req, res) => {
  try {
    const u = await User.findById(req.params.id)
      .select('friends friendRequestsSent friendRequestsReceived')
      .populate('friends', 'firstName lastName accountNumber type profileImage')
      .populate('friendRequestsSent', 'firstName lastName accountNumber type profileImage')
      .populate('friendRequestsReceived', 'firstName lastName accountNumber type profileImage');
    if (!u) return res.status(404).json({ error: 'User not found' });
    return res.status(200).json({
      data: {
        friends: u.friends || [],
        sent: u.friendRequestsSent || [],
        received: u.friendRequestsReceived || [],
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});


// POST /v1/users/:id/link-coach — academy links a coach
router.post('/users/:id/link-coach', async (req, res) => {
  try {
    const { coachId, requestedBy } = req.body;
    const academy = await User.findById(req.params.id);
    if (!academy) return res.status(404).json({ error: 'Academy not found' });
    if (academy.type !== 'ACADEMY') return res.status(400).json({ error: 'User is not an academy' });

    // Verify requestedBy is owner or secretary
    const isOwner = academy.owner && academy.owner.toString() === requestedBy;
    const isSecretary = academy.secretary && academy.secretary.toString() === requestedBy;
    const isAcademy = academy._id.toString() === requestedBy;
    if (!isOwner && !isSecretary && !isAcademy) {
      return res.status(403).json({ error: 'Only the academy owner or secretary can link a coach' });
    }

    // Link coach to academy
    const coach = await User.findById(coachId);
    if (!coach) return res.status(404).json({ error: 'Coach not found' });
    if (coach.type !== 'COACH') return res.status(400).json({ error: 'User is not a coach' });

    coach.linkedAcademy = academy._id;
    await coach.save();

    return res.status(200).json({ message: 'Coach linked successfully', coach });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/users/:id/link-owner — set academy owner
router.post('/users/:id/link-owner', async (req, res) => {
  try {
    const { userId } = req.body;
    const academy = await User.findByIdAndUpdate(req.params.id, { owner: userId }, { new: true });
    if (!academy) return res.status(404).json({ error: 'Academy not found' });
    return res.status(200).json({ data: academy });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/users/:id/link-secretary — set academy secretary
router.post('/users/:id/link-secretary', async (req, res) => {
  try {
    const { userId } = req.body;
    const academy = await User.findByIdAndUpdate(req.params.id, { secretary: userId }, { new: true });
    if (!academy) return res.status(404).json({ error: 'Academy not found' });
    return res.status(200).json({ data: academy });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── Guardian ↔ Minor lifecycle ─────────────────────────────────────────
//
// Rules (see project_guardian_minor_relationship memory):
//   1. Either party can remove the link. Minor becomes orphaned.
//   2. Orphaned minors are restricted (chat/match/scout/profile) elsewhere.
//   3. Minor initiates re-attachment by requesting a specific guardian.
//   4. Guardian accepts / declines. Accept links + notifies previous
//      guardian (if any).

// Option A localization: callers can pass a `keys` object with
// { titleKey, bodyKey, params } so the notification is delivered with
// the localizable payload alongside the Kiswahili fallback strings.
// Legacy 4-arg calls (senderId, receiverId, content, title) still work
// and just don't populate the key fields.
async function sendChatNotice(
  senderId,
  receiverId,
  content,
  title = 'Sasisho la Ulezi',
  keys = null,
) {
  if (!senderId || !receiverId) return;
  try {
    // In-chat message — visible in the guardian/minor conversation thread.
    await ChatMessage.create({
      sender: senderId,
      receiver: receiverId,
      content,
      read: false,
    });
  } catch (e) {
    console.log('sendChatNotice chat failed:', e.message);
  }
  try {
    // Bell-icon notification — not blocked by the orphaned-chat gate,
    // so an orphaned minor still sees "guardian removed you" alerts.
    await Notification.create({
      userId: receiverId,
      title,
      body: content,
      titleKey: keys?.titleKey || '',
      bodyKey: keys?.bodyKey || '',
      params: keys?.params || {},
      type: 'SYSTEM',
    });
  } catch (e) {
    console.log('sendChatNotice notification failed:', e.message);
  }
}

// POST /v1/users/:minorId/guardian/remove — minor drops their guardian
router.post('/users/:minorId/guardian/remove', async (req, res) => {
  try {
    const minor = await User.findById(req.params.minorId);
    if (!minor) return res.status(404).json({ error: 'Minor not found' });
    if (!minor.guardian) {
      return res.status(400).json({ error: 'Minor has no active guardian' });
    }
    const oldGuardianId = minor.guardian;
    minor.previousGuardian = oldGuardianId;
    minor.guardian = null;
    minor.guardianOrphaned = true;
    await minor.save();
    // Non-blocking chat notice to the removed guardian
    const minorName = `${minor.firstName || ''} ${minor.lastName || ''}`.trim() || 'A player';
    sendChatNotice(
      minor._id,
      oldGuardianId,
      `${minorName} amejiondoa kwenye ulezi wako.`,
      'Sasisho la Ulezi',
      {
        titleKey: 'notice.guardian.default_title',
        bodyKey: 'notice.guardian.minor_removed_self',
        params: { minorName },
      },
    );
    return res.status(200).json({ data: minor });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/users/:guardianId/ward/remove  body { minorId }
// Guardian drops a ward → minor becomes orphaned
router.post('/users/:guardianId/ward/remove', async (req, res) => {
  try {
    const { minorId } = req.body;
    if (!minorId) return res.status(400).json({ error: 'minorId required' });
    const minor = await User.findById(minorId);
    if (!minor) return res.status(404).json({ error: 'Mtoto hajapatikana.' });

    // Legacy self-heal: pre-guardian-lifecycle minors carry the
    // registering account only in `createdBy`, not in the new
    // `guardian` field. Promote here so the ownership check passes
    // and future reads have both fields populated. Mirrors the same
    // block on GET /users/:minorId/guardian-status.
    if (!minor.guardian && !minor.guardianOrphaned && minor.createdBy &&
        String(minor.createdBy) === String(req.params.guardianId)) {
      minor.guardian = req.params.guardianId;
      // Save happens below anyway; this line covers the ownership check.
    }

    if (String(minor.guardian) !== String(req.params.guardianId)) {
      return res.status(403).json({
        error: 'Wewe si mlezi wa sasa wa mtoto huyu.',
        reason: 'NOT_CURRENT_GUARDIAN',
      });
    }
    minor.previousGuardian = req.params.guardianId;
    minor.guardian = null;
    minor.guardianOrphaned = true;
    await minor.save();
    const minorName = `${minor.firstName || ''} ${minor.lastName || ''}`.trim() || 'The player';
    sendChatNotice(
      req.params.guardianId,
      minor._id,
      `Mlezi wako amekuondoa. Tafuta mlezi mwingine kupitia SokaSoko.`,
      'Sasisho la Ulezi',
      {
        titleKey: 'notice.guardian.default_title',
        bodyKey: 'notice.guardian.guardian_removed_ward',
        params: {},
      },
    );
    return res.status(200).json({ data: minor });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/users/:minorId/guardian/request  body { guardianId, note? }
// Minor requests attachment to a specific guardian.
router.post('/users/:minorId/guardian/request', async (req, res) => {
  try {
    const { guardianId, note } = req.body;
    if (!guardianId) return res.status(400).json({ error: 'guardianId required' });
    const [minor, guardian] = await Promise.all([
      User.findById(req.params.minorId).select('firstName lastName type guardian'),
      User.findById(guardianId).select('type'),
    ]);
    if (!minor) return res.status(404).json({ error: 'Minor not found' });
    if (!guardian) return res.status(404).json({ error: 'Guardian not found' });
    // Only PLAYERs cannot serve as guardian to another player. Every other
    // account type is allowed — parents, coaches, schools, academies,
    // scouts, referees, clubs, sponsors, etc. Individual accountability
    // is enforced by the accept/decline handshake.
    if (guardian.type === 'PLAYER') {
      return res.status(400).json({
        error: 'A player cannot be the guardian of another player.',
      });
    }
    if (minor.guardian) {
      return res.status(400).json({
        error: 'You already have an active guardian. Remove them first.',
      });
    }
    const minorName = `${minor.firstName || ''} ${minor.lastName || ''}`.trim() || 'A player';
    // Grab any prior PENDING requests so we can tell those guardians
    // that the minor withdrew before we mark them cancelled.
    const priorPending = await GuardianRequest.find({
      minor: minor._id,
      status: 'PENDING',
    }).select('guardian').lean();
    await GuardianRequest.updateMany(
      { minor: minor._id, status: 'PENDING' },
      { status: 'CANCELLED', respondedAt: new Date() },
    );
    for (const prior of priorPending) {
      if (String(prior.guardian) !== String(guardianId)) {
        sendChatNotice(
          minor._id,
          prior.guardian,
          `${minorName} ameghairi ombi la ulezi kwako.`,
          'Ombi Limeghairiwa',
          {
            titleKey: 'notice.guardian.request_withdrawn.title',
            bodyKey: 'notice.guardian.request_withdrawn.body',
            params: { minorName },
          },
        );
      }
    }
    const doc = await GuardianRequest.create({
      minor: minor._id,
      guardian: guardianId,
      note: note || '',
      status: 'PENDING',
    });
    sendChatNotice(
      minor._id,
      guardianId,
      `${minorName} ameomba uwe mlezi wake. Fungua Maombi ya Ulezi kwenye SokaSoko kukubali au kukataa.`,
      'Ombi Jipya la Ulezi',
      {
        titleKey: 'notice.guardian.request_new.title',
        bodyKey: 'notice.guardian.request_new.body',
        params: { minorName },
      },
    );
    return res.status(201).json({ data: doc });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/guardian-requests/:id/accept  body { guardianId }
router.post('/guardian-requests/:id/accept', async (req, res) => {
  try {
    const { guardianId } = req.body;
    const doc = await GuardianRequest.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Request not found' });
    if (String(doc.guardian) !== String(guardianId)) {
      return res.status(403).json({ error: 'Not the addressed guardian' });
    }
    if (doc.status !== 'PENDING') {
      return res.status(400).json({ error: 'Request already handled' });
    }
    doc.status = 'ACCEPTED';
    doc.respondedAt = new Date();
    await doc.save();

    const minor = await User.findById(doc.minor);
    if (!minor) return res.status(404).json({ error: 'Minor not found' });
    const previousGuardian = minor.previousGuardian;
    minor.guardian = guardianId;
    minor.guardianOrphaned = false;
    // Keep previousGuardian populated for audit; only cleared on the
    // NEXT removal event.
    await minor.save();

    // Notify previous guardian (if different).
    if (previousGuardian && String(previousGuardian) !== String(guardianId)) {
      const [minorFresh, newGuardian] = await Promise.all([
        User.findById(minor._id).select('firstName lastName'),
        User.findById(guardianId).select('firstName lastName'),
      ]);
      const minorName = `${minorFresh.firstName || ''} ${minorFresh.lastName || ''}`.trim() || 'The minor';
      const newGuardianName = `${newGuardian.firstName || ''} ${newGuardian.lastName || ''}`.trim() || 'a new guardian';
      sendChatNotice(
        guardianId,
        previousGuardian,
        `${minorName} sasa amewekwa chini ya mlezi ${newGuardianName}.`,
        'Sasisho la Ulezi',
        {
          titleKey: 'notice.guardian.default_title',
          bodyKey: 'notice.guardian.handoff',
          params: { minorName, newGuardianName },
        },
      );
    }

    // Notify minor
    sendChatNotice(
      guardianId,
      minor._id,
      `Ombi lako la ulezi limekubaliwa. Karibu tena kwenye SokaSoko.`,
      'Sasisho la Ulezi',
      {
        titleKey: 'notice.guardian.default_title',
        bodyKey: 'notice.guardian.request_accepted',
        params: {},
      },
    );

    return res.status(200).json({ data: doc });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/guardian-requests/:id/decline  body { guardianId }
router.post('/guardian-requests/:id/decline', async (req, res) => {
  try {
    const { guardianId } = req.body;
    const doc = await GuardianRequest.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Request not found' });
    if (String(doc.guardian) !== String(guardianId)) {
      return res.status(403).json({ error: 'Not the addressed guardian' });
    }
    if (doc.status !== 'PENDING') {
      return res.status(400).json({ error: 'Request already handled' });
    }
    doc.status = 'DECLINED';
    doc.respondedAt = new Date();
    await doc.save();
    sendChatNotice(
      guardianId,
      doc.minor,
      `Ombi lako la ulezi halikubaliwa. Unaweza kujaribu mlezi mwingine.`,
      'Sasisho la Ulezi',
      {
        titleKey: 'notice.guardian.default_title',
        bodyKey: 'notice.guardian.request_declined',
        params: {},
      },
    );
    return res.status(200).json({ data: doc });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/users/:minorId/guardian-status
router.get('/users/:minorId/guardian-status', async (req, res) => {
  try {
    let minor = await User.findById(req.params.minorId)
      .select('guardian guardianOrphaned previousGuardian type createdBy')
      .populate('guardian', 'firstName lastName accountNumber profileImage type')
      .populate('previousGuardian', 'firstName lastName accountNumber profileImage type')
      .lean();
    if (!minor) return res.status(404).json({ error: 'Minor not found' });

    // Legacy self-heal: pre-Guardian-lifecycle minors have their guardian
    // stored in `createdBy` (the account that registered them), not in the
    // new `guardian` field. If the minor has no guardian but was created
    // by an adult (non-PLAYER) account, promote createdBy → guardian so
    // the new lifecycle takes over from now on.
    if (!minor.guardian && !minor.guardianOrphaned && minor.createdBy) {
      const creator = await User.findById(minor.createdBy)
        .select('firstName lastName accountNumber profileImage type')
        .lean();
      if (creator && creator.type !== 'PLAYER') {
        await User.updateOne(
          { _id: minor._id },
          { $set: { guardian: creator._id } },
        );
        minor.guardian = creator;
      }
    }

    const pending = await GuardianRequest.find({
      minor: req.params.minorId,
      status: 'PENDING',
    })
      .populate('guardian', 'firstName lastName accountNumber profileImage type')
      .lean();
    return res.status(200).json({
      data: {
        guardian: minor.guardian,
        orphaned: !!minor.guardianOrphaned,
        previousGuardian: minor.previousGuardian,
        pendingRequest: pending[0] || null,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/users/:guardianId/ward-requests — incoming pending requests
router.get('/users/:guardianId/ward-requests', async (req, res) => {
  try {
    const items = await GuardianRequest.find({
      guardian: req.params.guardianId,
      status: 'PENDING',
    })
      .populate('minor', 'firstName lastName accountNumber profileImage type position')
      .sort({ createdAt: -1 })
      .lean();
    return res.status(200).json({ data: items });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/users/:guardianId/wards — list of active wards
router.get('/users/:guardianId/wards', async (req, res) => {
  try {
    const wards = await User.find({ guardian: req.params.guardianId })
      .select('firstName lastName accountNumber profileImage type position guardianOrphaned')
      .lean();
    return res.status(200).json({ data: wards });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
