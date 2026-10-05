const {
  getByIdFor,
  deleteFor,
  Router,
  postFor,
  patchFor,
  putFor,
  schemaFor,
} = require('@lykmapipo/express-rest-actions');
const { getString } = require('@lykmapipo/env');
const { uploadFor } = require('../Utils/uploader');

const API_VERSION = getString('API_VERSION', '1.0.0');
const PATH_SINGLE = '/adverts/:id';
const PATH_LIST = '/adverts';
const PATH_MINE = '/adverts/mine';
const PATH_SCHEMA = '/adverts/schema/';
const CurrentAdvertTimer = '/currentAdvertTimer';

const Advert = require('./advert.model');
const AdvertImpression = require('./advertImpression.model');
const User = require('../User/user.model');
const { Subscription } = require('../Subscription/subscription.model');
const { audienceMatchClause, pickWeightedSample } = require('./audience');

// Tier caps on geo targeting. House ads bypass entirely (CMS admin
// path). PLATINUM + ENTERPRISE can go all four levels. GOLD/STANDARD
// are regional-only with region-count caps so lower tiers can't buy
// nationwide reach for the price of a cheaper plan.
const TIER_GEO_CAPS = {
  ENTERPRISE: { regions: Infinity, allowDeep: true },
  PLATINUM:   { regions: Infinity, allowDeep: true },
  GOLD:       { regions: 10,       allowDeep: false },
  STANDARD:   { regions: 2,        allowDeep: false },
};

// Returns { ok: true } or { ok: false, status, body } so the caller
// can bail out with the same response shape across create + update.
function validateTargeting(tier, body) {
  const caps = TIER_GEO_CAPS[tier];
  if (!caps) return { ok: true };
  const regions = Array.isArray(body.targetRegions) ? body.targetRegions : [];
  const districts = Array.isArray(body.targetDistricts) ? body.targetDistricts : [];
  const wards = Array.isArray(body.targetWards) ? body.targetWards : [];
  if (regions.length > caps.regions) {
    return { ok: false, status: 403, body: {
      error: `Your tier (${tier}) can target at most ${caps.regions} region(s). You selected ${regions.length}.`,
      reason: 'ADVERT_TIER_REGION_CAP',
      tier,
      cap: caps.regions,
      selected: regions.length,
    } };
  }
  if (!caps.allowDeep && (districts.length || wards.length)) {
    return { ok: false, status: 403, body: {
      error: `Your tier (${tier}) can only target at the region level. Upgrade to PLATINUM for district or ward targeting.`,
      reason: 'ADVERT_TIER_DEPTH_DISALLOWED',
      tier,
    } };
  }
  return { ok: true };
}

// Normalise multipart array fields (always stringified JSON on wire)
// in place so downstream mongoose + tier validation see real arrays.
function coerceTargetArrays(body) {
  const fields = ['targetAudience', 'targetGender', 'targetRegions', 'targetDistricts', 'targetWards'];
  for (const f of fields) {
    if (typeof body[f] === 'string') {
      try {
        const parsed = JSON.parse(body[f]);
        body[f] = Array.isArray(parsed) ? parsed : [];
      } catch (_) {
        body[f] = [];
      }
    }
  }
}

const router = new Router({ version: API_VERSION });

router.get(PATH_SCHEMA, schemaFor({
  getSchema: (query, done) => done(null, Advert.jsonSchema()),
}));

// GET /v1/adverts/mine?advertiser=<userId> — vendor's own adverts with
// counters. Registered before /:id so express doesn't cast "mine" to
// ObjectId.
router.get(PATH_MINE, async (req, res) => {
  try {
    const advertiser = req.query.advertiser || req.query.userId;
    if (!advertiser) {
      return res.status(400).json({ error: 'advertiser query param required' });
    }
    const adverts = await Advert.find({ advertiser })
      .sort({ createdAt: -1 })
      .lean();

    // Enrich with cap snapshot so the mobile screen can render "N of M used"
    // in one round-trip.
    const u = await User.findById(advertiser).select('type').lean();
    let cap = null;
    let tier = null;
    if (u && u.type === 'VENDOR') {
      const ctx = await Subscription.getEffectiveContext(advertiser);
      tier = ctx && ctx.tier;
      cap = ctx && ctx.caps ? ctx.caps.concurrentAdverts : null;
    }
    const now = new Date();
    const activeCount = adverts.filter((a) => {
      const startsOk = !a.startDate || new Date(a.startDate) <= now;
      const endsOk = !a.endDate || new Date(a.endDate) >= now;
      return startsOk && endsOk;
    }).length;

    return res.status(200).json({
      data: adverts,
      tier,
      concurrentAdvertsCap: cap,
      activeCount,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get(PATH_SINGLE, getByIdFor({
  getById: (options, done) => Advert.get(options, done),
}));

// GET /v1/adverts
// ?active=true   → only return ads within their date window
// ?viewer=<uid>  → full viewer-targeted filter (type + gender + region
//                  + district + ward) using the viewer's profile; use
//                  this for the profile carousel so audience targeting
//                  is honoured server-side. Also weight-samples the
//                  result and logs CAROUSEL impressions.
// ?type=X        → legacy single-axis filter (user type only); kept for
//                  the old advert.dart screen until it migrates.
router.get(PATH_LIST, async (req, res) => {
  try {
    const active = req.query.active === 'true';
    const viewerId = req.query.viewer;
    const userType = req.query.type;

    const filter = {};
    const clauses = [];

    if (active) {
      const now = new Date();
      clauses.push(
        { $or: [{ startDate: { $lte: now } }, { startDate: null }, { startDate: { $exists: false } }] },
        { $or: [{ endDate: { $gte: now } }, { endDate: null }, { endDate: { $exists: false } }] },
      );
    }

    let viewer = null;
    if (viewerId) {
      viewer = await User.findById(viewerId).select('type gender region district ward').lean();
      clauses.push(...audienceMatchClause(viewer));
    } else if (userType) {
      // Legacy single-axis path — kept for backward compat with the
      // old advert.dart screen. Only enforces user-type targeting.
      clauses.push({
        $or: [
          { targetAudience: { $exists: false } },
          { targetAudience: { $size: 0 } },
          { targetAudience: userType },
        ],
      });
    }

    if (clauses.length) filter.$and = clauses;

    const adverts = await Advert.find(filter).sort({ createdAt: -1 }).lean();

    // When the client is a viewer-targeted carousel call, weight-sample
    // the result so tier bias is visible in the carousel too and log
    // impressions. Legacy ?type= path returns the raw list to preserve
    // old client behaviour.
    if (viewerId) {
      const sampled = pickWeightedSample(adverts, Math.min(10, adverts.length));
      if (sampled.length) {
        const rows = sampled.map((a) => ({
          advert: a._id,
          viewer: viewer ? viewer._id : null,
          surface: 'CAROUSEL',
        }));
        AdvertImpression.insertMany(rows, { ordered: false })
          .catch((err) => console.error('[Advert] carousel impression log failed:', err.message));
      }
      return res.status(200).json({ data: sampled });
    }

    return res.status(200).json({ data: adverts });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/adverts/:id/view — record one impression
router.post('/adverts/:id/view', async (req, res) => {
  try {
    await Advert.findByIdAndUpdate(req.params.id, { $inc: { impressionCount: 1 } });
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/adverts/:id/click — record one click
router.post('/adverts/:id/click', async (req, res) => {
  try {
    await Advert.findByIdAndUpdate(req.params.id, { $inc: { clickCount: 1 } });
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/adverts — VENDOR-only, tier-gated by concurrentAdverts cap.
// The multipart middleware (uploadFor) writes any file to req.file /
// req.files and text fields to req.body — same contract the auto-generated
// postFor was using.
router.post(PATH_LIST, uploadFor(), async (req, res) => {
  try {
    const body = req.body || {};
    const advertiserId = body.advertiser || body.userId;

    // Parse targeting arrays early — tier validation needs real arrays.
    coerceTargetArrays(body);

    // Vendor path — requires ownership, VENDOR type, honours the
    // per-tier concurrentAdverts cap AND the new geo-targeting caps.
    // House-ad path — body.isHouseAd=true (CMS admin create). Skips
    // every tier gate; the ad is treated as an official SokaSoko
    // placement, pinned at HOUSE tier for sampler weighting.
    const wantsHouseAd = body.isHouseAd === true || body.isHouseAd === 'true';
    if (wantsHouseAd) {
      body.isHouseAd = true;
      body.advertiserTier = 'HOUSE';
    } else if (advertiserId) {
      const advertiser = await User.findById(advertiserId).select('type companyName firstName lastName').lean();
      if (!advertiser) {
        return res.status(404).json({ error: 'advertiser not found' });
      }
      if (advertiser.type !== 'VENDOR') {
        return res.status(403).json({
          error: 'only VENDOR accounts can create adverts',
          reason: 'ADVERT_VENDOR_ONLY',
        });
      }

      const ctx = await Subscription.getEffectiveContext(advertiserId);
      const tier = ctx && ctx.tier;
      const caps = (ctx && ctx.caps) || {};
      const cap = caps.concurrentAdverts;
      // null cap = unlimited. 0 (STANDARD) blocks outright.
      if (cap === 0) {
        return res.status(403).json({
          error: 'Your subscription does not include adverts. Upgrade to GOLD or higher.',
          reason: 'ADVERT_TIER_DISALLOWED',
          tier,
        });
      }
      if (cap != null) {
        const now = new Date();
        const activeCount = await Advert.countDocuments({
          advertiser: advertiserId,
          $and: [
            { $or: [{ startDate: { $lte: now } }, { startDate: null }, { startDate: { $exists: false } }] },
            { $or: [{ endDate: { $gte: now } }, { endDate: null }, { endDate: { $exists: false } }] },
          ],
        });
        if (activeCount >= cap) {
          return res.status(429).json({
            error: `Concurrent-advert cap reached (${activeCount}/${cap}). Delete an active advert or upgrade your tier.`,
            reason: 'CONCURRENT_ADVERT_CAP',
            tier,
            cap,
            active: activeCount,
          });
        }
      }

      // Geo targeting caps per tier.
      const geoCheck = validateTargeting(tier, body);
      if (!geoCheck.ok) return res.status(geoCheck.status).json(geoCheck.body);

      if (!body.advertiserName) {
        body.advertiserName = advertiser.companyName
          || `${advertiser.firstName || ''} ${advertiser.lastName || ''}`.trim();
      }
      body.advertiser = advertiserId;
      body.advertiserTier = tier;
    }

    // Server-side photo mapping — the uploader middleware stores the path
    // at either req.file.path or req.body.photo depending on the call.
    if (req.file && req.file.path && !body.photo) body.photo = req.file.path;

    const created = await Advert.create(body);
    return res.status(201).json(created);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post(CurrentAdvertTimer, postFor({
  post: async (body, done) => {
    const duration = body.duration;
    return User.updateMany({}, { advertDuration: duration }, (error, result) => {
      if (error) return done(error, null);
      return done(null, result);
    });
  },
}));

// PATCH /v1/adverts/:id — owner-only. Same ownership rule as DELETE:
// pass ?advertiser=<userId> so we can verify without session state.
// House ads (no advertiser stored) are treated as CMS-editable and any
// caller may patch them.
router.patch(PATH_SINGLE, uploadFor(), async (req, res) => {
  try {
    const advertiserId = req.query.advertiser || req.body.advertiser;
    const existing = await Advert.findById(req.params.id).lean();
    if (!existing) return res.status(404).json({ error: 'advert not found' });
    if (existing.advertiser
        && advertiserId
        && String(existing.advertiser) !== String(advertiserId)) {
      return res.status(403).json({ error: 'not your advert' });
    }

    const body = req.body || {};
    // Only allow these fields to be changed via edit — advertiser +
    // advertiserTier + isHouseAd are pinned at create time.
    const editable = [
      'title', 'description', 'link', 'adType', 'videoUrl',
      'advertiserName', 'startDate', 'endDate',
      'targetAudience', 'targetGender',
      'targetRegions', 'targetDistricts', 'targetWards',
    ];
    const update = {};
    for (const k of editable) {
      if (body[k] !== undefined) update[k] = body[k];
    }
    // Multipart photo swap.
    if (req.file && req.file.path) update.photo = req.file.path;
    // Normalise any array fields that arrived as JSON strings.
    coerceTargetArrays(update);

    // Re-validate geo caps against the ad's locked-in tier. House ads
    // skip (TIER_GEO_CAPS has no HOUSE entry → validateTargeting is a
    // no-op). Vendors can't widen targeting beyond what their tier
    // allowed at create time.
    if (!existing.isHouseAd && existing.advertiserTier) {
      // Build the merged view the ad will have post-patch, so partial
      // edits (e.g. only touching targetRegions) still get validated
      // against the full remaining targeting set.
      const merged = {
        targetRegions: update.targetRegions ?? existing.targetRegions ?? [],
        targetDistricts: update.targetDistricts ?? existing.targetDistricts ?? [],
        targetWards: update.targetWards ?? existing.targetWards ?? [],
      };
      const geoCheck = validateTargeting(existing.advertiserTier, merged);
      if (!geoCheck.ok) return res.status(geoCheck.status).json(geoCheck.body);
    }

    const patched = await Advert.findByIdAndUpdate(
      req.params.id, { $set: update }, { new: true }
    );
    return res.status(200).json({ data: patched });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.put(PATH_SINGLE, uploadFor(), putFor({
  put: (body, done) => Advert.put(body, done),
}));

// DELETE /v1/adverts/:id — owner-only. Pass ?advertiser=<userId> so we
// can verify without an auth header (the mobile stack is still session
// -less for adverts). Non-owners get 403.
router.delete(PATH_SINGLE, async (req, res) => {
  try {
    // Optional chaining because req.body is undefined on DELETE requests
    // in this stack — raw req.body.advertiser throws TypeError before
    // Express attaches a parsed body on verbs the body-parser skips.
    const advertiserId = req.query?.advertiser || req.body?.advertiser;
    const ad = await Advert.findById(req.params.id).lean();
    if (!ad) return res.status(404).json({ error: 'advert not found' });
    if (advertiserId && ad.advertiser
        && String(ad.advertiser) !== String(advertiserId)) {
      return res.status(403).json({ error: 'not your advert' });
    }
    await Advert.findByIdAndDelete(req.params.id);
    return res.status(200).json({ ok: true });
  } catch (err) {
    // Log the full stack to Render so we can see what actually blew up
    // when a DELETE fails — the client only sees err.message.
    // eslint-disable-next-line no-console
    console.error('[DELETE /v1/adverts/:id] failed', {
      id: req.params.id,
      advertiser: req.query.advertiser || req.body.advertiser,
      message: err.message,
      stack: err.stack,
    });
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
