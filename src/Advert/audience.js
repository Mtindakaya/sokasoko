// Advert targeting + weighting primitives shared across /v1/feed and
// /v1/adverts. Both surfaces must apply the same audience rules so a
// vendor's targeting choices behave identically on the home feed and
// in the profile carousel.

// Weighted-random sampling, not rank-only. Enterprise ads surface ~12x
// more often than Standard per impression (12/8/4/1), with House ads
// pinned at 8 so paid Platinum still edges them out but official
// placements stay above Gold.
const AD_TIER_WEIGHT = {
  ENTERPRISE: 12,
  HOUSE: 8,
  PLATINUM: 8,
  GOLD: 4,
  STANDARD: 1,
};

// Build the Mongo $and fragment that enforces "empty = broadcast,
// non-empty = must contain viewer value" across all five targeting
// axes. Omit any axis the viewer doesn't have (e.g. a VENDOR has no
// gender → ads targeted MALE-only still show, per the lenient rule).
function audienceMatchClause(viewer) {
  const clauses = [];
  const axes = [
    ['targetAudience', viewer && viewer.type],
    ['targetGender', viewer && viewer.gender],
    ['targetRegions', viewer && viewer.region],
    ['targetDistricts', viewer && viewer.district],
    ['targetWards', viewer && viewer.ward],
  ];
  for (const [field, value] of axes) {
    if (!value) {
      // Viewer lacks this attribute → only match ads that didn't
      // require it (empty target array = broadcast at this axis).
      clauses.push({
        $or: [
          { [field]: { $exists: false } },
          { [field]: { $size: 0 } },
        ],
      });
    } else {
      clauses.push({
        $or: [
          { [field]: { $exists: false } },
          { [field]: { $size: 0 } },
          { [field]: value },
        ],
      });
    }
  }
  return clauses;
}

// Weighted-random without replacement. Each pick draws proportional
// to tier weight; the drawn ad is removed from the pool so we don't
// surface the same card twice in one feed load.
function pickWeightedSample(ads, n) {
  const pool = ads.slice();
  const out = [];
  while (pool.length && out.length < n) {
    const totalWeight = pool.reduce(
      (sum, a) => sum + (AD_TIER_WEIGHT[a.advertiserTier] || 1),
      0,
    );
    let roll = Math.random() * totalWeight;
    let picked = pool.length - 1;
    for (let i = 0; i < pool.length; i += 1) {
      const w = AD_TIER_WEIGHT[pool[i].advertiserTier] || 1;
      if (roll < w) { picked = i; break; }
      roll -= w;
    }
    out.push(pool[picked]);
    pool.splice(picked, 1);
  }
  return out;
}

module.exports = {
  AD_TIER_WEIGHT,
  audienceMatchClause,
  pickWeightedSample,
};
