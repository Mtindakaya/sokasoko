const express = require('express');
const { getString } = require('@lykmapipo/env');
const _ = require('lodash');
const Venue = require('./venue.model');

const API_VERSION = getString('API_VERSION', '1.0.0');
const router = express.Router();
const BASE = `/v${API_VERSION.split('.')[0]}/venues`;

// GET /v1/venues
router.get(BASE, async (req, res) => {
  try {
    const { page = 1, limit = 20, region, status } = req.query;
    const filter = {};
    if (region) filter.region = region;
    if (status) filter.status = status;
    else filter.status = 'ACTIVE';

    const venues = await Venue.find(filter)
      .sort({ name: 1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Venue.countDocuments(filter);

    return res.status(200).json({ data: venues, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/venues/:id
router.get(`${BASE}/:id`, async (req, res) => {
  try {
    const venue = await Venue.findById(req.params.id);
    if (!venue) return res.status(404).json({ error: 'Venue not found' });
    return res.status(200).json({ data: venue });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/venues
router.post(BASE, async (req, res) => {
  try {
    const { name, region, district, ward, street, capacity, surfaceType, description, createdBy } = req.body;
    if (!name || !region || !district) {
      return res.status(400).json({ error: 'name, region and district are required' });
    }
    const venue = await Venue.create({ name, region, district, ward, street, capacity, surfaceType, description, createdBy });
    return res.status(201).json({ data: venue });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /v1/venues/:id
router.patch(`${BASE}/:id`, async (req, res) => {
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

module.exports = router;
