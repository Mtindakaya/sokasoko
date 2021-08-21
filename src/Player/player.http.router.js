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

const API_VERSION = getString('API_VERSION', '1.0.0');
const PATH_SINGLE = '/players/:id';
const PATH_LIST = '/players';
const PATH_SCHEMA = '/players/schema/';

const Player = require('./player.model');

const router = new Router({
  version: API_VERSION,
});

router.get(
  PATH_SCHEMA,
  schemaFor({
    getSchema: (query, done) => {
      const jsonSchema = Player.jsonSchema();
      return done(null, jsonSchema);
    },
  })
);

router.get(
  PATH_SINGLE,
  getByIdFor({
    getById: (options, done) => Player.get(options, done),
  })
);

router.get(
  PATH_LIST,
  getFor({
    get: (options, done) => {
      return Player.get(options, done);
    },
  })
);

router.post(
  PATH_LIST,
  uploaderFor(),
  postFor({
    post: async (body, done) => {
      const counter = await Counter.getNextSequenceValue('memberId');
      const accountNumber = `TFH-P-A${counter}`;
      return Player.post({ ...body, accountNumber }, done);
    },
  })
);

router.patch(
  PATH_SINGLE,
  uploaderFor(),
  patchFor({
    patch: (body, done) => {
      return Player.patch(body, done);
    },
  })
);

router.put(
  PATH_SINGLE,
  uploaderFor(),
  putFor({
    put: (body, done) => {
      return Player.put(body, done);
    },
  })
);

router.delete(
  PATH_SINGLE,
  deleteFor({
    del: (options, done) => Player.del(options, done),
  })
);

module.exports = router;
