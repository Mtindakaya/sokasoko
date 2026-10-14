const express = require('express');
const User = require('../User/user.model');
const Notification = require('../Notification/notification.model');
const {
  FormTeam, ClassTeam, FORM_LEVELS, PLAYER_CAP,
} = require('./school_team.model');

const router = express.Router();

// ── Shared helpers ──────────────────────────────────────────────────

function modelFor(kind) {
  if (kind === 'form') return FormTeam;
  if (kind === 'class') return ClassTeam;
  return null;
}

function labelFor(kind) {
  return kind === 'class' ? 'Class Team' : 'Form Team';
}

function populatePlayers(query) {
  return query
    .populate('captain',
      'firstName lastName academy_name accountNumber profileImage')
    .populate('assistantCaptain',
      'firstName lastName academy_name accountNumber profileImage')
    .populate('players',
      'firstName lastName accountNumber profileImage '
      + 'school_form college_year school_verified_by_staff');
}

async function notifyPlayer(playerId, {
  titleKey, bodyKey, title, body, params, metadata,
}) {
  try {
    await Notification.create({
      userId: playerId,
      type: 'SYSTEM',
      title, body, titleKey, bodyKey,
      params, metadata,
    });
  } catch (err) {
    console.log('[SchoolTeam] notify failed:', err.message);
  }
}

// Rejects a player whose school_form doesn't match the team's formLevel.
// Also forbids adding a player to two different teams of the same kind
// in the same school.
async function assertEligibleMember(team, playerId, kind) {
  const Model = modelFor(kind);
  const player = await User.findById(playerId)
    .select('_id type school school_form college_year')
    .lean();
  if (!player) return { ok: false, status: 404, error: 'Player not found' };
  if (player.type !== 'PLAYER') {
    return { ok: false, status: 400, error: 'Only PLAYER accounts can join a team' };
  }
  if (String(player.school) !== String(team.school)) {
    return { ok: false, status: 400, error: 'Player is not linked to this school' };
  }
  // Idara (college department) teams span years — skip the formLevel
  // match and accept any player on the school.
  if (!team.department) {
    const expected = team.formLevel;
    const actual = (player.school_form || '').trim();
    // College uses college_year — build a YEAR_<n> sentinel from the
    // player's college_year so the comparison stays single-field.
    const normalisedActual = actual
      || (player.college_year ? `YEAR_${player.college_year}` : '');
    if (normalisedActual !== expected) {
      return {
        ok: false, status: 400,
        error: `Player's form (${normalisedActual || 'unset'}) does not match team formLevel (${expected})`,
      };
    }
  }
  // Exclusive membership per kind per school.
  const existing = await Model.findOne({
    school: team.school,
    _id: { $ne: team._id },
    players: playerId,
  }).select('_id').lean();
  if (existing) {
    return {
      ok: false, status: 400,
      error: `Player already on another ${kind} team in this school`,
    };
  }
  return { ok: true };
}

// Guard rail — Sports Teacher authorisation is still client-side only
// here (the client only exposes these actions to school staff). A
// future gate can bind this to req.user when auth middleware lands.

// ── Routes ──────────────────────────────────────────────────────────

// GET /v1/schools/:schoolId/<kind>-teams
function registerList(kind) {
  router.get(`/v1/schools/:schoolId/${kind}-teams`, async (req, res) => {
    try {
      const q = populatePlayers(
        modelFor(kind).find({ school: req.params.schoolId }).sort({ formLevel: 1 }),
      );
      const rows = await q.lean();
      return res.status(200).json({ data: rows });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });
}
registerList('form');
registerList('class');

// GET /v1/users/:playerId/my-school-teams — all teams on which the
// player is captain or assistant captain. Returns both kinds so the
// client can render a single list without two round-trips. School is
// populated so the captain screen can navigate into the detail view
// without a separate school fetch.
router.get('/v1/users/:playerId/my-school-teams', async (req, res) => {
  try {
    const pid = req.params.playerId;
    const filter = { $or: [{ captain: pid }, { assistantCaptain: pid }] };
    const populateSchool = (q) => q.populate('school',
      '_id academy_name school_type profileImage accountNumber');
    const [formTeams, classTeams] = await Promise.all([
      populateSchool(populatePlayers(FormTeam.find(filter))).lean(),
      populateSchool(populatePlayers(ClassTeam.find(filter))).lean(),
    ]);
    return res.status(200).json({
      data: { form: formTeams, class: classTeams },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/schools/:schoolId/<kind>-teams — create.
function registerCreate(kind) {
  router.post(`/v1/schools/:schoolId/${kind}-teams`, async (req, res) => {
    try {
      const { formLevel, streamLetter, department } = req.body || {};
      const departmentName = (department || '').toString().trim();
      const isIdaraTeam = kind === 'class' && departmentName.length > 0;

      if (!isIdaraTeam) {
        if (!formLevel || !FORM_LEVELS.includes(formLevel)) {
          return res.status(400).json({ error: 'formLevel is required and must be a canonical code' });
        }
        if (kind === 'class') {
          const letter = (streamLetter || '').trim();
          if (!letter) {
            return res.status(400).json({ error: 'streamLetter is required for class teams' });
          }
        }
      }
      const school = await User.findById(req.params.schoolId)
        .select('_id type').lean();
      if (!school || school.type !== 'SCHOOL') {
        return res.status(404).json({ error: 'School not found' });
      }
      const payload = {
        school: req.params.schoolId,
        players: [],
      };
      if (isIdaraTeam) {
        payload.department = departmentName;
      } else {
        payload.formLevel = formLevel;
        if (kind === 'class') payload.streamLetter = streamLetter.trim();
      }
      const doc = await modelFor(kind).create(payload);
      return res.status(201).json({ data: doc });
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({
          error: kind === 'class'
            ? 'A class team with this stream or department already exists for this school'
            : 'A form team for this level already exists',
        });
      }
      return res.status(500).json({ error: err.message });
    }
  });
}
registerCreate('form');
registerCreate('class');

// POST /v1/<kind>-teams/:id/players  { playerId }
function registerAddPlayer(kind) {
  router.post(`/v1/${kind}-teams/:id/players`, async (req, res) => {
    try {
      const { playerId } = req.body || {};
      if (!playerId) return res.status(400).json({ error: 'playerId is required' });
      const team = await modelFor(kind).findById(req.params.id);
      if (!team) return res.status(404).json({ error: 'Team not found' });
      if (team.players.length >= PLAYER_CAP) {
        return res.status(400).json({
          error: `Team is full (${PLAYER_CAP}/${PLAYER_CAP})`,
        });
      }
      if (team.players.some((p) => String(p) === String(playerId))) {
        return res.status(400).json({ error: 'Player already on this team' });
      }
      const eligible = await assertEligibleMember(team, playerId, kind);
      if (!eligible.ok) {
        return res.status(eligible.status).json({ error: eligible.error });
      }
      team.players.push(playerId);
      await team.save();

      // Adding a player to any school team implicitly verifies them.
      // Reuse the existing school_verified_by_staff flag so the
      // profile side already knows the drill.
      await User.updateOne(
        { _id: playerId, school_verified_by_staff: { $ne: true } },
        { $set: { school_verified_by_staff: true } },
      );

      await notifyPlayer(playerId, {
        titleKey: `notif.school_team.${kind}.added.title`,
        bodyKey: `notif.school_team.${kind}.added.body`,
        title: `Umeongezwa kwenye ${labelFor(kind)}`,
        body: team.department
          ? `Umeongezwa kwenye timu ya Idara ya ${team.department}`
          : `Umeongezwa kwenye timu ya ${team.formLevel}`
            + (kind === 'class' && team.streamLetter
              ? ` stream ${team.streamLetter}` : ''),
        params: {
          formLevel: team.formLevel || '',
          streamLetter: team.streamLetter || '',
          department: team.department || '',
        },
        metadata: {
          kind: kind === 'class'
            ? 'SCHOOL_CLASS_TEAM_ADDED' : 'SCHOOL_FORM_TEAM_ADDED',
          teamId: team._id,
          schoolId: team.school,
        },
      });

      return res.status(200).json({ data: team });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });
}
registerAddPlayer('form');
registerAddPlayer('class');

// DELETE /v1/<kind>-teams/:id/players/:playerId
function registerRemovePlayer(kind) {
  router.delete(
    `/v1/${kind}-teams/:id/players/:playerId`,
    async (req, res) => {
      try {
        const team = await modelFor(kind).findById(req.params.id);
        if (!team) return res.status(404).json({ error: 'Team not found' });
        const pid = req.params.playerId;
        team.players = team.players.filter((p) => String(p) !== String(pid));
        if (String(team.captain) === String(pid)) team.captain = null;
        if (String(team.assistantCaptain) === String(pid)) {
          team.assistantCaptain = null;
        }
        await team.save();
        await notifyPlayer(pid, {
          titleKey: `notif.school_team.${kind}.removed.title`,
          bodyKey: `notif.school_team.${kind}.removed.body`,
          title: `Umeondolewa kwenye ${labelFor(kind)}`,
          body: team.department
            ? `Mwalimu wa michezo amekuondoa kwenye timu ya Idara ya ${team.department}`
            : `Mwalimu wa michezo amekuondoa kwenye timu ya ${team.formLevel}`
              + (kind === 'class' && team.streamLetter
                ? ` stream ${team.streamLetter}` : ''),
          params: {
            formLevel: team.formLevel || '',
            streamLetter: team.streamLetter || '',
            department: team.department || '',
          },
          metadata: {
            kind: kind === 'class'
              ? 'SCHOOL_CLASS_TEAM_REMOVED' : 'SCHOOL_FORM_TEAM_REMOVED',
            teamId: team._id,
            schoolId: team.school,
          },
        });
        return res.status(200).json({ data: team });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    },
  );
}
registerRemovePlayer('form');
registerRemovePlayer('class');

// POST /v1/<kind>-teams/:id/captain { playerId } — null to clear.
// Idempotent; player must be on the team's roster first.
function registerSetCaptain(kind, role) {
  const field = role; // 'captain' or 'assistantCaptain'
  router.post(`/v1/${kind}-teams/:id/${role === 'captain' ? 'captain' : 'assistant-captain'}`,
    async (req, res) => {
      try {
        const { playerId } = req.body || {};
        const team = await modelFor(kind).findById(req.params.id);
        if (!team) return res.status(404).json({ error: 'Team not found' });
        if (playerId) {
          if (!team.players.some((p) => String(p) === String(playerId))) {
            return res.status(400).json({
              error: 'Player must be on the team roster before being appointed',
            });
          }
          // Can't be both captain + assistant on the same team.
          if (role === 'captain'
              && String(team.assistantCaptain) === String(playerId)) {
            team.assistantCaptain = null;
          }
          if (role === 'assistantCaptain'
              && String(team.captain) === String(playerId)) {
            team.captain = null;
          }
        }
        team[field] = playerId || null;
        await team.save();
        if (playerId) {
          await notifyPlayer(playerId, {
            titleKey: `notif.school_team.${kind}.${role}_set.title`,
            bodyKey: `notif.school_team.${kind}.${role}_set.body`,
            title: role === 'captain'
              ? 'Umekuwa Nahodha wa timu'
              : 'Umekuwa Msaidizi wa Nahodha',
            body: team.department
              ? `Timu ya Idara ya ${team.department}`
              : `Timu ya ${team.formLevel}`
                + (kind === 'class' && team.streamLetter
                  ? ` stream ${team.streamLetter}` : ''),
            params: {
              formLevel: team.formLevel || '',
              streamLetter: team.streamLetter || '',
              department: team.department || '',
            },
            metadata: {
              kind: `SCHOOL_${kind.toUpperCase()}_TEAM_${role.toUpperCase()}_SET`,
              teamId: team._id,
              schoolId: team.school,
            },
          });
        }
        return res.status(200).json({ data: team });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    });
}
registerSetCaptain('form', 'captain');
registerSetCaptain('form', 'assistantCaptain');
registerSetCaptain('class', 'captain');
registerSetCaptain('class', 'assistantCaptain');

// POST /v1/<kind>-teams/:id/disable { active: boolean }
function registerDisable(kind) {
  router.post(`/v1/${kind}-teams/:id/disable`, async (req, res) => {
    try {
      const active = !(req.body && req.body.active === false
        || req.body && req.body.active === 'false');
      const team = await modelFor(kind).findByIdAndUpdate(
        req.params.id, { $set: { active } }, { new: true },
      );
      if (!team) return res.status(404).json({ error: 'Team not found' });
      return res.status(200).json({ data: team });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });
}
registerDisable('form');
registerDisable('class');

// DELETE /v1/<kind>-teams/:id — hard-delete. Sports teacher only.
function registerDelete(kind) {
  router.delete(`/v1/${kind}-teams/:id`, async (req, res) => {
    try {
      const removed = await modelFor(kind).findByIdAndDelete(req.params.id);
      if (!removed) return res.status(404).json({ error: 'Team not found' });
      return res.status(200).json({ data: removed });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });
}
registerDelete('form');
registerDelete('class');

module.exports = router;
