const express = require('express');
const { getString } = require('@lykmapipo/env');
const _ = require('lodash');
const Match = require('./match.model');
const TournamentRegistration = require('../TournamentRegistration/tournament_registration.model');

const API_VERSION = getString('API_VERSION', '1.0.0');
const router = express.Router();
const BASE = `/v${API_VERSION.split('.')[0]}/matches`;

// GET /v1/matches
router.get(BASE, async (req, res) => {
  try {
    const { page = 1, limit = 20, status, tournament, team } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (tournament) filter.tournament = tournament;
    if (team) filter.$or = [{ homeTeam: team }, { awayTeam: team }];

    const [matches, total] = await Promise.all([
      Match.find(filter)
        .populate('homeTeam', 'firstName lastName academy_name type accountNumber profileImage')
        .populate('awayTeam', 'firstName lastName academy_name type accountNumber profileImage')
        .populate('venue', 'name region district')
        .populate('tournament', 'name type')
        .populate('referee', 'firstName lastName accountNumber type')
        .populate('assistantReferee1', 'firstName lastName accountNumber type')
        .populate('assistantReferee2', 'firstName lastName accountNumber type')
        .populate('scout', 'firstName lastName accountNumber type profileImage')
        .select('-playerStats -notes -scheduleDeclinedBy -scheduleConfirmedBy -homeConfirmedBy -awayConfirmedBy -scheduledBy -homeCoach -awayCoach')
        .sort({ scheduledDate: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit))
        .lean(),
      Match.countDocuments(filter),
    ]);
    return res.status(200).json({ data: matches, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/matches/:id
router.get(`${BASE}/:id`, async (req, res) => {
  try {
    const match = await Match.findById(req.params.id)
      .populate('homeTeam', 'firstName lastName academy_name type accountNumber profileImage')
      .populate('awayTeam', 'firstName lastName academy_name type accountNumber profileImage')
      .populate('venue', 'name region district')
      .populate('tournament', 'name type')
      .populate('playerStats.player', 'firstName lastName profileImage accountNumber position type')
      .populate('referee', 'firstName lastName accountNumber type profileImage')
      .populate('assistantReferee1', 'firstName lastName accountNumber type profileImage')
      .populate('assistantReferee2', 'firstName lastName accountNumber type profileImage')
      .populate('homeCoach', 'firstName lastName accountNumber type profileImage')
      .populate('awayCoach', 'firstName lastName accountNumber type profileImage')
      .populate('scout', 'firstName lastName accountNumber type profileImage')
      .populate('tempScouts', 'firstName lastName accountNumber type profileImage')
      .lean();
    if (!match) return res.status(404).json({ error: 'Match not found' });
    return res.status(200).json({ data: match });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/matches — schedule a match
router.post(BASE, async (req, res) => {
  try {
    const { homeTeam, awayTeam, venue, tournament, scheduledDate, notes, scheduledBy, referee } = req.body;
    if (!homeTeam || !awayTeam || !scheduledDate) {
      return res.status(400).json({ error: 'homeTeam, awayTeam and scheduledDate are required' });
    }
    if (homeTeam === awayTeam) {
      return res.status(400).json({ error: 'Home and away team cannot be the same' });
    }
    const { assistantReferee1, assistantReferee2, scout } = req.body;
    const match = await Match.create({ homeTeam, awayTeam, venue, tournament, scheduledDate, notes, scheduledBy, referee, assistantReferee1, assistantReferee2, scout });
    return res.status(201).json({ data: match });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/matches/:id/result — enter match result and player stats
router.post(`${BASE}/:id/result`, async (req, res) => {
  try {
    const { homeScore, awayScore, playerStats, confirmedBy, team } = req.body;
    const match = await Match.findById(req.params.id);
    if (!match) return res.status(404).json({ error: 'Match not found' });
    if (match.status === 'COMPLETED') return res.status(400).json({ error: 'Match already completed' });

    match.homeScore = homeScore;
    match.awayScore = awayScore;

    if (playerStats && playerStats.length > 0) {
      // For tournament matches, verify each player is approved before adding stats
      if (match.tournament) {
        const playerIds = playerStats.map(s => s.player);
        const approvedRegs = await TournamentRegistration.find({
          tournament: match.tournament,
          player: { $in: playerIds },
          status: 'APPROVED',
        }).select('player').lean();
        const approvedSet = new Set(approvedRegs.map(r => r.player.toString()));
        const blocked = playerStats.filter(s => !approvedSet.has(s.player));
        if (blocked.length > 0) {
          const ids = blocked.map(s => s.player).join(', ');
          return res.status(403).json({
            error: `Player(s) not approved for this tournament: ${ids}`,
            blockedPlayers: blocked.map(s => s.player),
          });
        }
      }
      // Merge player stats — avoid duplicates
      playerStats.forEach(stat => {
        const existing = match.playerStats.find(s => s.player.toString() === stat.player);
        if (existing) {
          Object.assign(existing, stat);
        } else {
          match.playerStats.push(stat);
        }
      });
    }

    // Mark confirmation for the submitting team
    if (team === match.homeTeam.toString()) {
      match.homeConfirmed = true;
      match.homeConfirmedBy = confirmedBy;
    } else if (team === match.awayTeam.toString()) {
      match.awayConfirmed = true;
      match.awayConfirmedBy = confirmedBy;
    }

    await match.save();
    return res.status(200).json({ data: match });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/matches/:id/confirm — confirm result
router.post(`${BASE}/:id/confirm`, async (req, res) => {
  try {
    const { confirmedBy, team } = req.body;
    const match = await Match.findById(req.params.id);
    if (!match) return res.status(404).json({ error: 'Match not found' });

    if (team === match.homeTeam.toString()) {
      match.homeConfirmed = true;
      match.homeConfirmedBy = confirmedBy;
    } else if (team === match.awayTeam.toString()) {
      match.awayConfirmed = true;
      match.awayConfirmedBy = confirmedBy;
    }

    await match.save();
    return res.status(200).json({ data: match });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/matches/:id/confirm-schedule — away team confirms the schedule
router.post(`${BASE}/:id/confirm-schedule`, async (req, res) => {
  try {
    const { confirmedBy } = req.body;
    const User = require('../User/user.model');
    const match = await Match.findById(req.params.id);
    if (!match) return res.status(404).json({ error: 'Match not found' });
    if (confirmedBy) {
      const confirmingUser = await User.findById(confirmedBy).select('type').lean();
      const isAwayTeam = match.awayTeam && match.awayTeam.toString() === confirmedBy;
      const isCoach = confirmingUser && confirmingUser.type === 'COACH';
      if (!isAwayTeam && !isCoach) {
        return res.status(403).json({ error: 'Only the away team or their coach can confirm the schedule' });
      }
      if (isCoach) match.awayCoach = confirmedBy;
    }
    match.scheduleConfirmed = true;
    match.scheduleConfirmedBy = confirmedBy;
    await match.save();
    return res.status(200).json({ data: match });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/matches/:id/decline-schedule — away team declines the schedule
router.post(`${BASE}/:id/decline-schedule`, async (req, res) => {
  try {
    const { declinedBy, reason } = req.body;
    const match = await Match.findById(req.params.id);
    if (!match) return res.status(404).json({ error: 'Match not found' });
    if (match.scheduleConfirmed) return res.status(400).json({ error: 'Cannot decline already confirmed schedule' });
    if (declinedBy) {
      const User = require('../User/user.model');
      const decliningUser = await User.findById(declinedBy).select('type').lean();
      const isAwayTeam = match.awayTeam && match.awayTeam.toString() === declinedBy;
      const isCoach = decliningUser && decliningUser.type === 'COACH';
      if (!isAwayTeam && !isCoach) {
        return res.status(403).json({ error: 'Only the away team or their coach can decline the schedule' });
      }
    }
    match.scheduleDeclined = true;
    match.scheduleDeclinedBy = declinedBy;
    match.scheduleDeclineReason = reason;
    match.status = 'DECLINED';
    await match.save();
    return res.status(200).json({ data: match });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/matches/:id/cancel — cancel a match (only the match creator can cancel)
router.post(`${BASE}/:id/cancel`, async (req, res) => {
  try {
    const { cancelledBy } = req.body;
    if (!cancelledBy) return res.status(400).json({ error: 'cancelledBy is required' });
    const match = await Match.findById(req.params.id);
    if (!match) return res.status(404).json({ error: 'Match not found' });
    if (match.status === 'COMPLETED') return res.status(400).json({ error: 'Cannot cancel a completed match' });
    if (match.scheduledBy && match.scheduledBy.toString() !== cancelledBy) {
      return res.status(403).json({ error: 'Only the match creator can cancel this match' });
    }
    match.status = 'CANCELLED';
    await match.save();
    return res.status(200).json({ data: match });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/matches/:id/reschedule — home team reschedules the match
router.post(`${BASE}/:id/reschedule`, async (req, res) => {
  try {
    const { scheduledDate, rescheduledBy } = req.body;
    if (!scheduledDate) return res.status(400).json({ error: 'scheduledDate is required' });
    const match = await Match.findById(req.params.id);
    if (!match) return res.status(404).json({ error: 'Match not found' });
    if (match.status === 'COMPLETED') return res.status(400).json({ error: 'Cannot reschedule a completed match' });
    if (match.status === 'CANCELLED') return res.status(400).json({ error: 'Cannot reschedule a cancelled match' });
    if (rescheduledBy && match.scheduledBy && match.scheduledBy.toString() !== rescheduledBy) {
      return res.status(403).json({ error: 'Only the match creator can reschedule this match' });
    }
    match.scheduledDate = new Date(scheduledDate);
    match.scheduleConfirmed = false;
    match.scheduleDeclined = false;
    match.scheduleDeclinedBy = null;
    match.scheduleDeclineReason = null;
    match.status = 'SCHEDULED';
    if (rescheduledBy) match.scheduledBy = rescheduledBy;
    await match.save();
    return res.status(200).json({ data: match });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/matches/:id/temp-scout — any user can flag themselves as an unofficial scout for this match
router.post(`${BASE}/:id/temp-scout`, async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    const match = await Match.findByIdAndUpdate(
      req.params.id,
      { $addToSet: { tempScouts: userId } },
      { new: true }
    );
    if (!match) return res.status(404).json({ error: 'Match not found' });
    return res.status(200).json({ data: match });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /v1/matches/:id — update match details
router.patch(`${BASE}/:id`, async (req, res) => {
  try {
    const match = await Match.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!match) return res.status(404).json({ error: 'Match not found' });
    return res.status(200).json({ data: match });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /v1/matches/:id — cancel match
router.delete(`${BASE}/:id`, async (req, res) => {
  try {
    const match = await Match.findByIdAndUpdate(req.params.id, { status: 'CANCELLED' }, { new: true });
    if (!match) return res.status(404).json({ error: 'Match not found' });
    return res.status(200).json({ data: match });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/matches/:id/organizer-result
// Tournament organizer enters the result directly — bypasses team confirmation flow.
// organizerId must match the linked tournament's organizer field.
router.post(`${BASE}/:id/organizer-result`, async (req, res) => {
  const { organizerId, homeScore, awayScore, playerStats } = req.body;
  if (!organizerId) return res.status(400).json({ error: 'organizerId required' });
  try {
    const match = await Match.findById(req.params.id).populate('tournament', 'organizer');
    if (!match) return res.status(404).json({ error: 'Match not found' });
    if (match.status === 'COMPLETED') return res.status(400).json({ error: 'Match already completed' });

    // Verify caller is the tournament organizer
    if (match.tournament) {
      const orgId = match.tournament.organizer?.toString() ?? match.tournament.toString();
      if (orgId !== organizerId) {
        return res.status(403).json({ error: 'Only the tournament organizer can set this result' });
      }
    }

    match.homeScore = homeScore ?? match.homeScore;
    match.awayScore = awayScore ?? match.awayScore;

    if (playerStats && playerStats.length > 0) {
      // For tournament matches check registration approval
      if (match.tournament) {
        const TournamentRegistration = require('../TournamentRegistration/tournament_registration.model');
        const playerIds = playerStats.map(s => s.player);
        const approvedRegs = await TournamentRegistration.find({
          tournament: match.tournament._id ?? match.tournament,
          player: { $in: playerIds },
          status: 'APPROVED',
        }).select('player').lean();
        const approvedSet = new Set(approvedRegs.map(r => r.player.toString()));
        const blocked = playerStats.filter(s => !approvedSet.has(s.player));
        if (blocked.length > 0) {
          return res.status(403).json({
            error: `Player(s) not approved for this tournament`,
            blockedPlayers: blocked.map(s => s.player),
          });
        }
      }
      playerStats.forEach(stat => {
        const existing = match.playerStats.find(s => s.player.toString() === stat.player);
        if (existing) Object.assign(existing, stat);
        else match.playerStats.push(stat);
      });
    }

    // Organizer authority — both sides confirmed, mark completed
    match.homeConfirmed = true;
    match.awayConfirmed = true;
    match.status = 'COMPLETED';
    await match.save();
    return res.status(200).json({ data: match });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
