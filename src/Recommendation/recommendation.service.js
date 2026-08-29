// SokaSoko Recommend scoring service.
//
// Scores SCOUT / REFEREE candidates against a client's brief
// (venue location + rate-per-game budget) and returns the top 3.
//
// Scout weights (total 100):
//   Completed hired evaluations  50
//   Scout training (yes/no)      25
//   Cost within budget           15
//   Location proximity           10
//
// Referee weights (total 100):
//   Star rating (out of 5)       40
//   Games officiated             30
//   Has referee license          10
//   Cost within budget           10
//   Location proximity           10
//
// Cost scoring: <= budget → 100 · <= budget * 1.10 → 50 · else → EXCLUDED.
// Location scoring: serikaliYaMtaa match 100 · ward 75 · district 50 ·
//                   region 25 · else 0.
// Tie-breaker: earlier createdAt (veterans first).

const User = require('../User/user.model');
const ScoutReport = require('../ScoutReport/scout_report.model');
const RefereeRating = require('../RefereeRating/referee_rating.model');

const TOP_N = 3;
const BUDGET_WINDOW = 1.10;

function costScore(candidateFee, budget) {
  if (!budget || budget <= 0) return 100; // no budget → don't penalize
  if (!candidateFee || candidateFee <= 0) return 100; // scout hasn't set → treat as free
  if (candidateFee <= budget) return 100;
  if (candidateFee <= budget * BUDGET_WINDOW) return 50;
  return -1; // sentinel: exclude
}

function locationScore(cand, brief) {
  if (!brief) return 0;
  const cmp = (a, b) => a && b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  if (cmp(cand.serikaliYaMtaa || cand.street, brief.serikaliYaMtaa)) return 100;
  if (cmp(cand.ward, brief.ward)) return 75;
  if (cmp(cand.district, brief.district)) return 50;
  if (cmp(cand.region, brief.region)) return 25;
  return 0;
}

async function scoreScouts({ location, budget, exclude = [] }) {
  const scouts = await User.find({
    type: 'SCOUT',
    suspend: { $ne: true },
    isSystemAgent: { $ne: true },
    _id: { $nin: exclude },
  })
    .select('_id firstName lastName profileImage accountNumber region district ward serikaliYaMtaa street costPerGame scoutTraining createdAt')
    .lean();

  if (scouts.length === 0) return [];

  // Completed evaluations per scout — one aggregation.
  const counts = await ScoutReport.aggregate([
    { $match: { scout: { $in: scouts.map((s) => s._id) } } },
    { $group: { _id: '$scout', n: { $sum: 1 } } },
  ]);
  const countMap = new Map(counts.map((c) => [String(c._id), c.n]));
  const maxCount = Math.max(1, ...counts.map((c) => c.n));

  const ranked = [];
  for (const s of scouts) {
    const evalCount = countMap.get(String(s._id)) || 0;
    const evalScore = (evalCount / maxCount) * 100;
    const trainingScore = s.scoutTraining ? 100 : 0;
    const cost = costScore(s.costPerGame, budget);
    if (cost < 0) continue; // over the budget window — drop entirely.
    const loc = locationScore(s, location);

    const total =
      0.50 * evalScore +
      0.25 * trainingScore +
      0.15 * cost +
      0.10 * loc;

    ranked.push({
      user: s,
      score: Math.round(total * 10) / 10,
      breakdown: {
        evalCount,
        evalScore: Math.round(evalScore),
        training: !!s.scoutTraining,
        trainingScore,
        costPerGame: s.costPerGame || 0,
        costScore: cost,
        locationScore: loc,
      },
    });
  }

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return new Date(a.user.createdAt) - new Date(b.user.createdAt);
  });

  return ranked.slice(0, TOP_N);
}

async function scoreReferees({ location, budget, exclude = [] }) {
  const refs = await User.find({
    type: 'REFEREE',
    suspend: { $ne: true },
    isSystemAgent: { $ne: true },
    _id: { $nin: exclude },
  })
    .select('_id firstName lastName profileImage accountNumber region district ward serikaliYaMtaa street costPerGame referee_license_level createdAt')
    .lean();

  if (refs.length === 0) return [];

  // Aggregate rating stars + games officiated per referee.
  const ratings = await RefereeRating.aggregate([
    { $match: { referee: { $in: refs.map((r) => r._id) } } },
    {
      $group: {
        _id: '$referee',
        totalStars: { $sum: '$stars' },
        gamesRated: { $sum: 1 },
      },
    },
  ]);
  const ratingMap = new Map(ratings.map((r) => [String(r._id), r]));
  const maxGames = Math.max(1, ...ratings.map((r) => r.gamesRated));

  const ranked = [];
  for (const r of refs) {
    const stat = ratingMap.get(String(r._id));
    const avgStars = stat && stat.gamesRated > 0
      ? stat.totalStars / stat.gamesRated
      : 0;
    const games = stat ? stat.gamesRated : 0;

    const starScore = (avgStars / 5) * 100;
    const gamesScore = (games / maxGames) * 100;
    const licenseScore = (r.referee_license_level || '').trim().length > 0 ? 100 : 0;
    const cost = costScore(r.costPerGame, budget);
    if (cost < 0) continue;
    const loc = locationScore(r, location);

    const total =
      0.40 * starScore +
      0.30 * gamesScore +
      0.10 * licenseScore +
      0.10 * cost +
      0.10 * loc;

    ranked.push({
      user: r,
      score: Math.round(total * 10) / 10,
      breakdown: {
        averageStars: Math.round(avgStars * 10) / 10,
        starScore: Math.round(starScore),
        gamesOfficiated: games,
        gamesScore: Math.round(gamesScore),
        hasLicense: licenseScore === 100,
        costPerGame: r.costPerGame || 0,
        costScore: cost,
        locationScore: loc,
      },
    });
  }

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return new Date(a.user.createdAt) - new Date(b.user.createdAt);
  });

  return ranked.slice(0, TOP_N);
}

module.exports = { scoreScouts, scoreReferees };
