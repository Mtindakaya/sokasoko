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
    post: async (body, done) => {
      try {
        const playerId = body.player;
        const addedBy = body.addedBy;
        const level = body.level;
        console.log('[ACADEMY POST] player=%s addedBy=%s level=%s', playerId, addedBy, level);

        if (!playerId) return done(new Error('player id is required'), null);
        if (!level) return done(new Error('level is required'), null);

        const player = await User.findById(playerId).lean();
        if (!player) return done(new Error('Player not found'), null);

        // Check for a live enrollment (not a dangling ObjectId from a crashed request)
        if (player.academy) {
          const existing = await Academy.findById(player.academy).lean();
          if (existing) {
            return done(new Error('Player is already enrolled in an academy'), null);
          }
          // Dangling reference — clear it so we can re-enroll
          await User.findByIdAndUpdate(playerId, { $set: { academy: null } });
        }

        // Remove any orphaned enrollment row (unique key guard)
        await Academy.findOneAndDelete({ player: playerId });

        const data = await Academy.create({ player: playerId, addedBy, level });
        await User.findByIdAndUpdate(playerId, { $set: { academy: data._id } });
        console.log('[ACADEMY POST] success enrollment=%s', data._id);
        return done(null, data);
      } catch (err) {
        console.error('[ACADEMY POST] error:', err.message);
        return done(err, null);
      }
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
      return Academy.del(options, async (error, data) => {
        if (error) return done(error, null);

        const playerId = _.get(data, 'player._id') || _.get(data, 'player');

        try {
          if (playerId) {
            await User.findByIdAndUpdate(playerId, { $set: { academy: null } });
          }
          return done(null, data);
        } catch (err) {
          return done(err, null);
        }
      });
    },
  })
);

module.exports = router;
