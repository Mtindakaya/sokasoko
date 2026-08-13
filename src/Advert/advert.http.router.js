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
const User = require('../User/user.model');
const { Subscription } = require('../Subscription/subscription.model');

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
// ?active=true  → only return ads within their date window
// ?type=PLAYER  → also filter by targetAudience (ignored when empty audience array)
router.get(PATH_LIST, async (req, res) => {
  try {
    const active = req.query.active === 'true';
    const userType = req.query.type;

    let filter = {};

    if (active) {
      const now = new Date();
      const dateFilter = {
        $and: [
          { $or: [{ startDate: { $lte: now } }, { startDate: null }, { startDate: { $exists: false } }] },
          { $or: [{ endDate: { $gte: now } }, { endDate: null }, { endDate: { $exists: false } }] },
        ],
      };

      if (userType) {
        dateFilter.$and.push({
          $or: [
            { targetAudience: { $exists: false } },
            { targetAudience: { $size: 0 } },
            { targetAudience: userType },
          ],
        });
      }
      filter = dateFilter;
    }

    const adverts = await Advert.find(filter).sort({ createdAt: -1 }).lean();
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

    // Vendor path — requires ownership, VENDOR type, and honours the
    // per-tier concurrentAdverts cap.
    // House-ad path — no advertiser supplied (CMS admin create). Skips
    // the tier gate entirely; the ad is treated as an official SokaSoko
    // placement and shows to every targeted audience.
    if (advertiserId) {
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

    // Multipart form fields arrive as strings. Mongoose would cast the
    // JSON string into a one-element [String] array before the pre-save
    // hook can normalise it — so parse here first.
    if (typeof body.targetAudience === 'string') {
      try {
        const parsed = JSON.parse(body.targetAudience);
        body.targetAudience = Array.isArray(parsed) ? parsed : [];
      } catch (_) {
        body.targetAudience = [];
      }
    }

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
    // advertiserTier are pinned at create time.
    const editable = [
      'title', 'description', 'link', 'adType', 'videoUrl',
      'advertiserName', 'targetAudience', 'startDate', 'endDate',
    ];
    const update = {};
    for (const k of editable) {
      if (body[k] !== undefined) update[k] = body[k];
    }
    // Multipart photo swap.
    if (req.file && req.file.path) update.photo = req.file.path;
    // Same string→array coercion the POST path uses.
    if (typeof update.targetAudience === 'string') {
      try {
        const parsed = JSON.parse(update.targetAudience);
        update.targetAudience = Array.isArray(parsed) ? parsed : [];
      } catch (_) {
        update.targetAudience = [];
      }
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
    const advertiserId = req.query.advertiser || req.body.advertiser;
    const ad = await Advert.findById(req.params.id).lean();
    if (!ad) return res.status(404).json({ error: 'advert not found' });
    if (advertiserId && ad.advertiser
        && String(ad.advertiser) !== String(advertiserId)) {
      return res.status(403).json({ error: 'not your advert' });
    }
    await Advert.findByIdAndDelete(req.params.id);
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
