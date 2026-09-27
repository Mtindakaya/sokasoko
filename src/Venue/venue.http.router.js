const express = require('express');
const { getString } = require('@lykmapipo/env');
const _ = require('lodash');
const Venue = require('./venue.model');
const VenueSuggestion = require('./venue_suggestion.model');
const User = require('../User/user.model');
const { requireAdminKey } = require('../middleware/adminAuth');
const { uploadFor } = require('../Utils/uploader');

const API_VERSION = getString('API_VERSION', '1.0.0');
const router = express.Router();
const BASE = `/v${API_VERSION.split('.')[0]}/venues`;
const SUGGEST_BASE = `/v${API_VERSION.split('.')[0]}/venue-suggestions`;

// Normalise region names (regions.json uses "Arusha" but districts /
// user profiles may store "Arusha Region"). Same helper used across
// the FA + district calendar code.
const _normalise = (s) => String(s || '').trim().toLowerCase()
  .replace(/\s+region$/i, '')
  .replace(/\s+district$/i, '');

// GET /v1/venues
router.get(BASE, async (req, res) => {
  try {
    const { page = 1, limit = 20, region, district, ward, serikaliYaMtaa, status, query } = req.query;
    const filter = {};
    // Region/district/ward/serikaliYaMtaa are equality-matched but
    // case-tolerant so clients don't have to normalise "Arusha" vs
    // "Arusha Region". Serikali ya Mtaa (Shehia in Zanzibar) is the
    // deepest administrative subdivision — Uwanja filter uses it to
    // narrow within a ward.
    const eqRx = (v) => new RegExp(`^${String(v).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    if (region) filter.region = eqRx(region);
    if (district) filter.district = eqRx(district);
    if (ward) filter.ward = eqRx(ward);
    if (serikaliYaMtaa) filter.serikaliYaMtaa = eqRx(serikaliYaMtaa);
    if (status) filter.status = status;
    else filter.status = 'ACTIVE';

    // Keyword search — matches on name/region/district/ward so a
    // single input covers "Uhuru", "Ilala", "Kariakoo" etc. Case-
    // insensitive prefix + substring; short enough to skip the text
    // index and still be sub-100ms on the current dataset.
    if (query && String(query).trim().length >= 2) {
      const q = String(query).trim();
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { name: rx },
        { region: rx },
        { district: rx },
        { ward: rx },
        { serikaliYaMtaa: rx },
      ];
    }

    let venues = await Venue.find(filter)
      .populate('owners', 'firstName lastName academy_name entity_name company_name football_field_name accountNumber type')
      .sort({ name: 1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    // Time-conflict filter. Pass ?scheduledDate=<iso> (optionally
    // ?excludeMatchId=<id>) and any venue already booked within the ±2h
    // match window is dropped from the list — matches the same window
    // used by POST /matches rejection so what the picker shows is what
    // the server will accept.
    if (req.query.scheduledDate && venues.length) {
      const { venueBusy } = require('../Match/conflict.helper');
      const excludeMatchId = req.query.excludeMatchId || null;
      const busyFlags = await Promise.all(
        venues.map((v) => venueBusy(v._id, req.query.scheduledDate,
          { excludeMatchId })),
      );
      venues = venues.filter((_, i) => !busyFlags[i]);
    }

    const total = await Venue.countDocuments(filter);

    return res.status(200).json({ data: venues, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/venues/in-ward?region=&district=&ward=
// Powers the Uwanja wa Nyumbani picker in Academy/Club signup.
// Returns ACTIVE venues in the caller's ward with owner display
// names for the picker + typo hints. Region is required; district
// + ward narrow further when supplied.
router.get(`${BASE}/in-ward`, async (req, res) => {
  try {
    const { region, district, ward } = req.query;
    if (!region) {
      return res.status(400).json({ error: 'region is required' });
    }
    const targetRegion = _normalise(region);
    const targetDistrict = district ? _normalise(district) : null;
    const targetWard = ward ? String(ward).trim().toLowerCase() : null;
    // Region + district live on Venue directly. We do the compare in
    // JS to tolerate the " Region" / " District" suffix variance
    // that shows up across the geo datasets and old profiles.
    const all = await Venue.find({ status: 'ACTIVE' })
      .select('name region district ward serikaliYaMtaa owners')
      .populate('owners', 'firstName lastName academy_name entity_name company_name football_field_name type')
      .sort({ name: 1 })
      .lean();
    const filtered = all.filter((v) => {
      if (_normalise(v.region) !== targetRegion) return false;
      if (targetDistrict && _normalise(v.district || '') !== targetDistrict) {
        return false;
      }
      if (targetWard && String(v.ward || '').trim().toLowerCase() !== targetWard) {
        return false;
      }
      return true;
    });
    return res.status(200).json({ data: filtered });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/venues/:id
router.get(`${BASE}/:id`, async (req, res) => {
  try {
    const venue = await Venue.findById(req.params.id)
      .populate('owners', 'firstName lastName academy_name entity_name company_name football_field_name accountNumber type');
    if (!venue) return res.status(404).json({ error: 'Venue not found' });
    return res.status(200).json({ data: venue });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/venues — uploadFor() converts any file[fieldname=photo]
// to a URL string on req.body.photo, so the CMS can send multipart
// (photo file) or JSON (photo URL string) interchangeably.
router.post(BASE, uploadFor(), async (req, res) => {
  try {
    const { name, region, district, ward, street, capacity, surfaceType, fieldSize, description, createdBy, photo } = req.body;
    if (!name || !region || !district) {
      return res.status(400).json({ error: 'name, region and district are required' });
    }
    const venue = await Venue.create({
      name, region, district, ward, street, capacity, surfaceType, fieldSize, description, createdBy, photo,
    });
    return res.status(201).json({ data: venue });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /v1/venues/:id — same uploadFor() shim: multipart photo
// upload lands on req.body.photo as the resolved URL.
router.patch(`${BASE}/:id`, uploadFor(), async (req, res) => {
  try {
    const venue = await Venue.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!venue) return res.status(404).json({ error: 'Venue not found' });
    return res.status(200).json({ data: venue });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /v1/venues/:id
router.delete(`${BASE}/:id`, async (req, res) => {
  try {
    const venue = await Venue.findByIdAndUpdate(req.params.id, { status: 'INACTIVE' }, { new: true });
    if (!venue) return res.status(404).json({ error: 'Venue not found' });
    return res.status(200).json({ data: venue });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────
// VENUE SUGGESTIONS — org-submitted names awaiting admin verification.
// Created from the Uwanja wa Nyumbani step when the typed name didn't
// match any curated Venue in the ward. Admin reviews the queue via
// the CMS; APPROVE promotes to a real Venue and rewires any org whose
// homeVenueSuggestion pointed here.
// ─────────────────────────────────────────────────────────────────────

// POST /v1/venue-suggestions  body:
//   { name, region, district, ward, suggestedBy,
//     ownerType, ownerRef, ownerName, notes }
router.post(SUGGEST_BASE, async (req, res) => {
  try {
    const {
      name, region, district, ward,
      suggestedBy, ownerType, ownerRef, ownerName, notes, fieldSize,
    } = req.body || {};
    if (!name || !region || !district || !suggestedBy) {
      return res.status(400).json({
        error: 'name, region, district and suggestedBy are required',
        errorKey: 'venue_suggest.err.missing',
      });
    }
    const validFieldSizes = [
      'FIVE_A_SIDE', 'SEVEN_A_SIDE', 'NINE_A_SIDE', 'ELEVEN_A_SIDE',
      'MULTI', 'FUTSAL', 'UNKNOWN',
    ];
    const doc = await VenueSuggestion.create({
      name: String(name).trim(),
      region: String(region).trim(),
      district: String(district).trim(),
      ward: ward ? String(ward).trim() : '',
      suggestedBy,
      ownerType: ['SELF', 'REF', 'MANUAL', 'UNKNOWN'].includes(ownerType)
        ? ownerType
        : 'UNKNOWN',
      ownerRef: ownerType === 'REF' && ownerRef ? ownerRef : null,
      ownerName: ownerType === 'MANUAL' ? (ownerName || '').trim() : '',
      notes: notes ? String(notes).trim() : '',
      fieldSize: validFieldSizes.includes(fieldSize) ? fieldSize : 'UNKNOWN',
    });
    // Auto-link the suggester's User.homeVenueSuggestion so their
    // Info Zaidi shows the pending state without an extra call.
    try {
      await User.updateOne(
        { _id: suggestedBy },
        { $set: { homeVenueSuggestion: doc._id, homeVenue: null } },
      );
    } catch (_) { /* best-effort */ }
    return res.status(201).json({ data: doc });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/venue-suggestions?status=PENDING (admin CMS list)
router.get(SUGGEST_BASE, requireAdminKey, async (req, res) => {
  try {
    const { status = 'PENDING', region, district, ward, limit = 200 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (region) filter.region = new RegExp(`^${region}$`, 'i');
    if (district) filter.district = new RegExp(`^${district}$`, 'i');
    if (ward) filter.ward = new RegExp(`^${ward}$`, 'i');
    const rows = await VenueSuggestion.find(filter)
      .populate('suggestedBy',
        'firstName lastName academy_name company_name entity_name type accountNumber')
      .populate('ownerRef',
        'firstName lastName academy_name company_name entity_name type football_field_name')
      .populate('approvedVenue', 'name region district ward')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit, 10) || 200)
      .lean();
    return res.status(200).json({ data: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/venue-suggestions/:id/approve  body:
//   { reviewerId, venue: { name, region, district, ward, street,
//     capacity, surfaceType, description, owners } }
// Admin can override any field before promoting. Creates the Venue,
// stamps approvedVenue on the suggestion, and rewires every org
// whose homeVenueSuggestion pointed here to homeVenue = <newVenueId>.
router.post(`${SUGGEST_BASE}/:id/approve`, requireAdminKey, async (req, res) => {
  try {
    const { reviewerId, venue = {} } = req.body || {};
    const s = await VenueSuggestion.findById(req.params.id);
    if (!s) return res.status(404).json({ error: 'Suggestion not found' });
    if (s.status !== 'PENDING') {
      return res.status(409).json({
        error: `Suggestion already ${s.status.toLowerCase()}.`,
      });
    }
    // Build the Venue payload with admin overrides winning where set.
    const payload = {
      name: (venue.name || s.name).trim(),
      region: (venue.region || s.region).trim(),
      district: (venue.district || s.district).trim(),
      ward: venue.ward || s.ward || '',
      street: venue.street || '',
      capacity: venue.capacity || 0,
      surfaceType: venue.surfaceType || 'NATURAL_GRASS',
      fieldSize: venue.fieldSize || s.fieldSize || 'UNKNOWN',
      description: venue.description || '',
      createdBy: reviewerId || null,
    };
    // Owner defaults: admin-supplied array wins; fall back to the
    // suggestion's ownerRef when it was a SELF or REF hint.
    if (Array.isArray(venue.owners) && venue.owners.length) {
      payload.owners = venue.owners.slice(0, 2);
    } else if (s.ownerType === 'SELF') {
      payload.owners = [s.suggestedBy];
    } else if (s.ownerType === 'REF' && s.ownerRef) {
      payload.owners = [s.ownerRef];
    }
    const created = await Venue.create(payload);
    s.status = 'APPROVED';
    s.reviewedBy = reviewerId || null;
    s.reviewedAt = new Date();
    s.approvedVenue = created._id;
    await s.save();
    // Rewire every org linked via homeVenueSuggestion to the fresh
    // homeVenue. Any org that suggested the same field independently
    // (via a duplicate suggestion) stays linked to their own
    // pending record until an admin resolves them.
    try {
      await User.updateMany(
        { homeVenueSuggestion: s._id },
        { $set: { homeVenue: created._id, homeVenueSuggestion: null } },
      );
    } catch (_) { /* best-effort */ }
    return res.status(200).json({
      data: { suggestion: s, venue: created },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/venue-suggestions/:id/reject  body: { reviewerId, reason }
router.post(`${SUGGEST_BASE}/:id/reject`, requireAdminKey, async (req, res) => {
  try {
    const { reviewerId, reason } = req.body || {};
    const s = await VenueSuggestion.findById(req.params.id);
    if (!s) return res.status(404).json({ error: 'Suggestion not found' });
    if (s.status !== 'PENDING') {
      return res.status(409).json({
        error: `Suggestion already ${s.status.toLowerCase()}.`,
      });
    }
    s.status = 'REJECTED';
    s.reviewedBy = reviewerId || null;
    s.reviewedAt = new Date();
    s.rejectionReason = (reason || '').toString().slice(0, 400);
    await s.save();
    // Clear the org's pending link so they can pick a curated Venue
    // or submit a fresh suggestion.
    try {
      await User.updateMany(
        { homeVenueSuggestion: s._id },
        { $set: { homeVenueSuggestion: null } },
      );
    } catch (_) { /* best-effort */ }
    return res.status(200).json({ data: s });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
