const express = require('express');
const { getString } = require('@lykmapipo/env');
const _ = require('lodash');
const Match = require('./match.model');
const TournamentRegistration = require('../TournamentRegistration/tournament_registration.model');
const User = require('../User/user.model');
const ChatMessage = require('../Chat/chat.model');
const Notification = require('../Notification/notification.model');
const { SubscriptionUsage } = require('../Subscription/subscription_usage.model');
const { Subscription } = require('../Subscription/subscription.model');
const { busyUserIds, venueBusy, busyTeamIds } = require('./conflict.helper');

const API_VERSION = getString('API_VERSION', '1.0.0');
const router = express.Router();
const BASE = `/v${API_VERSION.split('.')[0]}/matches`;

// Returns a 403-shaped error object if the given userId is a PLAYER with
// guardianOrphaned=true, otherwise null. Used to gate player-initiated
// match actions (schedule, request-scout) — third parties can still
// interact with the orphaned player.
async function orphanedPlayerBlock(userId) {
  if (!userId) return null;
  try {
    const u = await User.findById(userId)
      .select('type guardianOrphaned')
      .lean();
    if (u && ['PLAYER', 'REFEREE'].includes(u.type) && u.guardianOrphaned) {
      return {
        error: 'Huwezi kutuma ombi bila mlezi. Nenda "Mlezi Wangu" upate mlezi mpya.',
        errorKey: 'gate.err.no_guardian_match_request',
      };
    }
  } catch (_) {}
  return null;
}

// GET /v1/matches/scouting/:userId — matches where user is official or temp scout (NOTE: before /:id)
// GET /v1/matches/refereeing/:userId — every COMPLETED match this user has
// officiated as head referee OR either assistant. Powers the referee's My
// CV screen. Ordered newest first.
router.get(`${BASE}/refereeing/:userId`, async (req, res) => {
  try {
    const uid = req.params.userId;
    const matches = await Match.find({
      status: 'COMPLETED',
      $or: [
        { referee: uid },
        { assistantReferee1: uid },
        { assistantReferee2: uid },
      ],
    })
      .populate('homeTeam', 'firstName lastName academy_name type accountNumber profileImage')
      .populate('awayTeam', 'firstName lastName academy_name type accountNumber profileImage')
      .populate('venue', 'name region district ward')
      .populate('tournament', 'name type')
      .select('homeTeam awayTeam venue tournament scheduledDate homeScore awayScore matchId referee assistantReferee1 assistantReferee2 status')
      .sort({ scheduledDate: -1 })
      .lean();
    // Tag the caller's role on each row so the UI can distinguish
    // 'Referee' vs 'Assistant Referee' without extra joins client-side.
    matches.forEach((m) => {
      if (String(m.referee) === uid) m.myRole = 'REFEREE';
      else if (String(m.assistantReferee1) === uid) m.myRole = 'ASSISTANT_1';
      else if (String(m.assistantReferee2) === uid) m.myRole = 'ASSISTANT_2';
    });

    // Attach per-match rating aggregate (avg stars + count) in one round-trip.
    if (matches.length) {
      try {
        const RefereeRating = require('../RefereeRating/referee_rating.model');
        const matchIds = matches.map(m => m._id);
        const agg = await RefereeRating.aggregate([
          { $match: { referee: new (require('mongoose')).Types.ObjectId(uid),
                      match: { $in: matchIds } } },
          { $group: { _id: '$match',
                      avgStars: { $avg: '$stars' },
                      count: { $sum: 1 } } },
        ]);
        const byMatch = {};
        for (const r of agg) {
          byMatch[String(r._id)] = {
            averageRating: Math.round(r.avgStars * 10) / 10,
            gamesRated: r.count,
          };
        }
        matches.forEach((m) => {
          m.rating = byMatch[String(m._id)] || null;
        });
      } catch (e) { /* enrichment best-effort */ }
    }

    return res.status(200).json({ data: matches });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/matches/for-player/:playerId — every match this player has
// appeared in (playerStats sub-doc present with player=playerId).
// Returns a flat list ready to render, with the caller's per-match
// stats extracted so the client doesn't have to walk the sub-array.
// Sorted newest first. Public — no tier gate for beta.
router.get(`${BASE}/for-player/:playerId`, async (req, res) => {
  try {
    const pid = req.params.playerId;
    const rows = await Match.find({
      'playerStats.player': pid,
      status: 'COMPLETED',
    })
      .populate('homeTeam', 'firstName lastName academy_name type accountNumber profileImage')
      .populate('awayTeam', 'firstName lastName academy_name type accountNumber profileImage')
      .populate('venue', 'name region district ward')
      .populate('tournament', 'name type')
      .select('homeTeam awayTeam venue tournament scheduledDate homeScore awayScore matchId status playerStats')
      .sort({ scheduledDate: -1 })
      .lean();

    // Extract the caller's own playerStats sub-doc into a flat
    // `myStats` field so the client just reads m.myStats.goals
    // instead of scanning m.playerStats for their entry. Drop the
    // full array from the payload — it can contain data on every
    // other player and blows up the response size.
    const trimmed = rows.map((m) => {
      const my = (m.playerStats || [])
        .find((p) => p && String(p.player) === String(pid));
      const { playerStats, ...rest } = m;
      return {
        ...rest,
        myStats: my
          ? {
              appearances: 1,
              goals: my.goals || 0,
              assists: my.assists || 0,
              yellowCards: my.yellowCards || 0,
              redCards: my.redCards || 0,
              minutesPlayed: my.minutesPlayed || 0,
              position: my.position || null,
            }
          : null,
      };
    });

    return res.status(200).json({ data: trimmed });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get(`${BASE}/scouting/:userId`, async (req, res) => {
  try {
    const matches = await Match.find({
      $or: [
        { scout: req.params.userId },
        { tempScouts: req.params.userId },
        { 'scouts.scout': req.params.userId },
      ],
    })
      .populate('homeTeam', 'firstName lastName academy_name type accountNumber profileImage')
      .populate('awayTeam', 'firstName lastName academy_name type accountNumber profileImage')
      .populate('venue', 'name region district ward')
      .populate('tournament', 'name type')
      .populate('referee', 'firstName lastName accountNumber type')
      .populate('scout', 'firstName lastName accountNumber type profileImage')
      .populate('scouts.scout', 'firstName lastName accountNumber type profileImage')
      .select('-playerStats -notes -scheduleDeclinedBy -scheduleConfirmedBy -homeConfirmedBy -awayConfirmedBy -scheduledBy -homeCoach -awayCoach')
      .sort({ scheduledDate: -1 })
      .lean();
    return res.status(200).json({ data: matches });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

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
        .populate('venue', 'name region district ward')
        .populate('tournament', 'name type')
        .populate('referee', 'firstName lastName accountNumber type')
        .populate('assistantReferee1', 'firstName lastName accountNumber type')
        .populate('assistantReferee2', 'firstName lastName accountNumber type')
        .populate('scout', 'firstName lastName accountNumber type profileImage')
        .populate('scouts.scout', 'firstName lastName accountNumber type profileImage')
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
      .populate('venue', 'name region district ward')
      .populate('tournament', 'name type')
      .populate('playerStats.player', 'firstName lastName profileImage accountNumber position type')
      .populate('referee', 'firstName lastName accountNumber type profileImage')
      .populate('assistantReferee1', 'firstName lastName accountNumber type profileImage')
      .populate('assistantReferee2', 'firstName lastName accountNumber type profileImage')
      .populate('homeCoach', 'firstName lastName accountNumber type profileImage')
      .populate('awayCoach', 'firstName lastName accountNumber type profileImage')
      .populate('scout', 'firstName lastName accountNumber type profileImage')
      .populate('scouts.scout', 'firstName lastName accountNumber type profileImage')
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
      return res.status(400).json({
        error: 'Tafadhali chagua timu mbili na tarehe ya mechi.',
        errorKey: 'matches.error.missing_fields',
      });
    }
    if (homeTeam === awayTeam) {
      return res.status(400).json({
        error: 'Timu ya nyumbani na ya ugenini haiwezi kuwa moja.',
        errorKey: 'matches.error.same_team',
      });
    }
    const blocked = await orphanedPlayerBlock(scheduledBy);
    if (blocked) return res.status(403).json(blocked);

    // GUARDIAN cap — bare guardians cannot schedule matches. Delegated
    // staff (Academy/Club COACH role, or School SPORTS_TEACHER) can via
    // getEffectiveContext.
    if (scheduledBy) {
      const schedUser = await User.findById(scheduledBy).select('type').lean();
      if (schedUser?.type === 'GUARDIAN') {
        const ctx = await Subscription.getEffectiveContext(scheduledBy);
        if (!ctx?.delegated) {
          return res.status(403).json({
            error: 'Walezi hawaruhusiwi kupanga mechi. Coach or org staff pekee.',
            reason: 'GUARDIAN_MATCH_SCHEDULE_BLOCKED',
          });
        }
      }
    }

    const { assistantReferee1, assistantReferee2, scout, scouts: scoutIds } = req.body;

    // Referees who are orphaned minors cannot be selected. Check the
    // three referee slots and reject the whole match if any is orphaned.
    const refCandidates = [referee, assistantReferee1, assistantReferee2].filter(Boolean);
    if (refCandidates.length) {
      const orphanedRefs = await User.find({
        _id: { $in: refCandidates },
        type: 'REFEREE',
        guardianOrphaned: true,
      }).select('firstName lastName').lean();
      if (orphanedRefs.length) {
        const names = orphanedRefs.map(r => `${r.firstName || ''} ${r.lastName || ''}`.trim()).filter(Boolean).join(', ');
        return res.status(403).json({
          error: `Mwamuzi ${names} hana mlezi. Hawezi kuchaguliwa kwa mchezo. · Referee ${names} has no active guardian and cannot be selected.`,
        });
      }

      // Subscription/free-trial eligibility for each referee. A ref who
      // has officiated >= threshold games without subscribing (and past
      // any grandfather window) is blocked from new assignments.
      const ineligible = [];
      for (const refId of refCandidates) {
        const status = await Subscription.getRefereeEligibility(refId);
        if (!status.eligible) {
          const u = await User.findById(refId).select('firstName lastName').lean();
          const name = `${u?.firstName || ''} ${u?.lastName || ''}`.trim() || refId;
          ineligible.push({ name, gamesOfficiated: status.gamesOfficiated });
        }
      }
      if (ineligible.length) {
        const names = ineligible.map(i => `${i.name} (mechi ${i.gamesOfficiated})`).join(', ');
        return res.status(403).json({
          error: `Mwamuzi ${names} hana uandikishaji hai. Hawezi kuchaguliwa kwa mchezo.`,
          reason: 'REFEREE_SUBSCRIPTION_REQUIRED',
        });
      }
    }

    const normalizedScouts = Array.isArray(scoutIds)
      ? scoutIds.map(id => ({ scout: id, status: 'PENDING' }))
      : scout ? [{ scout, status: 'PENDING' }] : [];

    // COACH / ACADEMY gate on adding scouts to own matches — Standard blocked.
    if (normalizedScouts.length && scheduledBy) {
      try {
        const scheduler = await User.findById(scheduledBy).select('type').lean();
        const schedType = scheduler?.type;
        if (['COACH', 'ACADEMY', 'CLUB'].includes(schedType)) {
          const { FEATURE_CAPS } = require('../Subscription/subscription.model');
          const tier = await Subscription.getEffectiveTier(scheduledBy, schedType);
          const caps = FEATURE_CAPS[schedType]?.[tier] || {};
          if (caps.canAddScoutsToOwnMatches !== true) {
            return res.status(403).json({
              error: `Kifurushi cha ${tier} hakiruhusu kuongeza scout kwenye mechi yako. Boresha hadi Gold.`,
              reason: `${schedType}_ADD_SCOUT_BLOCKED`,
              tier,
            });
          }
        }
      } catch (_) { /* fall through */ }
    }

    // Every scout on the match must be eligible for official work: either
    // an active PRO SCOUT subscription, OR a Gold/Platinum COACH (coaches
    // double as scouts once they pay).
    const scoutCandidates = normalizedScouts.map(s => s.scout).filter(Boolean);
    if (scoutCandidates.length) {
      const ineligible = [];
      for (const scoutId of scoutCandidates) {
        const canScout = await Subscription.canPerformOfficialScouting(scoutId);
        if (!canScout) {
          const u = await User.findById(scoutId).select('firstName lastName').lean();
          const name = `${u?.firstName || ''} ${u?.lastName || ''}`.trim() || scoutId;
          ineligible.push(name);
        }
      }
      if (ineligible.length) {
        return res.status(403).json({
          error: `Scout ${ineligible.join(', ')} hana uandikishaji hai. Hawezi kuchaguliwa kwa kazi rasmi ya scouting.`,
          reason: 'SCOUT_SUBSCRIPTION_REQUIRED',
        });
      }
    }

    // Time-conflict guardrails. Refs/scouts/venues use a symmetric ±2h
    // window; teams use -2h/+3h (a team that just finished a match needs
    // more recovery time before the next kickoff).
    {
      const refIds = refCandidates.filter(Boolean);
      if (refIds.length) {
        const busy = await busyUserIds(refIds, scheduledDate);
        if (busy.size) {
          const users = await User.find({ _id: { $in: [...busy] } })
            .select('firstName lastName').lean();
          const names = users
            .map((u) => `${u.firstName || ''} ${u.lastName || ''}`.trim())
            .filter(Boolean)
            .join(', ');
          return res.status(409).json({
            error: `Mwamuzi ${names} tayari ana mechi nyingine muda huo huo. Chagua muda mwingine au mwamuzi mwingine.`,
            errorKey: 'matches.error.referee_busy',
            reason: 'REFEREE_TIME_CONFLICT',
          });
        }
      }
      const scoutIdsAll = scoutCandidates.filter(Boolean);
      if (scoutIdsAll.length) {
        const busy = await busyUserIds(scoutIdsAll, scheduledDate);
        if (busy.size) {
          const users = await User.find({ _id: { $in: [...busy] } })
            .select('firstName lastName').lean();
          const names = users
            .map((u) => `${u.firstName || ''} ${u.lastName || ''}`.trim())
            .filter(Boolean)
            .join(', ');
          return res.status(409).json({
            error: `Scout ${names} tayari ana mechi nyingine muda huo huo. Chagua muda mwingine au scout mwingine.`,
            errorKey: 'matches.error.scout_busy',
            reason: 'SCOUT_TIME_CONFLICT',
          });
        }
      }
      if (venue) {
        const busy = await venueBusy(venue, scheduledDate);
        if (busy) {
          return res.status(409).json({
            error: 'Uwanja tayari umepangwa kwa mechi nyingine muda huo huo. Chagua uwanja mwingine au muda mwingine.',
            errorKey: 'matches.error.venue_busy',
            reason: 'VENUE_TIME_CONFLICT',
          });
        }
      }
      const teamIds = [homeTeam, awayTeam].filter(Boolean);
      if (teamIds.length) {
        const busy = await busyTeamIds(teamIds, scheduledDate);
        if (busy.size) {
          const users = await User.find({ _id: { $in: [...busy] } })
            .select('firstName lastName academy_name').lean();
          const names = users
            .map((u) => (u.academy_name && u.academy_name.trim())
              || `${u.firstName || ''} ${u.lastName || ''}`.trim())
            .filter(Boolean)
            .join(', ');
          return res.status(409).json({
            error: `Timu ${names} tayari ina mechi nyingine ndani ya masaa 2 kabla au 3 baada ya muda huo. Chagua muda mwingine.`,
            errorKey: 'matches.error.team_busy',
            reason: 'TEAM_TIME_CONFLICT',
          });
        }
      }
    }

    const match = await Match.create({
      homeTeam, awayTeam, venue, tournament, scheduledDate, notes, scheduledBy, referee,
      assistantReferee1, assistantReferee2,
      // Every assigned ref slot starts PENDING — the ref must accept
      // or decline from the Verifications screen.
      refereeStatus: referee ? 'PENDING' : null,
      assistantReferee1Status: assistantReferee1 ? 'PENDING' : null,
      assistantReferee2Status: assistantReferee2 ? 'PENDING' : null,
      scout: normalizedScouts.length ? normalizedScouts[0].scout : null,
      scouts: normalizedScouts,
    });

    // Notify each assigned referee. Guardian fan-out picks up minors.
    const refSlots = [
      { id: referee, role: 'Main Referee', slot: 'main' },
      { id: assistantReferee1, role: 'Assistant Referee 1', slot: 'ar1' },
      { id: assistantReferee2, role: 'Assistant Referee 2', slot: 'ar2' },
    ].filter(s => s.id);
    if (refSlots.length) {
      try {
        const [home, away] = await Promise.all([
          User.findById(homeTeam).select('academy_name firstName lastName').lean(),
          User.findById(awayTeam).select('academy_name firstName lastName').lean(),
        ]);
        const teamLabel = (u) => (u?.academy_name || `${u?.firstName || ''} ${u?.lastName || ''}`.trim()) || 'a team';
        const matchLabel = `${teamLabel(home)} vs ${teamLabel(away)}`;
        for (const s of refSlots) {
          await Notification.create({
            userId: s.id,
            type: 'SYSTEM',
            title: 'Umeombwa Kuwaamua Mechi',
            body:
              `Umeombwa kama ${s.role} kwa mechi: ${matchLabel}. ` +
              `Fungua Uhakiki kukubali au kukataa.`,
            titleKey: 'notif.match.referee_request.title',
            bodyKey: 'notif.match.referee_request.body',
            params: { role: s.role, match: matchLabel },
            metadata: {
              kind: 'REFEREE_ASSIGNMENT',
              matchId: match._id,
              slot: s.slot,
              role: s.role,
              // scheduledDate lets the client sort upcoming referee
              // assignments chronologically in the inbox (so "next
              // Saturday" appears at the top) and show the match date
              // as a subtitle without a separate lookup.
              scheduledDate: match.scheduledDate,
              teamsLabel: matchLabel,
            },
          });
        }
      } catch (nErr) {
        console.log('[MATCH POST] referee notification failed:', nErr.message);
      }
    }

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

    // Only overwrite scores when the caller explicitly sends them —
    // stats-only saves from the away team shouldn't blank out the score.
    if (homeScore !== undefined && homeScore !== null) match.homeScore = homeScore;
    if (awayScore !== undefined && awayScore !== null) match.awayScore = awayScore;

    if (playerStats && playerStats.length > 0) {
      // For tournament matches, verify each REGISTERED player is approved
      // before adding stats. Guest players (no player id) skip this check.
      if (match.tournament) {
        const registered = playerStats.filter(s => s.player && !s.isGuest);
        const playerIds = registered.map(s => s.player);
        const approvedRegs = await TournamentRegistration.find({
          tournament: match.tournament,
          player: { $in: playerIds },
          status: 'APPROVED',
        }).select('player').lean();
        const approvedSet = new Set(approvedRegs.map(r => r.player.toString()));
        const blocked = registered.filter(s => !approvedSet.has(s.player));
        if (blocked.length > 0) {
          const ids = blocked.map(s => s.player).join(', ');
          return res.status(403).json({
            error: `Player(s) not approved for this tournament: ${ids}`,
            blockedPlayers: blocked.map(s => s.player),
          });
        }
      }
      // Merge player stats — dedupe by player id whenever we have one.
      // Guests are now real platform users so they always carry an id; only
      // stat rows with no id at all fall back to append.
      playerStats.forEach(stat => {
        if (!stat.player) {
          match.playerStats.push(stat);
          return;
        }
        const existing = match.playerStats.find(s => s.player && s.player.toString() === String(stat.player));
        if (existing) {
          Object.assign(existing, stat);
        } else {
          match.playerStats.push(stat);
        }
      });
    }

    // Result entry is now a "save draft" op — it never auto-confirms. The
    // team explicitly locks their side by hitting POST /confirm, so coaches
    // can save partial stats over several sittings.
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

// POST /v1/matches/:id/scout/respond — scout accepts or declines assignment
router.post(`${BASE}/:id/scout/respond`, async (req, res) => {
  try {
    const { status, scoutId } = req.body;
    if (!['ACCEPTED', 'DECLINED'].includes(status)) {
      return res.status(400).json({ error: 'status must be ACCEPTED or DECLINED' });
    }
    // Update status in scouts array if scoutId provided, else fall back to scoutStatus
    const update = scoutId
      ? { $set: { 'scouts.$[el].status': status, scoutStatus: status } }
      : { scoutStatus: status };
    const options = scoutId
      ? { new: true, arrayFilters: [{ 'el.scout': scoutId }] }
      : { new: true };
    const match = await Match.findByIdAndUpdate(req.params.id, update, options)
      .populate('scout', 'firstName lastName accountNumber type profileImage')
      .populate('scouts.scout', 'firstName lastName accountNumber type profileImage');
    if (!match) return res.status(404).json({ error: 'Match not found' });
    return res.status(200).json({ data: match });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/matches/pending-referee/:refereeId — matches where the user
// occupies one of the 3 ref slots and status is PENDING. Populates
// teams so the client can render "You've been requested for TeamA vs
// TeamB on DATE".
router.get(`${BASE}/pending-referee/:refereeId`, async (req, res) => {
  try {
    const rid = req.params.refereeId;
    const rows = await Match.find({
      $or: [
        { referee: rid, refereeStatus: 'PENDING' },
        { assistantReferee1: rid, assistantReferee1Status: 'PENDING' },
        { assistantReferee2: rid, assistantReferee2Status: 'PENDING' },
      ],
    })
      .populate('homeTeam', 'firstName lastName academy_name type accountNumber profileImage')
      .populate('awayTeam', 'firstName lastName academy_name type accountNumber profileImage')
      .sort({ scheduledDate: 1 })
      .lean();
    // Attach a slot label so client knows which of the 3 seats the
    // caller occupies without having to re-derive.
    const shaped = rows.map(m => {
      let slot = null;
      let role = null;
      if (String(m.referee) === String(rid)) { slot = 'main'; role = 'Main Referee'; }
      else if (String(m.assistantReferee1) === String(rid)) { slot = 'ar1'; role = 'Assistant Referee 1'; }
      else if (String(m.assistantReferee2) === String(rid)) { slot = 'ar2'; role = 'Assistant Referee 2'; }
      return { ...m, slot, role };
    });
    return res.status(200).json({ data: shaped });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/matches/:id/referee-response — referee accepts or declines
// Body: { slot: 'main'|'ar1'|'ar2', action: 'accept'|'decline' }
router.post(`${BASE}/:id/referee-response`, async (req, res) => {
  try {
    const { slot, action } = req.body || {};
    if (!['main', 'ar1', 'ar2'].includes(slot)) {
      return res.status(400).json({ error: 'slot must be main | ar1 | ar2' });
    }
    if (!['accept', 'decline'].includes(action)) {
      return res.status(400).json({ error: 'action must be accept or decline' });
    }
    const match = await Match.findById(req.params.id);
    if (!match) return res.status(404).json({ error: 'Match not found' });

    const slotField = slot === 'main'
      ? 'referee'
      : slot === 'ar1' ? 'assistantReferee1' : 'assistantReferee2';
    const statusField = `${slotField}Status`;
    const respondedAtField = `${slotField}ResponseAt`;

    const currentRef = match[slotField];
    const currentStatus = match[statusField];
    if (!currentRef) {
      return res.status(400).json({ error: `${slot} slot is empty` });
    }
    if (currentStatus === 'ACCEPTED' || currentStatus === 'DECLINED') {
      return res.status(400).json({ error: `${slot} slot already ${currentStatus.toLowerCase()}` });
    }

    if (action === 'accept') {
      match[statusField] = 'ACCEPTED';
    } else {
      match[statusField] = 'DECLINED';
      match[slotField] = null; // free the slot so scheduler can reassign
    }
    match[respondedAtField] = new Date();
    await match.save();

    // Stamp responseStatus onto the original REFEREE_ASSIGNMENT
    // notification so the inbox tile can render an "✓ Umekubali" /
    // "✗ Umekataa" badge and route the tap to a read-only detail sheet
    // instead of back to Verifications (where the pending row is now
    // gone). Best-effort — never fail the response if this update misses.
    try {
      await Notification.updateOne(
        {
          userId: currentRef,
          'metadata.kind': 'REFEREE_ASSIGNMENT',
          'metadata.matchId': match._id,
          'metadata.slot': slot,
        },
        {
          $set: {
            'metadata.responseStatus':
              action === 'accept' ? 'ACCEPTED' : 'DECLINED',
            'metadata.respondedAt': new Date(),
          },
        },
      );
    } catch (nErr) {
      console.log('[REFEREE RESPONSE] notification stamp failed:', nErr.message);
    }

    // Notify the scheduler so they don't have to poll.
    try {
      const [home, away, ref] = await Promise.all([
        User.findById(match.homeTeam).select('academy_name firstName lastName').lean(),
        User.findById(match.awayTeam).select('academy_name firstName lastName').lean(),
        User.findById(currentRef).select('firstName lastName').lean(),
      ]);
      const teamLabel = (u) => (u?.academy_name || `${u?.firstName || ''} ${u?.lastName || ''}`.trim()) || 'a team';
      const matchLabel = `${teamLabel(home)} vs ${teamLabel(away)}`;
      const refName = ref ? `${ref.firstName || ''} ${ref.lastName || ''}`.trim() : 'A referee';
      const roleLabel = slot === 'main' ? 'Mwamuzi Mkuu' : slot === 'ar1' ? 'Msaidizi 1' : 'Msaidizi 2';
      const accepted = action === 'accept';
      if (match.scheduledBy) {
        await Notification.create({
          userId: match.scheduledBy,
          type: 'SYSTEM',
          title: accepted
            ? 'Mwamuzi Amekubali'
            : 'Mwamuzi Amekataa',
          body:
            `${refName} ${accepted ? 'amekubali' : 'amekataa'} ombi la kuwa ${roleLabel} kwa mechi ${matchLabel}.`,
          titleKey: accepted
            ? 'notif.match.referee_accepted.title'
            : 'notif.match.referee_declined.title',
          bodyKey: accepted
            ? 'notif.match.referee_accepted.body'
            : 'notif.match.referee_declined.body',
          params: { name: refName, role: roleLabel, match: matchLabel },
          metadata: {
            kind: accepted ? 'REFEREE_ACCEPTED' : 'REFEREE_DECLINED',
            matchId: match._id,
            slot,
            refereeId: currentRef,
          },
        });
      }
    } catch (nErr) {
      console.log('[REFEREE RESPONSE] notification failed:', nErr.message);
    }

    return res.status(200).json({ data: match });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/matches/:id/request-scout — a player (or academy) asks a registered
// scout to scout an already-scheduled match. Duplicates are ignored via the
// existing scouts array — same scout on same match yields a single entry.
router.post(`${BASE}/:id/request-scout`, async (req, res) => {
  try {
    const { scoutId, requestedBy } = req.body;
    if (!scoutId || !requestedBy) {
      return res.status(400).json({ error: 'scoutId and requestedBy are required' });
    }
    const blocked = await orphanedPlayerBlock(requestedBy);
    if (blocked) return res.status(403).json(blocked);
    const [match, scout, requester] = await Promise.all([
      Match.findById(req.params.id),
      User.findById(scoutId).select('type firstName lastName costPerGame costPerPlayer'),
      User.findById(requestedBy).select('type firstName lastName school academy'),
    ]);
    if (!match) return res.status(404).json({ error: 'Match not found' });
    if (!scout || (scout.type !== 'SCOUT' && scout.type !== 'COACH')) {
      return res.status(400).json({ error: 'scoutId must reference a SCOUT or COACH' });
    }
    const canScout = await Subscription.canPerformOfficialScouting(scoutId);
    if (!canScout) {
      return res.status(403).json({
        error: 'Scout hana uandikishaji hai — hawezi kupokea maombi ya kazi rasmi.',
        reason: 'SCOUT_SUBSCRIPTION_REQUIRED',
      });
    }
    if (!requester) return res.status(400).json({ error: 'requester not found' });

    // ACADEMY / CLUB / AGENT tier gate — Standard cannot request scouts.
    // (PLAYER caller is metered by evaluationRequests below.)
    if (['ACADEMY', 'CLUB', 'AGENT'].includes(requester.type)) {
      const { FEATURE_CAPS } = require('../Subscription/subscription.model');
      const orgType = requester.type;
      const rTier = await Subscription.getEffectiveTier(requestedBy, orgType);
      const rCaps = FEATURE_CAPS[orgType]?.[rTier] || {};
      if (rCaps.canRequestScouting !== true) {
        return res.status(403).json({
          error: `Kifurushi cha ${rTier} hakiruhusu kuomba scout. Boresha hadi Gold.`,
          reason: `${orgType}_SCOUT_REQUEST_BLOCKED`,
          tier: rTier,
        });
      }
    }
    if (['COMPLETED', 'CANCELLED'].includes(match.status)) {
      return res.status(400).json({ error: 'Match is not scheduled' });
    }

    // Eligibility: the requester must be tied to homeTeam or awayTeam.
    // Academies (or team owners) show up as homeTeam/awayTeam themselves —
    // players link to a team via User.school.
    const teamIds = [match.homeTeam?.toString(), match.awayTeam?.toString()].filter(Boolean);
    const requesterId = requester._id.toString();
    const requesterSchool = requester.school ? requester.school.toString() : null;
    const isTeamOwner = teamIds.includes(requesterId);
    const isPlayerOnTeam = requester.type === 'PLAYER' && requesterSchool && teamIds.includes(requesterSchool);
    if (!isTeamOwner && !isPlayerOnTeam) {
      return res.status(403).json({ error: 'requester is not part of a team in this match' });
    }

    // Dedupe: if the scout is already attached (via any path), don't add again.
    const alreadyAttached = (match.scouts || []).some(s => s.scout && s.scout.toString() === scoutId)
      || (match.scout && match.scout.toString() === scoutId);
    if (!alreadyAttached) {
      // Tier gate — only for PLAYER-initiated requests. Team-owner (ACADEMY,
      // CLUB, etc.) requests bypass this cap for now.
      if (isPlayerOnTeam) {
        const check = await SubscriptionUsage.consume({
          user: requester._id,
          userType: 'PLAYER',
          feature: 'evaluationRequests',
        });
        if (!check.allowed) {
          const msg = check.reason === 'TIER_DISALLOWED'
            ? 'Standard players cannot request scout evaluations. Upgrade to Gold or Platinum.'
            : `You have reached this month's cap of ${check.cap} scout requests. Upgrade to Platinum for unlimited.`;
          return res.status(429).json({ error: msg, reason: check.reason, cap: check.cap, tier: check.tier });
        }
      }
      match.scouts.push({
        scout: scoutId,
        status: 'PENDING',
        requestedBy: requester._id,
        requestType: isPlayerOnTeam ? 'PLAYER' : 'ACADEMY',
      });
      if (!match.scout) match.scout = scoutId;
      await match.save();
    }

    // Chat notification from requester → scout so it shows up in the scout's
    // Messages inbox alongside the standard match-scout heads-up.
    const requesterName = `${requester.firstName || ''} ${requester.lastName || ''}`.trim() || 'A user';
    const roleLabel = isPlayerOnTeam ? 'player' : 'team';
    try {
      await ChatMessage.create({
        sender: requester._id,
        receiver: scout._id,
        content: `${requesterName} (${roleLabel}) has requested you as scout for their upcoming match. Open Scout Hub to accept or decline.`,
        read: false,
      });
    } catch (chatErr) {
      console.log('request-scout chat notify error:', chatErr.message);
    }

    // In-app notifications on both sides (guardian fan-out picks these up
    // automatically when the target is a minor).
    try {
      await Notification.create({
        userId: scout._id,
        type: 'SYSTEM',
        title: 'Ombi la Scout',
        body:
          `${requesterName} amekuomba u-scout mechi yao. ` +
          `Fungua Scout Hub kukubali au kukataa.`,
        titleKey: 'notif.match.scout_request.title',
        bodyKey: 'notif.match.scout_request.body',
        params: { requester: requesterName },
        metadata: {
          kind: 'SCOUT_REQUEST',
          matchId: match._id,
          requesterId: requester._id,
        },
      });
      await Notification.create({
        userId: requester._id,
        type: 'SYSTEM',
        title: 'Ombi la Scout Limetumwa',
        body:
          `Umemuomba ${scout.firstName || 'skauti'} kuja kufanya scout mechi yako.`,
        titleKey: 'notif.match.scout_request_sent.title',
        bodyKey: 'notif.match.scout_request_sent.body',
        params: { scout: scout.firstName || 'skauti' },
        metadata: { matchId: match._id, scoutId: scout._id },
      });
    } catch (notifyErr) {
      console.log('request-scout notification error:', notifyErr.message);
    }

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
      // For tournament matches check registration approval — guests skip it.
      if (match.tournament) {
        const TournamentRegistration = require('../TournamentRegistration/tournament_registration.model');
        const registered = playerStats.filter(s => s.player && !s.isGuest);
        const playerIds = registered.map(s => s.player);
        const approvedRegs = await TournamentRegistration.find({
          tournament: match.tournament._id ?? match.tournament,
          player: { $in: playerIds },
          status: 'APPROVED',
        }).select('player').lean();
        const approvedSet = new Set(approvedRegs.map(r => r.player.toString()));
        const blocked = registered.filter(s => !approvedSet.has(s.player));
        if (blocked.length > 0) {
          return res.status(403).json({
            error: `Player(s) not approved for this tournament`,
            blockedPlayers: blocked.map(s => s.player),
          });
        }
      }
      playerStats.forEach(stat => {
        if (!stat.player) {
          match.playerStats.push(stat);
          return;
        }
        const existing = match.playerStats.find(s => s.player && s.player.toString() === String(stat.player));
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
