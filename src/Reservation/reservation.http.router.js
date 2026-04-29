const express = require('express');
const { getString } = require('@lykmapipo/env');
const Reservation = require('./reservation.model');
const Venue = require('../Venue/venue.model');
const { sendSms } = require('../Utils/utils');

const API_VERSION = getString('API_VERSION', '1.0.0');
const router = express.Router();
const BASE = `/v${API_VERSION.split('.')[0]}/reservations`;

// GET /v1/reservations
router.get(BASE, async (req, res) => {
  try {
    const { venue, match, status, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (venue) filter.venue = venue;
    if (match) filter.match = match;
    if (status) filter.status = status;

    const reservations = await Reservation.find(filter)
      .populate('venue', 'name region district owners')
      .populate('match', 'homeTeam awayTeam scheduledDate')
      .populate('requestedBy', 'firstName lastName type accountNumber')
      .populate('confirmedBy', 'firstName lastName')
      .sort({ date: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Reservation.countDocuments(filter);
    return res.status(200).json({ data: reservations, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/reservations — create reservation and notify field owners
router.post(BASE, async (req, res) => {
  try {
    const { venue, match, requestedBy, date, startTime, endTime, notes } = req.body;
    if (!venue || !match || !requestedBy || !date || !startTime) {
      return res.status(400).json({ error: 'venue, match, requestedBy, date and startTime are required' });
    }

    const reservation = await Reservation.create({ venue, match, requestedBy, date, startTime, endTime, notes });

    // Notify field owners via SMS
    const venueData = await Venue.findById(venue).populate('owners', 'phone firstName lastName');
    if (venueData && venueData.owners && venueData.owners.length > 0) {
      for (const owner of venueData.owners) {
        if (owner.phone) {
          const phone = owner.phone.replace(owner.phone.charAt(0), '255');
          const msg = `Habari ${owner.firstName}, kuna ombi la uwanja wa ${venueData.name} tarehe ${new Date(date).toLocaleDateString()} saa ${startTime}. Ingia SokaSoko kuthibitisha.`;
          try { sendSms(msg, phone); } catch (e) { console.log('SMS failed:', e.message); }
        }
      }
    }

    return res.status(201).json({ data: reservation });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/reservations/:id/confirm — field owner confirms
router.post(`${BASE}/:id/confirm`, async (req, res) => {
  try {
    const { confirmedBy } = req.body;
    const reservation = await Reservation.findById(req.params.id).populate('venue');
    if (!reservation) return res.status(404).json({ error: 'Reservation not found' });

    // Verify confirmedBy is an owner of the venue
    const isOwner = reservation.venue.owners.some(o => o.toString() === confirmedBy);
    if (!isOwner) return res.status(403).json({ error: 'Only field owners can confirm reservations' });

    reservation.status = 'CONFIRMED';
    reservation.confirmedBy = confirmedBy;
    reservation.confirmedAt = new Date();
    await reservation.save();

    return res.status(200).json({ data: reservation });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/reservations/:id/reject — field owner rejects
router.post(`${BASE}/:id/reject`, async (req, res) => {
  try {
    const { rejectedBy, rejectionReason } = req.body;
    const reservation = await Reservation.findById(req.params.id).populate('venue');
    if (!reservation) return res.status(404).json({ error: 'Reservation not found' });

    const isOwner = reservation.venue.owners.some(o => o.toString() === rejectedBy);
    if (!isOwner) return res.status(403).json({ error: 'Only field owners can reject reservations' });

    reservation.status = 'REJECTED';
    reservation.rejectedBy = rejectedBy;
    reservation.rejectionReason = rejectionReason;
    await reservation.save();

    return res.status(200).json({ data: reservation });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
