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
const Notification = require('../Notification/notification.model');
const { Subscription, FEATURE_CAPS } = require('../Subscription/subscription.model');

const router = new Router({
  version: API_VERSION,
});

// Helper: label an org (ACADEMY or CLUB) with its readable name.
async function orgName(orgId) {
  if (!orgId) return 'Chuo';
  const u = await User.findById(orgId).select('academy_name firstName lastName').lean();
  if (!u) return 'Chuo';
  return (u.academy_name && u.academy_name.trim())
    || `${u.firstName || ''} ${u.lastName || ''}`.trim()
    || 'Chuo';
}

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
        // Only VERIFIED rows count toward the cap — a PENDING invite the
        // player hasn't answered yet should not consume the roster slot.
        try {
          const acad = addedBy ? await User.findById(addedBy).select('type').lean() : null;
          if (acad?.type === 'ACADEMY') {
            const tier = await Subscription.getEffectiveTier(addedBy, 'ACADEMY');
            const caps = FEATURE_CAPS.ACADEMY?.[tier] || {};
            const existingRows = await Academy.find({
              addedBy,
              verificationStatus: 'VERIFIED',
            })
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

        // Reject if the player is already VERIFIED into an academy.
        if (player.academy) {
          const existing = await Academy.findById(player.academy).lean();
          if (existing && existing.verificationStatus === 'VERIFIED') {
            return done(new Error('Player is already enrolled in an academy'), null);
          }
          // Dangling / non-verified reference — clear so a fresh invite lands.
          if (!existing) {
            await User.findByIdAndUpdate(playerId, { $set: { academy: null } });
          }
        }

        // Reject if a PENDING invite from the SAME academy already exists.
        const dup = await Academy.findOne({
          player: playerId,
          addedBy,
          verificationStatus: 'PENDING',
        }).lean();
        if (dup) {
          return done(new Error(
            'Ombi lako la awali linasubiri majibu ya mchezaji. Please wait — the previous invitation is still pending.'
          ), null);
        }

        // Create invite in PENDING state. User.academy stays null until
        // the player verifies. Notification to the player triggers the
        // guardian fan-out hook automatically.
        const data = await Academy.create({
          player: playerId,
          addedBy,
          level,
          verificationStatus: 'PENDING',
        });
        console.log('[ACADEMY POST] invite created id=%s status=PENDING', data._id);

        try {
          const orgLabel = await orgName(addedBy);
          await Notification.create({
            userId: playerId,
            type: 'SYSTEM',
            title: 'Ombi la Kujiunga · Academy Invitation',
            body:
              `${orgLabel} amekuomba ujiunge nao (umri: ${level}). ` +
              `Fungua Verifications kwenye profile yako kuthibitisha au kukataa. ` +
              `${orgLabel} has invited you to join (level: ${level}). ` +
              `Open Verifications in your profile to accept or decline.`,
            metadata: {
              kind: 'ACADEMY_INVITE',
              academyEnrollmentId: data._id,
              addedBy,
              level,
            },
          });
        } catch (nErr) {
          console.log('[ACADEMY POST] notification failed:', nErr.message);
        }

        return done(null, data);
      } catch (err) {
        console.error('[ACADEMY POST] error:', err.message);
        return done(err, null);
      }
    },
  })
);

// GET /v1/academys/pending/:playerId — invitations awaiting the player's
// verification. Populates addedBy for the client to show "X invited you".
router.get('/academys/pending/:playerId', async (req, res) => {
  try {
    const rows = await Academy.find({
      player: req.params.playerId,
      verificationStatus: 'PENDING',
    })
      .populate('addedBy', 'firstName lastName academy_name type accountNumber profileImage')
      .sort({ createdAt: -1 })
      .lean();
    return res.status(200).json({ data: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/academys/:id/verify — player accepts the invitation. Sets
// User.academy and flips the row to VERIFIED. Fires confirmation
// notification which the guardian fan-out picks up.
router.post('/academys/:id/verify', async (req, res) => {
  try {
    const row = await Academy.findById(req.params.id);
    if (!row) return res.status(404).json({ error: 'Invitation not found' });
    if (row.verificationStatus === 'VERIFIED') {
      return res.status(200).json({ data: row });
    }
    if (row.verificationStatus === 'REJECTED') {
      return res.status(400).json({ error: 'Invitation was previously declined' });
    }

    row.verificationStatus = 'VERIFIED';
    row.verifiedAt = new Date();
    await row.save();
    await User.findByIdAndUpdate(row.player, { $set: { academy: row._id } });

    try {
      const orgLabel = await orgName(row.addedBy);
      await Notification.create({
        userId: row.player,
        type: 'SYSTEM',
        title: 'Umejiunga na Chuo · Enrollment Confirmed',
        body:
          `Umejiunga rasmi na ${orgLabel} (umri: ${row.level}). ` +
          `You have officially joined ${orgLabel} at level ${row.level}.`,
        metadata: {
          kind: 'ACADEMY_VERIFIED',
          academyEnrollmentId: row._id,
        },
      });
      // Also let the academy know their invite was accepted.
      await Notification.create({
        userId: row.addedBy,
        type: 'SYSTEM',
        title: 'Ombi Limekubaliwa · Player Accepted',
        body:
          `Mchezaji amekubali ombi lako la kujiunga (umri: ${row.level}). ` +
          `A player has accepted your invitation (level: ${row.level}).`,
        metadata: {
          kind: 'ACADEMY_ACCEPTED_BY_PLAYER',
          academyEnrollmentId: row._id,
          playerId: row.player,
        },
      });
    } catch (nErr) {
      console.log('[ACADEMY VERIFY] notification failed:', nErr.message);
    }

    return res.status(200).json({ data: row });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/academys/:id/reject — player declines the invitation. Row is
// kept for audit (status REJECTED), no User.academy linkage.
router.post('/academys/:id/reject', async (req, res) => {
  try {
    const reason = (req.body && req.body.reason ? String(req.body.reason) : '').slice(0, 300);
    const row = await Academy.findById(req.params.id);
    if (!row) return res.status(404).json({ error: 'Invitation not found' });
    if (row.verificationStatus === 'REJECTED') {
      return res.status(200).json({ data: row });
    }
    if (row.verificationStatus === 'VERIFIED') {
      return res.status(400).json({
        error: 'Already verified — use leave-academy to remove.',
      });
    }
    row.verificationStatus = 'REJECTED';
    row.rejectedAt = new Date();
    await row.save();

    try {
      const orgLabel = await orgName(row.addedBy);
      await Notification.create({
        userId: row.addedBy,
        type: 'SYSTEM',
        title: 'Ombi Limekataliwa · Invitation Declined',
        body:
          `Mchezaji amekataa ombi lako la kujiunga na ${orgLabel}` +
          (reason ? ` (sababu: ${reason})` : '') + '. ' +
          `A player has declined your invitation to ${orgLabel}` +
          (reason ? ` (reason: ${reason})` : '') + '.',
        metadata: {
          kind: 'ACADEMY_DECLINED_BY_PLAYER',
          academyEnrollmentId: row._id,
          playerId: row.player,
          reason: reason || null,
        },
      });
    } catch (nErr) {
      console.log('[ACADEMY REJECT] notification failed:', nErr.message);
    }

    return res.status(200).json({ data: row });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

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
