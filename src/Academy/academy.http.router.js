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
const { Subscription, FEATURE_CAPS } = require('../Subscription/subscription.model');

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

        // ACADEMY tier gate — roster composition (age levels + gender).
        // Standard: 1 age level + 1 gender only.
        // Gold:     up to 3 age levels + mixed gender.
        // Platinum: unlimited age levels + mixed gender.
        try {
          const acad = addedBy ? await User.findById(addedBy).select('type').lean() : null;
          if (acad?.type === 'ACADEMY') {
            const tier = await Subscription.getEffectiveTier(addedBy, 'ACADEMY');
            const caps = FEATURE_CAPS.ACADEMY?.[tier] || {};
            const existingRows = await Academy.find({ addedBy })
              .populate('player', 'gender')
              .lean();
            const currentLevels = new Set(
              existingRows.map(r => r.level).filter(Boolean));
            const currentGenders = new Set(
              existingRows.map(r => r.player?.gender).filter(Boolean));
            const nextLevels = new Set(currentLevels);
            if (level) nextLevels.add(level);
            const nextGenders = new Set(currentGenders);
            if (player.gender) nextGenders.add(player.gender);
            if (caps.maxAgeLevels != null && nextLevels.size > caps.maxAgeLevels) {
              return done(new Error(
                `Kifurushi cha ${tier} kinaruhusu makundi ya umri ${caps.maxAgeLevels} tu. Boresha kifurushi.`
              ), null);
            }
            if (caps.mixedGender === false && nextGenders.size > 1) {
              return done(new Error(
                `Kifurushi cha ${tier} kinaruhusu jinsia moja tu kwenye roster. Boresha kifurushi.`
              ), null);
            }
          }
        } catch (e) {
          console.log('[ACADEMY POST] tier check error:', e.message);
        }

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
