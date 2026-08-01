const express = require('express');
const { getString } = require('@lykmapipo/env');
const Report = require('./report.model');

const API_VERSION = getString('API_VERSION', '1.0.0');
const router = express.Router();
const BASE = `/v${API_VERSION.split('.')[0]}/reports`;

const REASONS = new Set([
  'SPAM',
  'HARASSMENT',
  'HATEFUL',
  'INAPPROPRIATE',
  'IMPERSONATION',
  'VIOLENCE',
  'OTHER',
]);
const ENTITY_TYPES = new Set([
  'USER',
  'POST',
  'COMMENT',
  'CHAT_MESSAGE',
  'ADVISORY',
]);
const STATUSES = new Set(['OPEN', 'REVIEWED', 'ACTIONED', 'DISMISSED']);

// POST /v1/reports — anyone can file
router.post(BASE, async (req, res) => {
  try {
    const { reporter, reported, entityType, entityId, reason, note } = req.body;
    if (!reporter || !reported || !reason) {
      return res
        .status(400)
        .json({ error: 'reporter, reported, and reason are required' });
    }
    if (!REASONS.has(reason)) {
      return res.status(400).json({ error: 'invalid reason' });
    }
    if (String(reporter) === String(reported)) {
      return res.status(400).json({ error: 'Cannot report yourself' });
    }
    const doc = await Report.create({
      reporter,
      reported,
      entityType: ENTITY_TYPES.has(entityType) ? entityType : 'USER',
      entityId: entityId || '',
      reason,
      note: (note || '').toString().slice(0, 500),
    });
    return res.status(201).json({ data: doc });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/reports?status=&reported=&reporter=&limit=
router.get(BASE, async (req, res) => {
  try {
    const {
      status, reported, reporter, limit = 100, page = 1,
    } = req.query;
    const filter = {};
    if (status && STATUSES.has(status)) filter.status = status;
    if (reported) filter.reported = reported;
    if (reporter) filter.reporter = reporter;
    const parsedLimit = Math.min(parseInt(limit, 10) || 100, 200);
    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const [data, total] = await Promise.all([
      Report.find(filter)
        .populate('reporter', 'firstName lastName accountNumber type profileImage')
        .populate('reported', 'firstName lastName accountNumber type profileImage')
        .populate('reviewedBy', 'firstName lastName')
        .sort({ createdAt: -1 })
        .skip((parsedPage - 1) * parsedLimit)
        .limit(parsedLimit)
        .lean(),
      Report.countDocuments(filter),
    ]);
    return res.status(200).json({ data, total, page: parsedPage });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/reports/:id/status — moderator changes status
// Body: { status, reviewedBy, adminNote? }
router.post(`${BASE}/:id/status`, async (req, res) => {
  try {
    const { status, reviewedBy, adminNote } = req.body;
    if (!STATUSES.has(status)) {
      return res.status(400).json({ error: 'invalid status' });
    }
    if (!reviewedBy) {
      return res.status(400).json({ error: 'reviewedBy required' });
    }
    const doc = await Report.findByIdAndUpdate(
      req.params.id,
      {
        status,
        reviewedBy,
        reviewedAt: new Date(),
        adminNote: adminNote || '',
      },
      { new: true }
    );
    if (!doc) return res.status(404).json({ error: 'Report not found' });
    return res.status(200).json({ data: doc });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
