const express = require('express');
const { getString } = require('@lykmapipo/env');
const _ = require('lodash');
const Tournament = require('./tournament.model');
const User = require('../User/user.model');
const { Subscription, FEATURE_CAPS } = require('../Subscription/subscription.model');
const { uploadFor } = require('../Utils/uploader');
const { requireAdminKey } = require('../middleware/adminAuth');
const {
  generateFixturesFor, computeStandingsFor,
} = require('./tournament.fixtures');

const API_VERSION = getString('API_VERSION', '1.0.0');
const router = express.Router();
const BASE = `/v${API_VERSION.split('.')[0]}/tournaments`;

// GET /v1/tournaments
// Public list hides unpublished drafts. When `organizer` is on the
// query we return every tournament for that user (their own drafts
// included), so the organizer can manage private prep from the app.
// `includeUnpublished=true` also opts in (admin / owner tooling).
router.get(BASE, async (req, res) => {
  try {
    const { page = 1, limit = 20, status, type, organizer, includeUnpublished } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (type) filter.type = type;
    if (organizer) filter.organizer = organizer;
    if (!organizer && String(includeUnpublished) !== 'true') {
      filter.isPublished = true;
    }

    const tournaments = await Tournament.find(filter)
      .populate('organizer', 'firstName lastName type academyName companyName')
      .populate('venue', 'name region district')
      .populate('teams', 'firstName lastName academyName type accountNumber')
      .sort({ startDate: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Tournament.countDocuments(filter);
    return res.status(200).json({ data: tournaments, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/tournaments/:id
router.get(`${BASE}/:id`, async (req, res) => {
  try {
    const tournament = await Tournament.findById(req.params.id)
      .populate('organizer', 'firstName lastName type academyName companyName')
      .populate('venue', 'name region district')
      .populate('teams', 'firstName lastName academyName type accountNumber profileImage');
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    return res.status(200).json({ data: tournament });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/tournaments — uploadFor() lets logoUrl / mascotUrl /
// hostLogoUrl arrive as multipart image files; the middleware
// resolves them to URL strings on req.body before the handler runs.
router.post(BASE, uploadFor(), async (req, res) => {
  try {
    const {
      name, type, organizer, startDate, endDate, region, venue, maxTeams,
      ageGroup, categories, description, prize, rules, photo,
      firstPrize, runnerUpPrize, hasNoPrizes,
      officialScouts, officialReferees, district,
      logoUrl, mascotUrl, hostLogoUrl, premiumBundle,
    } = req.body;
    if (!name || !type || !organizer || !startDate || !endDate) {
      return res.status(400).json({ error: 'name, type, organizer, startDate and endDate are required' });
    }

    // Tier gate for COACH + ACADEMY organizers. Standard blocked entirely.
    // Gold capped at maxTournamentTeams (8). Platinum unlimited.
    try {
      const org = await User.findById(organizer).select('type').lean();
      let orgType = org?.type;
      let ctx = null;
      if (orgType === 'GUARDIAN') {
        ctx = await Subscription.getEffectiveContext(organizer);
        if (ctx?.delegated) orgType = ctx.userType;
        else {
          return res.status(403).json({
            error: 'Walezi hawaruhusiwi kuchapisha mashindano.',
            reason: 'GUARDIAN_TOURNAMENT_CREATION_BLOCKED',
          });
        }
      }
      if (['COACH', 'ACADEMY', 'CLUB', 'FOOTBALL_ASSOCIATION'].includes(orgType)) {
        const tier = ctx?.delegated ? ctx.tier
          : await Subscription.getEffectiveTier(organizer, orgType);
        const caps = ctx?.delegated ? ctx.caps
          : (FEATURE_CAPS[orgType]?.[tier] || {});
        if (caps.canCreateTournaments !== true) {
          return res.status(403).json({
            error: `Kifurushi cha ${tier} hakiruhusu kuchapisha mashindano. Boresha hadi Gold.`,
            reason: `${orgType}_TOURNAMENT_CREATION_BLOCKED`,
            tier,
          });
        }
        if (caps.maxTournamentTeams != null && maxTeams > caps.maxTournamentTeams) {
          return res.status(403).json({
            error: `Kifurushi cha ${tier} kinaruhusu timu hadi ${caps.maxTournamentTeams} tu kwa shindano moja. Boresha hadi Platinum kwa idadi isiyo na kikomo.`,
            reason: `${orgType}_TOURNAMENT_TEAM_LIMIT`,
            tier,
            maxTournamentTeams: caps.maxTournamentTeams,
          });
        }
      }
    } catch (_) { /* fall through */ }

    // FULL_360 (SokaSoko 360 premium bundle) is Enterprise-only. Any
    // non-Enterprise organizer that requests it silently downgrades
    // to STANDARD so the client can't get around the gate by sending
    // premiumBundle=FULL_360 in the payload. Activation is admin-
    // driven (POST /v1/tournaments/:id/activate-premium) after the
    // custom-fee receipt is confirmed offline.
    let effectiveBundle = 'STANDARD';
    if (premiumBundle === 'FULL_360') {
      try {
        const org = await User.findById(organizer).select('type').lean();
        const orgType = org?.type;
        const t = await Subscription.getEffectiveTier(organizer, orgType);
        if (t === 'ENTERPRISE') effectiveBundle = 'FULL_360';
      } catch (_) { /* stay STANDARD */ }
    }

    const tournament = await Tournament.create({
      name, type, organizer, startDate, endDate, region, venue, maxTeams,
      ageGroup, categories, description, prize, rules, photo,
      district: district || '',
      firstPrize: firstPrize || '',
      runnerUpPrize: runnerUpPrize || '',
      hasNoPrizes: !!hasNoPrizes,
      officialScouts: Array.isArray(officialScouts) ? officialScouts : [],
      officialReferees: Array.isArray(officialReferees) ? officialReferees : [],
      logoUrl: (logoUrl || '').toString().trim(),
      mascotUrl: (mascotUrl || '').toString().trim(),
      hostLogoUrl: (hostLogoUrl || '').toString().trim(),
      premiumBundle: effectiveBundle,
      premiumActivated: false, // always starts inactive; admin flips
      // New tournaments start private — organizer publishes when ready.
      isPublished: false,
    });
    return res.status(201).json({ data: tournament });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/tournaments/:id/teams — add a team to tournament
router.post(`${BASE}/:id/teams`, async (req, res) => {
  try {
    const { teamId } = req.body;
    const tournament = await Tournament.findById(req.params.id);
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    if (tournament.teams.includes(teamId)) return res.status(400).json({ error: 'Team already in tournament' });
    if (tournament.teams.length >= tournament.maxTeams) return res.status(400).json({ error: 'Tournament is full' });
    tournament.teams.push(teamId);
    await tournament.save();
    return res.status(200).json({ data: tournament });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /v1/tournaments/:id/teams/:teamId — remove a team
router.delete(`${BASE}/:id/teams/:teamId`, async (req, res) => {
  try {
    const tournament = await Tournament.findById(req.params.id);
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    tournament.teams = tournament.teams.filter(t => t.toString() !== req.params.teamId);
    await tournament.save();
    return res.status(200).json({ data: tournament });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /v1/tournaments/:id
// PATCH /v1/tournaments/:id — uploadFor for logo swaps on edit.
router.patch(`${BASE}/:id`, uploadFor(), async (req, res) => {
  try {
    // Non-admin callers cannot flip premiumBundle from STANDARD →
    // FULL_360 via PATCH; guard the field so this stays admin-only.
    const body = { ...req.body };
    delete body.premiumBundle;
    delete body.premiumActivated;
    delete body.premiumActivatedAt;
    delete body.premiumFeeReceipt;
    const tournament = await Tournament.findByIdAndUpdate(req.params.id, body, { new: true });
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    return res.status(200).json({ data: tournament });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/tournaments/:id/activate-premium  body: { receiptRef, bundle? }
// Admin activates the SokaSoko 360 bundle after receiving the
// customized-tournament fee offline. Bundle defaults to FULL_360;
// receiptRef is stored on premiumFeeReceipt for audit. Idempotent:
// re-activation with a different receiptRef updates the ref +
// timestamp without duplicating anything.
router.post(`${BASE}/:id/activate-premium`, requireAdminKey, async (req, res) => {
  try {
    const { receiptRef, bundle } = req.body || {};
    const t = await Tournament.findById(req.params.id);
    if (!t) return res.status(404).json({ error: 'Tournament not found' });
    const orgType = (await User.findById(t.organizer).select('type').lean())?.type;
    const orgTier = await Subscription.getEffectiveTier(t.organizer, orgType);
    if (orgTier !== 'ENTERPRISE') {
      return res.status(409).json({
        error: 'Only Enterprise organizers can activate SokaSoko 360.',
        errorKey: 'tournament.err.not_enterprise',
        organizerTier: orgTier,
      });
    }
    t.premiumBundle = (bundle === 'FULL_360' || bundle === undefined) ? 'FULL_360' : bundle;
    t.premiumActivated = true;
    t.premiumActivatedAt = new Date();
    if (receiptRef) t.premiumFeeReceipt = String(receiptRef).trim();
    await t.save();
    return res.status(200).json({ data: t });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/tournaments/:id/deactivate-premium  body: { reason? }
// Admin can revoke premium (e.g. fee reversed / dispute).
router.post(`${BASE}/:id/deactivate-premium`, requireAdminKey, async (req, res) => {
  try {
    const t = await Tournament.findById(req.params.id);
    if (!t) return res.status(404).json({ error: 'Tournament not found' });
    t.premiumActivated = false;
    t.premiumActivatedAt = null;
    await t.save();
    return res.status(200).json({ data: t });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /v1/tournaments/:id/publish  body: { publish: bool }
// Organizer-only toggle. On first publish, stamps publishedAt.
router.patch(`${BASE}/:id/publish`, async (req, res) => {
  try {
    const { publish } = req.body || {};
    if (typeof publish !== 'boolean') {
      return res.status(400).json({ error: 'publish (bool) required' });
    }
    const t = await Tournament.findById(req.params.id);
    if (!t) return res.status(404).json({ error: 'Tournament not found' });
    t.isPublished = publish;
    if (publish && !t.publishedAt) t.publishedAt = new Date();
    await t.save();
    return res.status(200).json({ data: t });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/tournaments/:id/fixtures/generate  body: {
//   groupCount, teamsPerGroup?, seedOrder, startDate, gapMinutes,
//   defaultVenue, category?  }
// SokaSoko 360-only. Reads approved TournamentTeamRegistrations,
// creates GROUP round-robin Match docs per category + a knockout
// bracket scaffold with nextMatchId links pre-set. Flips tournament
// status to ONGOING. Idempotent-ish — running twice creates duplicate
// fixtures, so admin should confirm before re-running.
router.post(`${BASE}/:id/fixtures/generate`, async (req, res) => {
  try {
    const summary = await generateFixturesFor(req.params.id, req.body || {});
    return res.status(200).json({ data: summary });
  } catch (err) {
    return res.status(err.status || 500).json({
      error: err.message,
      errorKey: err.errorKey,
    });
  }
});

// GET /v1/tournaments/:id/standings?gender=&ageGroup=
// Auto-computed from completed GROUP-stage matches. Returns rows
// grouped by category + group, sorted points → GD → GF.
router.get(`${BASE}/:id/standings`, async (req, res) => {
  try {
    const { gender, ageGroup } = req.query;
    const cat = (gender && ageGroup) ? { gender, ageGroup } : null;
    const rows = await computeStandingsFor(req.params.id, cat);
    return res.status(200).json({ data: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/tournaments/:id/fixtures?stage=&gender=&ageGroup=
// Full fixture list with the KO-tree link (nextMatchId). Client uses
// this to render the bracket + group tables together.
router.get(`${BASE}/:id/fixtures`, async (req, res) => {
  try {
    const Match = require('../Match/match.model');
    const filter = { tournament: req.params.id };
    if (req.query.stage) filter.stage = req.query.stage;
    if (req.query.gender) filter['category.gender'] = req.query.gender;
    if (req.query.ageGroup) filter['category.ageGroup'] = req.query.ageGroup;
    const matches = await Match.find(filter)
      .populate('homeTeam', 'firstName lastName academyName type accountNumber profileImage')
      .populate('awayTeam', 'firstName lastName academyName type accountNumber profileImage')
      .populate('venue', 'name region district')
      .sort({ stage: 1, scheduledDate: 1, bracketPosition: 1 })
      .lean();
    return res.status(200).json({ data: matches });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /v1/tournaments/:id
router.delete(`${BASE}/:id`, async (req, res) => {
  try {
    const tournament = await Tournament.findByIdAndUpdate(req.params.id, { status: 'CANCELLED' }, { new: true });
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    return res.status(200).json({ data: tournament });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
