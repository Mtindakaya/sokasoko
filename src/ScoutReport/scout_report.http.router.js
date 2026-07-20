const express = require('express');
const { getString } = require('@lykmapipo/env');
const mongoose = require('mongoose');
const ScoutReport = require('./scout_report.model');
const ScoutInvoice = require('../ScoutInvoice/scout_invoice.model');
const User = require('../User/user.model');
const Match = require('../Match/match.model');
const ChatMessage = require('../Chat/chat.model');

const API_VERSION = getString('API_VERSION', '1.0.0');
const router = express.Router();
const BASE = `/v${API_VERSION.split('.')[0]}/scout-reports`;
const INVOICE_BASE = `/v${API_VERSION.split('.')[0]}/scout-invoices`;

// Find the current scout's entry in match.scouts[]. Returns { requestType,
// requester, team } for computing the invoice, or null if the scout wasn't
// found on this match.
function scoutAssignmentFor(match, scoutId) {
  const scoutIdStr = String(scoutId);
  const entries = Array.isArray(match.scouts) ? match.scouts : [];
  for (const e of entries) {
    const s = e && e.scout;
    const eScoutId = s && (s._id ? String(s._id) : String(s));
    if (eScoutId !== scoutIdStr) continue;
    const requestType = e.requestType || 'ACADEMY';
    const requester = e.requestedBy || null;
    // Which team's players are we scouting?
    // ACADEMY request: the requester IS a team owner (homeTeam or awayTeam
    // user id). PLAYER request: the requester is a player whose `school`
    // points to the team.
    let team = null;
    if (requestType === 'ACADEMY') {
      team = requester;
    } else {
      // Best-effort: pick whichever side the requester plays on. Populated
      // lookups happen in the caller so we defer that here.
      team = null;
    }
    return { requestType, requester, team };
  }
  // Legacy single-scout fallback — the request must have been academy-added
  // (there was no per-scout requester field before).
  if (match.scout && String(match.scout._id || match.scout) === scoutIdStr) {
    return { requestType: 'ACADEMY', requester: match.homeTeam, team: match.homeTeam };
  }
  return null;
}

async function resolveRequestedTeam(match, assignment) {
  if (assignment.team) return assignment.team;
  if (assignment.requestType === 'PLAYER' && assignment.requester) {
    const player = await User.findById(assignment.requester).select('school').lean();
    if (!player || !player.school) return null;
    const schoolId = String(player.school);
    const homeId = match.homeTeam ? String(match.homeTeam) : null;
    const awayId = match.awayTeam ? String(match.awayTeam) : null;
    if (schoolId === homeId || schoolId === awayId) return player.school;
  }
  return null;
}

// After every report submission, check whether the scout has now covered
// every player in the requester's team for this match; if so, issue the
// invoice and (for now) auto-mark it paid so reports land immediately.
async function maybeIssueInvoice({ scoutId, matchId, io }) {
  try {
    const match = await Match.findById(matchId)
      .populate('homeTeam', 'firstName lastName academy_name')
      .populate('awayTeam', 'firstName lastName academy_name')
      .lean();
    if (!match) return;

    const assignment = scoutAssignmentFor(match, scoutId);
    if (!assignment || !assignment.requester) return;

    const teamId = await resolveRequestedTeam(match, assignment);
    if (!teamId) return;
    const teamIdStr = String(teamId);

    // Roster the coach submitted for the team we're scouting.
    const expectedPlayerIds = new Set();
    for (const s of match.playerStats || []) {
      const t = s.team;
      const tId = t && (t._id ? String(t._id) : String(t));
      if (tId !== teamIdStr) continue;
      const p = s.player;
      const pId = p && (p._id ? String(p._id) : String(p));
      if (pId) expectedPlayerIds.add(pId);
    }
    if (expectedPlayerIds.size === 0) return;

    // Reports this scout has already filed for this match.
    const filed = await ScoutReport.find({
      scout: scoutId,
      eventId: String(matchId),
      eventType: 'MATCH',
    }).select('player').lean();
    const filedPlayerIds = new Set(filed.map(r => String(r.player)));

    for (const pid of expectedPlayerIds) {
      if (!filedPlayerIds.has(pid)) return; // still work to do
    }

    // All covered → issue invoice (idempotent via unique index).
    const existing = await ScoutInvoice.findOne({ scout: scoutId, match: matchId });
    if (existing) return;

    const scoutUser = await User.findById(scoutId)
      .select('firstName lastName costPerGame costPerPlayer')
      .lean();
    if (!scoutUser) return;

    const playerCount = expectedPlayerIds.size;
    const perPlayer = Number(scoutUser.costPerPlayer || 0);
    const perGame = Number(scoutUser.costPerGame || 0);
    const scoutFeeTotal =
      assignment.requestType === 'PLAYER'
        ? perPlayer * playerCount
        : perGame;
    const platformCommissionPct = 20;
    const platformCommission = Math.round(scoutFeeTotal * platformCommissionPct) / 100;
    const additionalPlatformFee = 0;
    const invoiceTotal = scoutFeeTotal + additionalPlatformFee;
    const scoutNet = scoutFeeTotal - platformCommission;

    const invoice = await ScoutInvoice.create({
      scout: scoutId,
      requester: assignment.requester,
      requestType: assignment.requestType,
      match: matchId,
      team: teamId,
      playerCount,
      scoutFeeTotal,
      platformCommissionPct,
      platformCommission,
      additionalPlatformFee,
      invoiceTotal,
      scoutNet,
    });

    const scoutName = `${scoutUser.firstName || ''} ${scoutUser.lastName || ''}`.trim() || 'The scout';
    const homeName = (match.homeTeam && (match.homeTeam.academy_name || `${match.homeTeam.firstName || ''} ${match.homeTeam.lastName || ''}`.trim())) || 'Home';
    const awayName = (match.awayTeam && (match.awayTeam.academy_name || `${match.awayTeam.firstName || ''} ${match.awayTeam.lastName || ''}`.trim())) || 'Away';

    // Step 1: invoice message to the requester.
    const invoiceMsg = [
      `Invoice ${invoice.invoiceNumber}`,
      `${scoutName} has completed the evaluation of your team for ${homeName} vs ${awayName}.`,
      `Players evaluated: ${playerCount}`,
      `Amount due: $${invoiceTotal}`,
      '',
      'Payment is required to receive the reports.',
    ].join('\n');
    try {
      await ChatMessage.create({
        sender: scoutId,
        receiver: assignment.requester,
        content: invoiceMsg,
        read: false,
      });
    } catch (e) {
      console.log('invoice-notify error:', e.message);
    }

    // Payment integration is stubbed for now — auto-mark PAID and cascade
    // the delivery / payout notifications. Split out to markInvoicePaid()
    // so a real payment flow can call the same code path.
    await markInvoicePaid(invoice, { match, scoutUser, homeName, awayName, playerCount });
  } catch (err) {
    console.log('maybeIssueInvoice error:', err.message);
  }
}

async function markInvoicePaid(invoice, ctx) {
  invoice.status = 'PAID';
  invoice.paidAt = new Date();
  await invoice.save();

  const scoutName = `${ctx.scoutUser.firstName || ''} ${ctx.scoutUser.lastName || ''}`.trim() || 'the scout';

  // Message 2 → requester: payment confirmed, reports delivered.
  const deliveryMsg = [
    `Payment confirmed for invoice ${invoice.invoiceNumber}.`,
    `Reports from ${scoutName} for ${ctx.homeName} vs ${ctx.awayName} are now available.`,
    `Open Scout Reports in the SokaSoko app to view the ${ctx.playerCount} evaluation${ctx.playerCount === 1 ? '' : 's'}.`,
  ].join('\n');
  try {
    await ChatMessage.create({
      sender: invoice.scout,
      receiver: invoice.requester,
      content: deliveryMsg,
      read: false,
    });
  } catch (e) {
    console.log('delivery-notify error:', e.message);
  }

  // Message to scout: payment settled.
  const payoutMsg = [
    `Payment of $${invoice.scoutFeeTotal} received for ${ctx.homeName} vs ${ctx.awayName}.`,
    `Platform commission (${invoice.platformCommissionPct}%): -$${invoice.platformCommission}`,
    `Net to you: $${invoice.scoutNet}`,
    `Invoice: ${invoice.invoiceNumber}`,
  ].join('\n');
  try {
    await ChatMessage.create({
      sender: invoice.requester,
      receiver: invoice.scout,
      content: payoutMsg,
      read: false,
    });
  } catch (e) {
    console.log('payout-notify error:', e.message);
  }
}

// GET /v1/scout-reports/check?scoutId=&playerId=&eventId=
router.get(`${BASE}/check`, async (req, res) => {
  try {
    const { scoutId, playerId, eventId } = req.query;
    if (!scoutId || !playerId || !eventId) {
      return res.status(400).json({ error: 'scoutId, playerId and eventId are required' });
    }
    const existing = await ScoutReport.findOne({ scout: scoutId, player: playerId, eventId })
      .select('_id createdAt overall_rating scout_verdict').lean();
    return res.status(200).json({ exists: !!existing, report: existing || null });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/scout-reports — submit an evaluation
router.post(BASE, async (req, res) => {
  try {
    // Duplicate guard
    const existing = await ScoutReport.findOne({
      scout: req.body.scout,
      player: req.body.player,
      eventId: req.body.eventId,
    });
    if (existing) {
      return res.status(409).json({ error: 'You have already submitted an evaluation for this player at this event.' });
    }

    const report = await ScoutReport.create(req.body);
    const populated = await ScoutReport.findById(report._id)
      .populate('scout', 'firstName lastName type accountNumber')
      .populate('player', 'firstName lastName type position accountNumber profileImage');

    // Fire-and-forget: if this was a MATCH report, check completion and
    // potentially issue the invoice + cascade notifications. Not awaited so
    // the HTTP response returns immediately regardless of chat/invoice
    // side-effects.
    if (report.eventType === 'MATCH') {
      maybeIssueInvoice({ scoutId: report.scout, matchId: report.eventId })
        .catch(err => console.log('maybeIssueInvoice failed:', err.message));
    }

    return res.status(201).json({ data: populated });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'You have already submitted an evaluation for this player at this event.' });
    }
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/scout-reports — fetch reports for a user
// ?userId=&userType=   (SCOUT → reports authored by this scout)
//                      (PLAYER → reports about this player)
router.get(BASE, async (req, res) => {
  try {
    const { userId, userType } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    let filter = {};
    if (userType === 'SCOUT' || userType === 'COACH') {
      filter.scout = userId;
    } else {
      filter.player = userId;
    }

    const reports = await ScoutReport.find(filter)
      .populate('scout', 'firstName lastName type accountNumber')
      .populate('player', 'firstName lastName type position accountNumber profileImage')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    // Enrich each report with its event (match or trial) data
    const Match = mongoose.model('Match');
    const Trial = mongoose.model('Trial');

    const matchIds = reports.filter(r => r.eventType === 'MATCH').map(r => r.eventId);
    const trialIds = reports.filter(r => r.eventType === 'TRIAL').map(r => r.eventId);

    const [matches, trials] = await Promise.all([
      matchIds.length
        ? Match.find({ _id: { $in: matchIds } })
            .select('_id scheduledDate homeTeam awayTeam')
            .populate('homeTeam', 'firstName lastName academy_name academyName')
            .populate('awayTeam', 'firstName lastName academy_name academyName')
            .lean()
        : [],
      trialIds.length
        ? Trial.find({ _id: { $in: trialIds } })
            .select('_id title startDate location')
            .lean()
        : [],
    ]);

    const matchMap = Object.fromEntries(matches.map(m => [m._id.toString(), m]));
    const trialMap = Object.fromEntries(trials.map(t => [t._id.toString(), t]));

    const enriched = reports.map(r => {
      if (r.eventType === 'MATCH') {
        r.eventData = matchMap[r.eventId] || null;
      } else {
        r.eventData = trialMap[r.eventId] || null;
      }
      return r;
    });

    return res.status(200).json({ data: enriched });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/scout-invoices?userId=&role= — list invoices for a scout or requester.
router.get(INVOICE_BASE, async (req, res) => {
  try {
    const { userId, role = 'REQUESTER' } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    const filter = role === 'SCOUT' ? { scout: userId } : { requester: userId };
    const invoices = await ScoutInvoice.find(filter)
      .populate('scout', 'firstName lastName accountNumber')
      .populate('requester', 'firstName lastName academy_name accountNumber type')
      .populate('match', 'homeTeam awayTeam scheduledDate')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    return res.status(200).json({ data: invoices });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/scout-invoices/:id/mark-paid — real payment hook lands here.
// The report submission handler currently auto-calls this immediately, but
// keeping the endpoint explicit lets Stripe/M-Pesa swap in without a
// wider refactor.
router.post(`${INVOICE_BASE}/:id/mark-paid`, async (req, res) => {
  try {
    const invoice = await ScoutInvoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    if (invoice.status === 'PAID') {
      return res.status(200).json({ data: invoice });
    }
    const match = await Match.findById(invoice.match)
      .populate('homeTeam', 'firstName lastName academy_name')
      .populate('awayTeam', 'firstName lastName academy_name')
      .lean();
    const scoutUser = await User.findById(invoice.scout)
      .select('firstName lastName')
      .lean();
    const homeName = (match && match.homeTeam && (match.homeTeam.academy_name || `${match.homeTeam.firstName || ''} ${match.homeTeam.lastName || ''}`.trim())) || 'Home';
    const awayName = (match && match.awayTeam && (match.awayTeam.academy_name || `${match.awayTeam.firstName || ''} ${match.awayTeam.lastName || ''}`.trim())) || 'Away';
    await markInvoicePaid(invoice, {
      match,
      scoutUser,
      homeName,
      awayName,
      playerCount: invoice.playerCount,
    });
    return res.status(200).json({ data: invoice });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
