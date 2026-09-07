const express = require('express');
const User = require('./user.model');
const Academy = require('../Academy/academy.model');
const Notification = require('../Notification/notification.model');
const CareerEvent = require('../CareerEvent/career_event.model');

// Helper: resolve an org's readable display name (used as the
// entityNameSnapshot on CareerEvent so the CV row still labels
// correctly even if the org later renames).
async function orgDisplayName(orgId) {
  if (!orgId) return '';
  const u = await User.findById(orgId)
    .select('academy_name company_name entity_name firstName lastName').lean();
  if (!u) return '';
  return (u.academy_name && u.academy_name.trim())
    || (u.company_name && u.company_name.trim())
    || (u.entity_name && u.entity_name.trim())
    || `${u.firstName || ''} ${u.lastName || ''}`.trim();
}

async function closeOpenEvent({ player, entity, reason }) {
  try {
    await CareerEvent.updateOne(
      { player, entity, leftAt: null },
      { $set: { leftAt: new Date(), leaveReason: (reason || '').trim() } },
    );
  } catch (err) {
    console.log('[CAREER_EVENT] close failed:', err.message);
  }
}

const router = express.Router();

// POST /v1/users/:id/link-coach
router.post('/v1/users/:id/link-coach', async (req, res) => {
  try {
    const { coachId, requestedBy } = req.body;
    const academy = await User.findById(req.params.id);
    if (!academy) return res.status(404).json({ error: 'Academy not found' });
    if (academy.type !== 'ACADEMY') return res.status(400).json({ error: 'User is not an academy' });

    const coach = await User.findById(coachId);
    if (!coach) return res.status(404).json({ error: 'Coach not found' });
    if (coach.type !== 'COACH') return res.status(400).json({ error: 'User is not a coach' });

    const wasLinkedElsewhere =
      coach.linkedAcademy && coach.linkedAcademy.toString() !== academy._id.toString();
    if (wasLinkedElsewhere) {
      await closeOpenEvent({
        player: coach._id, entity: coach.linkedAcademy, reason: '',
      });
    }
    coach.linkedAcademy = academy._id;
    await coach.save();

    // Open a CareerEvent for the new coaching stint — skip when there's
    // already an open event at this academy (idempotent). coachRole and
    // ageLevels start empty; the coach fills them from the CV screen.
    try {
      const dupe = await CareerEvent.findOne({
        player: coach._id, entity: academy._id, leftAt: null,
      }).select('_id').lean();
      if (!dupe) {
        const nameSnap = await orgDisplayName(academy._id);
        await CareerEvent.create({
          player: coach._id,
          entity: academy._id,
          entityType: 'ACADEMY',
          entityNameSnapshot: nameSnap,
          role: 'COACH',
          joinedAt: new Date(),
          source: 'COACH_LINK',
          sourceRef: academy._id,
        });
        // Nudge the coach to fill in age groups + role for this stint.
        try {
          await Notification.create({
            userId: coach._id,
            type: 'SYSTEM',
            title: 'Weka vikundi vya umri unavyofundisha',
            body: `Umeunganishwa na ${nameSnap}. Fungua CV yako uchague vikundi vya umri na jukumu lako.`,
            titleKey: 'notif.coach.link.details_title',
            bodyKey: 'notif.coach.link.details_body',
            params: { org: nameSnap },
            metadata: {
              kind: 'COACH_LINK_DETAILS',
              academyId: academy._id.toString(),
            },
          });
        } catch (_) {}
      }
    } catch (ceErr) {
      console.log('[LINK-COACH] career-event write failed:', ceErr.message);
    }

    return res.status(200).json({ message: 'Coach linked successfully', coach });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/users/:id/link-owner
router.post('/v1/users/:id/link-owner', async (req, res) => {
  try {
    const { userId } = req.body;
    const academy = await User.findByIdAndUpdate(req.params.id, { owner: userId }, { new: true });
    if (!academy) return res.status(404).json({ error: 'Academy not found' });
    return res.status(200).json({ data: academy });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/users/:id/link-secretary
router.post('/v1/users/:id/link-secretary', async (req, res) => {
  try {
    const { userId } = req.body;
    const academy = await User.findByIdAndUpdate(req.params.id, { secretary: userId }, { new: true });
    if (!academy) return res.status(404).json({ error: 'Academy not found' });
    return res.status(200).json({ data: academy });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/users/:id/unlink-coach
// Coach ends their linkedAcademy stint. Closes the open CareerEvent
// with the given reason.
router.post('/v1/users/:id/unlink-coach', async (req, res) => {
  try {
    const reason = (req.body && req.body.reason) ? req.body.reason.trim() : '';
    const coach = await User.findById(req.params.id);
    if (!coach) return res.status(404).json({ error: 'Coach not found' });
    if (coach.type !== 'COACH') return res.status(400).json({ error: 'User is not a coach' });
    const prev = coach.linkedAcademy;
    coach.linkedAcademy = null;
    await coach.save();
    if (prev) {
      await closeOpenEvent({ player: coach._id, entity: prev, reason });
    }
    return res.status(200).json({ data: coach });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/users/:id/coaches
router.get('/v1/users/:id/coaches', async (req, res) => {
  try {
    const coaches = await User.find({ linkedAcademy: req.params.id, type: 'COACH' });
    return res.status(200).json({ data: coaches });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /v1/users/:id/unlink-school
router.delete('/v1/users/:id/unlink-school', async (req, res) => {
  try {
    const reason = (req.body && req.body.reason) ? req.body.reason.trim() : '';
    const player = await User.findById(req.params.id).lean();
    if (!player) return res.status(404).json({ error: 'Player not found' });

    const updated = await User.findByIdAndUpdate(
      req.params.id,
      { $set: { school: null, school_class: null, school_jersey_number: null } },
      { new: true }
    );

    if (reason) {
      console.log(`[LEAVE-SCHOOL] player=${req.params.id} school=${player.school} reason="${reason}"`);
    }

    if (player.school) {
      await closeOpenEvent({
        player: req.params.id, entity: player.school, reason,
      });
    }

    try {
      await Notification.create({
        userId: req.params.id,
        type: 'SYSTEM',
        title: 'Umeondoka Shuleni',
        body:
          'Umejitoa kutoka shule yako iliyosajiliwa SokaSoko.' +
          (reason ? ` Sababu: ${reason}` : ''),
        titleKey: 'notif.left_school.title',
        bodyKey: reason ? 'notif.left_school.body_with_reason' : 'notif.left_school.body',
        params: reason ? { reason } : {},
        metadata: { previousSchoolId: player.school, reason: reason || null },
      });
    } catch (notifyErr) {
      console.log('[LEAVE-SCHOOL] notification error:', notifyErr.message);
    }

    return res.status(200).json(updated);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/users/:id/leave-academy
router.post('/v1/users/:id/leave-academy', async (req, res) => {
  try {
    const { enrollmentId, reason } = req.body || {};
    if (!enrollmentId) return res.status(400).json({ error: 'enrollmentId is required' });

    const enrollment = await Academy.findById(enrollmentId);
    if (!enrollment) return res.status(404).json({ error: 'Enrollment not found' });

    const academyId = enrollment.addedBy;
    // Close the open CareerEvent BEFORE deleting the Academy row —
    // otherwise the sourceRef points to a deleted doc and the leaveReason
    // is lost.
    await closeOpenEvent({
      player: req.params.id, entity: academyId, reason,
    });
    await Academy.findByIdAndDelete(enrollmentId);

    const updated = await User.findByIdAndUpdate(
      req.params.id,
      { $set: { academy: null } },
      { new: true }
    );

    if (reason) {
      console.log(`[LEAVE-ACADEMY] player=${req.params.id} academy=${academyId} reason="${reason}"`);
    }

    try {
      await Notification.create({
        userId: req.params.id,
        type: 'SYSTEM',
        title: 'Umeondoka Kituo cha Mpira',
        body:
          'Umejitoa kutoka kituo chako cha mpira SokaSoko.' +
          (reason ? ` Sababu: ${reason}` : ''),
        titleKey: 'notif.left_academy.title',
        bodyKey: reason ? 'notif.left_academy.body_with_reason' : 'notif.left_academy.body',
        params: reason ? { reason } : {},
        metadata: { previousAcademyId: academyId, reason: reason || null },
      });
    } catch (notifyErr) {
      console.log('[LEAVE-ACADEMY] notification error:', notifyErr.message);
    }

    return res.status(200).json(updated);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/users/:id/link-school
router.post('/v1/users/:id/link-school', async (req, res) => {
  try {
    const player = await User.findById(req.params.id).lean();
    if (!player) return res.status(404).json({ error: 'Player not found' });

    if (player.school && player.school.toString() !== req.body.schoolId) {
      return res.status(409).json({ error: 'Player is already enrolled in another school' });
    }

    const updateData = { school: req.body.schoolId };
    if (req.body.school_class) updateData.school_class = req.body.school_class;
    if (req.body.school_jersey_number) updateData.school_jersey_number = req.body.school_jersey_number;

    const updated = await User.findByIdAndUpdate(
      req.params.id,
      { $set: updateData },
      { new: true }
    );

    // Open a CareerEvent for this school stint — idempotent so
    // re-hitting link-school with the same school (e.g. class update)
    // doesn't create duplicates.
    try {
      const dupe = await CareerEvent.findOne({
        player: req.params.id, entity: req.body.schoolId, leftAt: null,
      }).select('_id').lean();
      if (!dupe) {
        const nameSnap = await orgDisplayName(req.body.schoolId);
        await CareerEvent.create({
          player: req.params.id,
          entity: req.body.schoolId,
          entityType: 'SCHOOL',
          entityNameSnapshot: nameSnap,
          level: req.body.school_class || '',
          role: 'STUDENT',
          joinedAt: new Date(),
          source: 'SCHOOL_LINK',
          sourceRef: req.body.schoolId,
        });
      }
    } catch (ceErr) {
      console.log('[LINK-SCHOOL] career-event write failed:', ceErr.message);
    }

    return res.status(200).json(updated);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/users/:id/school-players
router.get('/v1/users/:id/school-players', async (req, res) => {
  try {
    const players = await User.find({ school: req.params.id, type: 'PLAYER' })
      .limit(500)
      .lean();
    return res.status(200).json({ data: players });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
