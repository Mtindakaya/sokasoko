const express = require('express');
const { getString } = require('@lykmapipo/env');
const TournamentTeamRegistration = require('./tournament_team_registration.model');
const Tournament = require('../Tournament/tournament.model');
const User = require('../User/user.model');
const Notification = require('../Notification/notification.model');
const { entityLabel } = require('../Utils/utils');

const API_VERSION = getString('API_VERSION', '1.0.0');
const router = express.Router();
const BASE = `/v${API_VERSION.split('.')[0]}/tournament-team-registrations`;

// Team display fields we always want back on the wire.
const TEAM_SELECT =
  'firstName lastName type academy_name entity_name company_name football_field_name accountNumber profileImage region district';

// POST /v1/tournament-team-registrations  body:
//   { tournament, team, category: {gender, ageGroup}, notes? }
// The team requests entry into the tournament. Only ACADEMY / CLUB /
// SCHOOL / FOOTBALL_ASSOCIATION accounts are eligible to enter as a
// team. Category must be one the tournament actually offers.
router.post(BASE, async (req, res) => {
  try {
    const { tournament, team, category, notes, submittedBy } = req.body || {};
    if (!tournament || !team || !category || !submittedBy) {
      return res.status(400).json({
        error: 'tournament, team, category and submittedBy are required',
        errorKey: 'tournament.register.err.missing',
      });
    }
    if (!category.gender || !category.ageGroup) {
      return res.status(400).json({
        error: 'category.gender and category.ageGroup are required',
        errorKey: 'tournament.register.err.category',
      });
    }
    const [t, teamDoc] = await Promise.all([
      Tournament.findById(tournament).lean(),
      User.findById(team).select('type').lean(),
    ]);
    if (!t) {
      return res.status(404).json({
        error: 'Tournament not found',
        errorKey: 'tournament.register.err.not_found',
      });
    }
    if (!t.isPublished) {
      return res.status(403).json({
        error: 'Tournament is not open for registration yet.',
        errorKey: 'tournament.register.err.not_published',
      });
    }
    if (!teamDoc || !['ACADEMY', 'CLUB', 'SCHOOL', 'FOOTBALL_ASSOCIATION'].includes(teamDoc.type)) {
      return res.status(403).json({
        error: 'Only academy, club, school or FA accounts can register as a team.',
        errorKey: 'tournament.register.err.not_team_account',
      });
    }
    const catOffered = (t.categories || []).some(
      (c) => c.gender === category.gender && c.ageGroup === category.ageGroup,
    );
    if (!catOffered) {
      return res.status(400).json({
        error: 'This tournament does not offer that gender + age category.',
        errorKey: 'tournament.register.err.category_not_offered',
      });
    }
    // Check capacity.
    const approvedCount = await TournamentTeamRegistration.countDocuments({
      tournament,
      status: 'APPROVED',
    });
    if (t.maxTeams && approvedCount >= t.maxTeams) {
      return res.status(409).json({
        error: 'Tournament is full.',
        errorKey: 'tournament.register.err.full',
      });
    }

    let reg;
    try {
      reg = await TournamentTeamRegistration.create({
        tournament,
        team,
        category,
        submittedBy,
        notes: notes || '',
      });
    } catch (err) {
      if (err && err.code === 11000) {
        return res.status(409).json({
          error: 'Team has already applied for this category.',
          errorKey: 'tournament.register.err.duplicate',
        });
      }
      throw err;
    }

    // Notify the organizer.
    try {
      const [teamUser, actor] = await Promise.all([
        User.findById(team).select(TEAM_SELECT).lean(),
        User.findById(submittedBy).select('firstName lastName').lean(),
      ]);
      const teamName = entityLabel(teamUser) || 'Timu';
      const actorName = actor
        ? `${actor.firstName || ''} ${actor.lastName || ''}`.trim()
        : teamName;
      await Notification.create({
        userId: t.organizer,
        type: 'SYSTEM',
        title: 'Ombi jipya la kujiunga',
        body: `${teamName} wameomba kujiunga na mashindano yako.`,
        titleKey: 'notif.tournament.reg.received.title',
        bodyKey: 'notif.tournament.reg.received.body',
        params: {
          team: teamName,
          actor: actorName,
          category: `${category.gender} · ${category.ageGroup}`,
          tournament: t.name || '',
        },
        metadata: {
          kind: 'TOURNAMENT_TEAM_REG_RECEIVED',
          tournamentId: tournament,
          registrationId: reg._id,
        },
      });
    } catch (nErr) {
      console.log('[tt-reg] organizer notify failed:', nErr.message);
    }

    return res.status(201).json({ data: reg });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/tournament-team-registrations?tournament=<id>&status=<PENDING|...>
// Also supports ?team=<id> for a team to see their own pending / approved
// registrations across tournaments.
router.get(BASE, async (req, res) => {
  try {
    const { tournament, team, status } = req.query;
    const filter = {};
    if (tournament) filter.tournament = tournament;
    if (team) filter.team = team;
    if (status) filter.status = status;
    if (!tournament && !team) {
      return res.status(400).json({ error: 'tournament or team query param required' });
    }
    const rows = await TournamentTeamRegistration.find(filter)
      .populate('team', TEAM_SELECT)
      .populate('submittedBy', 'firstName lastName type')
      .populate('reviewedBy', 'firstName lastName')
      .populate('tournament', 'name type startDate endDate maxTeams categories organizer')
      .sort({ createdAt: -1 })
      .lean();
    return res.status(200).json({ data: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /v1/tournament-team-registrations/:id/review  body:
//   { action: 'APPROVE'|'REJECT'|'WITHDRAW', reviewerId, rejectionReason? }
// Organizer approves/rejects. Team can WITHDRAW their own pending request.
router.patch(`${BASE}/:id/review`, async (req, res) => {
  try {
    const { action, reviewerId, rejectionReason } = req.body || {};
    if (!['APPROVE', 'REJECT', 'WITHDRAW'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action' });
    }
    const reg = await TournamentTeamRegistration.findById(req.params.id);
    if (!reg) return res.status(404).json({ error: 'Registration not found' });

    const tournament = await Tournament.findById(reg.tournament).lean();
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });

    // Authorization: organizer for APPROVE/REJECT, team for WITHDRAW.
    const reviewerIdStr = reviewerId ? String(reviewerId) : '';
    if (action === 'WITHDRAW') {
      if (reviewerIdStr !== String(reg.team) && reviewerIdStr !== String(reg.submittedBy)) {
        return res.status(403).json({
          error: 'Only the team can withdraw its own application.',
          errorKey: 'tournament.register.err.withdraw_forbidden',
        });
      }
    } else if (reviewerIdStr !== String(tournament.organizer)) {
      return res.status(403).json({
        error: 'Only the tournament organizer can review applications.',
        errorKey: 'tournament.register.err.review_forbidden',
      });
    }

    if (action === 'APPROVE') {
      reg.status = 'APPROVED';
      reg.reviewedBy = reviewerId;
      reg.reviewedAt = new Date();
      reg.rejectionReason = '';
      await reg.save();
      // Push team into Tournament.teams[] if not already present.
      const t = await Tournament.findById(reg.tournament);
      if (t) {
        const teamIdStr = String(reg.team);
        const already = (t.teams || []).some((x) => String(x) === teamIdStr);
        if (!already) {
          t.teams.push(reg.team);
          await t.save();
        }
      }
    } else if (action === 'REJECT') {
      reg.status = 'REJECTED';
      reg.reviewedBy = reviewerId;
      reg.reviewedAt = new Date();
      reg.rejectionReason = rejectionReason || '';
      await reg.save();
    } else if (action === 'WITHDRAW') {
      reg.status = 'WITHDRAWN';
      reg.reviewedBy = reviewerId;
      reg.reviewedAt = new Date();
      await reg.save();
    }

    // Notify the team account on APPROVE / REJECT.
    if (action === 'APPROVE' || action === 'REJECT') {
      try {
        const teamUser = await User.findById(reg.team).select(TEAM_SELECT).lean();
        const teamName = entityLabel(teamUser) || 'Timu';
        const isApproved = action === 'APPROVE';
        await Notification.create({
          userId: reg.team,
          type: 'SYSTEM',
          title: isApproved
            ? 'Ombi limekubaliwa'
            : 'Ombi limekataliwa',
          body: isApproved
            ? `Timu yako imekubaliwa katika mashindano ${tournament.name || ''}.`
            : `Ombi lako la kujiunga na ${tournament.name || 'mashindano'} halikukubalika${rejectionReason ? `: ${rejectionReason}` : ''}.`,
          titleKey: isApproved
            ? 'notif.tournament.reg.approved.title'
            : 'notif.tournament.reg.rejected.title',
          bodyKey: isApproved
            ? 'notif.tournament.reg.approved.body'
            : 'notif.tournament.reg.rejected.body',
          params: {
            team: teamName,
            tournament: tournament.name || '',
            reason: rejectionReason || '',
          },
          metadata: {
            kind: isApproved
              ? 'TOURNAMENT_TEAM_REG_APPROVED'
              : 'TOURNAMENT_TEAM_REG_REJECTED',
            tournamentId: String(reg.tournament),
            registrationId: reg._id,
          },
        });
      } catch (nErr) {
        console.log('[tt-reg] team notify failed:', nErr.message);
      }
    }

    return res.status(200).json({ data: reg });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
