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
const Counter = require('../Counter/counter.model');

const API_VERSION = getString('API_VERSION', '1.0.0');
const PATH_SINGLE = '/guardians/:id';
const PATH_LIST = '/guardians';
const PATH_SCHEMA = '/guardians/schema/';

const Guardian = require('./guardian.model');

const router = new Router({
  version: API_VERSION,
});

router.get(
  PATH_SCHEMA,
  schemaFor({
    getSchema: (query, done) => {
      const jsonSchema = Guardian.jsonSchema();
      return done(null, jsonSchema);
    },
  })
);

router.get(
  PATH_SINGLE,
  getByIdFor({
    getById: (options, done) => Guardian.get(options, done),
  })
);

router.get(
  PATH_LIST,
  getFor({
    get: (options, done) => Guardian.get(options, done),
  })
);

router.post(
  PATH_LIST,
  postFor({
    post: async (body, done) => {
      const value = await Counter.getNextSequenceValue('memberId');
      const payload = _.assign(body, { accountNumber: value });
      return Guardian.post(payload, done);
    },
  })
);

router.patch(
  PATH_SINGLE,
  patchFor({
    patch: (body, done) => Guardian.patch(body, done),
  })
);

router.put(
  PATH_SINGLE,
  putFor({
    put: (body, done) => Guardian.put(body, done),
  })
);

router.delete(
  PATH_SINGLE,
  deleteFor({
    del: (options, done) => Guardian.del(options, done),
  })
);

module.exports = router;
