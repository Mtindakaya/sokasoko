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
const { uploaderFor } = require('@lykmapipo/file');
const Counter = require('../Counter/counter.model');
const { leftFillNum } = require('../Utils/utils');

const API_VERSION = getString('API_VERSION', '1.0.0');
const PATH_SINGLE = '/coachs/:id';
const PATH_LIST = '/coachs';
const PATH_SCHEMA = '/coachs/schema/';

const Coach = require('./coach.model');

const router = new Router({
  version: API_VERSION,
});

router.get(
  PATH_SCHEMA,
  schemaFor({
    getSchema: (query, done) => {
      const jsonSchema = Coach.jsonSchema();
      return done(null, jsonSchema);
    },
  })
);

router.get(
  PATH_SINGLE,
  getByIdFor({
    getById: (options, done) => Coach.get(options, done),
  })
);

router.get(
  PATH_LIST,
  getFor({
    get: (options, done) => Coach.get(options, done),
  })
);

router.post(
  PATH_LIST,
  uploaderFor(),
  postFor({
    post: async (body, done) => {
      const counter = await Counter.getNextSequenceValue('coachId');
      const accountNumber = `TFH-C-A${leftFillNum(counter, 6)}`;
      return Coach.post({ ...body, accountNumber }, done);
    },
  })
);

router.patch(
  PATH_SINGLE,
  uploaderFor(),
  patchFor({
    patch: (body, done) => Coach.patch(body, done),
  })
);

router.put(
  PATH_SINGLE,
  uploaderFor(),
  putFor({
    put: (body, done) => Coach.put(body, done),
  })
);

router.delete(
  PATH_SINGLE,
  deleteFor({
    del: (options, done) => Coach.del(options, done),
  })
);

module.exports = router;
