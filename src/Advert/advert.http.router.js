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
const PATH_SCHEMA = '/adverts/schema/';
const CurrentAdvertTimer = '/currentAdvertTimer';

const Advert = require('./advert.model');
const User = require('../User/user.model');

const router = new Router({ version: API_VERSION });

router.get(PATH_SCHEMA, schemaFor({
  getSchema: (query, done) => done(null, Advert.jsonSchema()),
}));

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

router.post(PATH_LIST, uploadFor(), postFor({
  post: async (body, done) => Advert.post(body, done),
}));

router.post(CurrentAdvertTimer, postFor({
  post: async (body, done) => {
    const duration = body.duration;
    return User.updateMany({}, { advertDuration: duration }, (error, result) => {
      if (error) return done(error, null);
      return done(null, result);
    });
  },
}));

router.patch(PATH_SINGLE, uploadFor(), patchFor({
  patch: (body, done) => Advert.patch(body, done),
}));

router.put(PATH_SINGLE, uploadFor(), putFor({
  put: (body, done) => Advert.put(body, done),
}));

router.delete(PATH_SINGLE, deleteFor({
  del: (options, done) => Advert.del(options, done),
}));

module.exports = router;
