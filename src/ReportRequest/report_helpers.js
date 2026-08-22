// Helpers that shape the data that goes into a PLAYER report PDF.
//
// Consumers (report_request.http.router.js) supply:
//   - playerId  — the User being profiled
//   - tier      — the requester's effective tier (STANDARD / GOLD / PLATINUM)
//                 controls which sections render
//   - from / to — optional Date range for time-scoped stats + eval summary
//                 Gold clients are capped to a 90-day window upstream

const mongoose = require('mongoose');
const Match = require('../Match/match.model');
const ScoutReport = require('../ScoutReport/scout_report.model');

// The 11 attributes that appear on EVERY scout template (all positions).
// Used for "top strengths / bottom weaknesses" aggregation.
const CORE_ATTRIBUTES = [
  'acceleration_5m', 'top_speed_30m', 'agility_balance',
  'stamina_workrate', 'functional_strength',
  'first_touch', 'passing_accuracy', 'dribbling_ball_control',
  'scanning_frequency', 'composure_under_pressure', 'emotional_resilience',
];

// Human-friendly label for each attribute — used in the PDF summary.
const ATTR_LABELS = {
  acceleration_5m: '5m acceleration',
  top_speed_30m: '30m top speed',
  agility_balance: 'Agility & balance',
  stamina_workrate: 'Stamina & work rate',
  functional_strength: 'Functional strength',
  first_touch: 'First touch',
  passing_accuracy: 'Passing accuracy',
  dribbling_ball_control: 'Dribbling / ball control',
  scanning_frequency: 'Scanning frequency',
  composure_under_pressure: 'Composure under pressure',
  emotional_resilience: 'Emotional resilience',
};

const ATTR_LABELS_SW = {
  acceleration_5m: 'Uwezo wa kwenda kasi (5m)',
  top_speed_30m: 'Kasi ya juu (30m)',
  agility_balance: 'Wepesi na uwiano',
  stamina_workrate: 'Nguvu na kufanya kazi',
  functional_strength: 'Nguvu ya kimwili',
  first_touch: 'Mgusano wa kwanza',
  passing_accuracy: 'Usahihi wa pasi',
  dribbling_ball_control: 'Kuchezea mpira',
  scanning_frequency: 'Uangalifu wa uwanja',
  composure_under_pressure: 'Utulivu chini ya shinikizo',
  emotional_resilience: 'Ustahimilivu wa hisia',
};

// Aggregate player-appearance stats from Match player-stat sub-docs, with
// optional date range. Returns { appearances, goals, assists, yellowCards,
// redCards, minutesPlayed }.
async function playerStatsInRange(playerId, { from, to } = {}) {
  const oid = mongoose.Types.ObjectId(playerId);
  const matchQ = { 'playerStats.player': oid, status: 'COMPLETED' };
  if (from || to) {
    matchQ.scheduledDate = {};
    if (from) matchQ.scheduledDate.$gte = new Date(from);
    if (to) matchQ.scheduledDate.$lte = new Date(to);
  }
  const rows = await Match.find(matchQ)
    .select('playerStats scheduledDate')
    .lean();
  const totals = {
    appearances: 0,
    goals: 0,
    assists: 0,
    yellowCards: 0,
    redCards: 0,
    minutesPlayed: 0,
  };
  for (const m of rows) {
    for (const p of (m.playerStats || [])) {
      if (!p.player || String(p.player) !== String(playerId)) continue;
      totals.appearances += 1;
      totals.goals += p.goals || 0;
      totals.assists += p.assists || 0;
      totals.yellowCards += p.yellowCards || 0;
      totals.redCards += p.redCards || 0;
      totals.minutesPlayed += p.minutesPlayed || 0;
    }
  }
  return totals;
}

// Aggregate scout-evaluation summary per Treatment A (no scout attribution,
// no full prose from any single eval — only counts + means + recurrence).
// Returns null when there are zero evaluations.
async function evaluationSummary(playerId, { from, to } = {}) {
  const q = { player: mongoose.Types.ObjectId(playerId) };
  if (from || to) {
    q.createdAt = {};
    if (from) q.createdAt.$gte = new Date(from);
    if (to) q.createdAt.$lte = new Date(to);
  }
  const evals = await ScoutReport.find(q).lean();
  if (!evals.length) return null;

  // Verification split — evaluations are considered "verified" once the
  // player confirms them via the ScoutCv flow. We approximate here by
  // presence of a matching ScoutCv row; a full join is out of scope for
  // the PDF path. For beta, verified count uses the isOfficial flag on
  // the ScoutReport (official assignments imply high trust).
  const verified = evals.filter((e) => e.isOfficial).length;
  const pending = evals.length - verified;

  // Overall rating distribution
  const overallVals = evals.map((e) => e.overall_rating).filter((v) => typeof v === 'number');
  const avgOverall = overallVals.length
    ? overallVals.reduce((a, b) => a + b, 0) / overallVals.length
    : null;
  const varOverall = overallVals.length > 1
    ? overallVals.reduce((s, v) => s + Math.pow(v - avgOverall, 2), 0) / overallVals.length
    : 0;
  const stdDevOverall = Math.sqrt(varOverall);
  // Consistency = tight sample → "scouts largely agree".
  const consistency = overallVals.length < 2
    ? 'insufficient sample'
    : stdDevOverall <= 1.0
      ? 'scouts largely agree'
      : stdDevOverall <= 1.8
        ? 'moderate spread of views'
        : 'wide spread of views';

  // Verdict distribution (Tier 1..4)
  const verdictCounts = { 'Tier 1': 0, 'Tier 2': 0, 'Tier 3': 0, 'Tier 4': 0 };
  for (const e of evals) {
    if (e.scout_verdict && verdictCounts[e.scout_verdict] !== undefined) {
      verdictCounts[e.scout_verdict] += 1;
    }
  }

  // Per-attribute means across all evaluations (core attributes only —
  // position-specific attrs sample from fewer evals and don't compare
  // fairly). Sort → top 3 strengths, bottom 2 weaknesses.
  const attrMeans = [];
  for (const attr of CORE_ATTRIBUTES) {
    const vals = evals.map((e) => e[attr]).filter((v) => typeof v === 'number');
    if (!vals.length) continue;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    attrMeans.push({ attr, mean, sample: vals.length });
  }
  attrMeans.sort((a, b) => b.mean - a.mean);
  const topStrengths = attrMeans.slice(0, 3);
  const bottomWeaknesses = attrMeans.slice(-2).reverse();  // lowest first

  // Prose recurrence — most-common standout_trait / primary_deficiency
  // values across evaluations. Platinum-only in the renderer, computed
  // here so callers can reuse without a second pass.
  const proseCounts = (field) => {
    const counts = new Map();
    for (const e of evals) {
      const v = (e[field] || '').trim();
      if (!v) continue;
      const key = v.toLowerCase();
      counts.set(key, {
        display: v,
        count: (counts.get(key)?.count || 0) + 1,
      });
    }
    return Array.from(counts.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);
  };
  const recurringStrengths = proseCounts('standout_trait');
  const recurringWeaknesses = proseCounts('primary_deficiency');

  return {
    count: evals.length,
    verified,
    pending,
    avgOverall: avgOverall != null ? Number(avgOverall.toFixed(1)) : null,
    stdDevOverall: Number(stdDevOverall.toFixed(2)),
    consistency,
    verdictCounts,
    topStrengths,        // [{ attr, mean, sample }]
    bottomWeaknesses,    // [{ attr, mean, sample }]
    recurringStrengths,  // [{ display, count }]  — Platinum-only
    recurringWeaknesses, // [{ display, count }]  — Platinum-only
  };
}

module.exports = {
  playerStatsInRange,
  evaluationSummary,
  ATTR_LABELS,
  ATTR_LABELS_SW,
  CORE_ATTRIBUTES,
};
