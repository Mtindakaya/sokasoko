// SokaSoko Recommend endpoints. Client POSTs a brief (venue location +
// rate-per-game budget); backend returns up to 3 ranked candidates.
//
// Client can call again with `exclude: [prevIds]` to cycle to the next
// best candidate — pool is not re-shuffled, so a second call with
// exclude=[topId] returns the same list minus the top row.

const express = require('express');
const { scoreScouts, scoreReferees } = require('./recommendation.service');
const Venue = require('../Venue/venue.model');

const router = express.Router();

async function resolveLocation(body) {
  // Prefer explicit location fields from the client. If they only
  // supplied a venueId, look it up so callers don't have to pre-fetch.
  if (body.location && typeof body.location === 'object') {
    return body.location;
  }
  if (body.venueId) {
    const v = await Venue.findById(body.venueId)
      .select('region district ward serikaliYaMtaa street')
      .lean();
    if (v) return v;
  }
  return null;
}

router.post('/v1/recommend/scout', async (req, res) => {
  try {
    const location = await resolveLocation(req.body);
    const budget = Number(req.body.budget) || 0;
    const exclude = Array.isArray(req.body.exclude) ? req.body.exclude : [];
    const candidates = await scoreScouts({ location, budget, exclude });
    return res.json({ candidates });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/v1/recommend/referee', async (req, res) => {
  try {
    const location = await resolveLocation(req.body);
    const budget = Number(req.body.budget) || 0;
    const exclude = Array.isArray(req.body.exclude) ? req.body.exclude : [];
    const candidates = await scoreReferees({ location, budget, exclude });
    return res.json({ candidates });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
