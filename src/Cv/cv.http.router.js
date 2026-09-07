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

const API_VERSION = getString('API_VERSION', '1.0.0');
const PATH_SINGLE = '/cvs/:id';
const PATH_LIST = '/cvs';
const PATH_SCHEMA = '/cvs/schema/';

const Cv = require('./cv.model');
const User = require('../User/user.model');

const router = new Router({
  version: API_VERSION,
});

// Post-registration history is auto-tracked by CareerEvent. The manual
// Cv form is now only for pre-SokaSoko years, so we reject rows whose
// end_date lands after the user's SokaSoko registration date.
async function validatePreRegistration(body) {
  if (!body || !body.createdBy) return null; // let downstream barf
  const user = await User.findById(body.createdBy).select('createdAt').lean();
  if (!user) return null;
  if (body.isCurrent === true || body.isCurrent === 'YES') {
    return 'Timu za sasa hufuatiliwa moja kwa moja — ondoa "Is My Current Team?" na weka tarehe ya mwisho.';
  }
  if (!body.end_date) {
    return 'end_date inahitajika — hii ni historia ya kabla ya SokaSoko.';
  }
  const end = new Date(body.end_date);
  const registered = new Date(user.createdAt);
  if (isNaN(end.getTime())) return 'end_date si sahihi.';
  if (end > registered) {
    const y = registered.getFullYear();
    return `end_date lazima iwe kabla ya tarehe uliyojisajili SokaSoko (${y}). Timu za baadaye zinatunzwa moja kwa moja.`;
  }
  return null;
}

router.get(
  PATH_SCHEMA,
  schemaFor({
    getSchema: (query, done) => {
      const jsonSchema = Cv.jsonSchema();
      return done(null, jsonSchema);
    },
  })
);

router.get(
  PATH_SINGLE,
  getByIdFor({
    getById: (options, done) => Cv.get(options, done),
  })
);

router.get(
  PATH_LIST,
  getFor({
    get: (options, done) => Cv.get(options, done),
  })
);

router.post(
  PATH_LIST,
  postFor({
    post: async (body, done) => {
      const err = await validatePreRegistration(body);
      if (err) return done({ status: 400, message: err });
      return Cv.post(body, done);
    },
  })
);

router.patch(
  PATH_SINGLE,
  patchFor({
    patch: async (body, done) => {
      // On PATCH the caller may not resend createdBy; look it up.
      if (body && !body.createdBy && body._id) {
        const existing = await Cv.findById(body._id).select('createdBy').lean();
        if (existing) body.createdBy = existing.createdBy;
      }
      const err = await validatePreRegistration(body);
      if (err) return done({ status: 400, message: err });
      return Cv.patch(body, done);
    },
  })
);

router.put(
  PATH_SINGLE,
  putFor({
    put: async (body, done) => {
      if (body && !body.createdBy && body._id) {
        const existing = await Cv.findById(body._id).select('createdBy').lean();
        if (existing) body.createdBy = existing.createdBy;
      }
      const err = await validatePreRegistration(body);
      if (err) return done({ status: 400, message: err });
      return Cv.put(body, done);
    },
  })
);

router.delete(
  PATH_SINGLE,
  deleteFor({
    del: (options, done) => Cv.del(options, done),
  })
);

module.exports = router;
