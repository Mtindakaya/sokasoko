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
const { uploaderFor } = require('@lykmapipo/file');
const Counter = require('../Counter/counter.model');
const { leftFillNum } = require('../Utils/utils');

const API_VERSION = getString('API_VERSION', '1.0.0');
const PATH_SINGLE = '/users/:id';
const PATH_LIST = '/users';
const PATH_SCHEMA = '/users/schema/';

const User = require('./user.model');

const router = new Router({
  version: API_VERSION,
});

router.get(
  PATH_SCHEMA,
  schemaFor({
    getSchema: (query, done) => {
      const jsonSchema = User.jsonSchema();
      return done(null, jsonSchema);
    },
  })
);

router.get(
  PATH_SINGLE,
  getByIdFor({
    getById: (options, done) => User.get(options, done),
  })
);

router.get(
  PATH_LIST,
  getFor({
    get: (options, done) => {
      return User.get(options, done);
    },
  })
);

router.post(
  PATH_LIST,
  uploaderFor(),
  postFor({
    post: async (body, done) => {
      const userType = _.get(body, 'type', 'P');
      const counter = await Counter.getNextSequenceValue('memberId');
      const accountNumber = `TFH-${userType}-A${leftFillNum(counter, 6)}`;
      return User.post({ ...body, accountNumber }, done);
    },
  })
);

router.patch(
  PATH_SINGLE,
  uploaderFor(),
  patchFor({
    patch: (body, done) => {
      return User.patch(body, done);
    },
  })
);

router.put(
  PATH_SINGLE,
  uploaderFor(),
  putFor({
    put: (body, done) => {
      return User.put(body, done);
    },
  })
);

router.delete(
  PATH_SINGLE,
  deleteFor({
    del: (options, done) => User.del(options, done),
  })
);

module.exports = router;
