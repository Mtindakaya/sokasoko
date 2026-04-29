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

const API_VERSION = getString('API_VERSION', '1.0.0');
const PATH_SINGLE = '/academys/:id';
const PATH_LIST = '/academys';
const PATH_SCHEMA = '/academys/schema/';

const Academy = require('./academy.model');
const User = require('../User/user.model');

const router = new Router({
  version: API_VERSION,
});

router.get(
  PATH_SCHEMA,
  schemaFor({
    getSchema: (query, done) => {
      const jsonSchema = Academy.jsonSchema();
      return done(null, jsonSchema);
    },
  })
);

router.get(
  PATH_SINGLE,
  getByIdFor({
    getById: (options, done) => Academy.get(options, done),
  })
);

router.get(
  PATH_LIST,
  getFor({
    get: (options, done) => Academy.get(options, done),
  })
);

router.post(
  PATH_LIST,
  postFor({
    post: (body, done) => {
      return Academy.post(body, (error, data) => {
        if (error) return done(error, null);

        const playerId = _.get(data, 'player._id');
        const academyId = _.get(data, '_id');

        return User.findById(playerId, (err, player) => {
          if (err) return done(err, null);

          // eslint-disable-next-line no-param-reassign
          player.academy = academyId;
          player.save();

          return done(null, player);
        });
      });
    },
  })
);

router.patch(
  PATH_SINGLE,
  patchFor({
    patch: (body, done) => Academy.patch(body, done),
  })
);

router.put(
  PATH_SINGLE,
  putFor({
    put: (body, done) => Academy.put(body, done),
  })
);

router.delete(
  PATH_SINGLE,
  deleteFor({
    del: (options, done) => {
      return Academy.del(options, (error, data) => {
        if (error) return done(error, null);

        const playerId = _.get(data, 'player._id');

        return User.findById(playerId, (err, player) => {
          if (err) return done(err, null);

          // eslint-disable-next-line no-param-reassign
          player.academy = null;
          player.save();

          return done(null, data);
        });
      });
    },
  })
);

module.exports = router;
