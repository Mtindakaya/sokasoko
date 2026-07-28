const express = require('express');
const { getString } = require('@lykmapipo/env');
const AdvisoryEntry = require('./advisory_entry.model');

const API_VERSION = getString('API_VERSION', '1.0.0');
const router = express.Router();
const BASE = `/v${API_VERSION.split('.')[0]}/advisories`;

const TOPICS = new Set([
  'TACTICS', 'TRAINING', 'POSITION', 'RULES', 'REFEREEING',
  'SCOUTING', 'NUTRITION', 'MENTAL', 'HISTORY', 'OTHER',
]);
const LANGUAGES = new Set(['sw', 'en', 'mixed']);
const STATUSES = new Set(['PENDING', 'APPROVED', 'REJECTED', 'ARCHIVED']);

// POST /v1/advisories — contributor submits a new advisory.
// contributor is required for in-app submissions (sourceChannel='APP') but
// optional for external channels; external channels provide
// contributorName / contributorContact freeform instead.
router.post(BASE, async (req, res) => {
  try {
    const {
      title, body, topic, position, ageGroup, language, tags,
      contributor, sourceChannel, priority, rawAssetUrl,
      contributorName, contributorContact, status,
    } = req.body;
    if (!title || !body) {
      return res.status(400).json({ error: 'title and body are required' });
    }
    const channel = ['APP', 'WHATSAPP', 'WEB', 'EMAIL', 'AUDIO', 'CHAT_RECYCLE']
      .includes(sourceChannel) ? sourceChannel : 'APP';
    if (channel === 'APP' && !contributor) {
      return res.status(400).json({ error: 'contributor is required for APP submissions' });
    }
    const doc = await AdvisoryEntry.create({
      title,
      body,
      topic: TOPICS.has(topic) ? topic : 'OTHER',
      position: position || '',
      ageGroup: ageGroup || '',
      language: LANGUAGES.has(language) ? language : 'sw',
      tags: Array.isArray(tags) ? tags : [],
      contributor: contributor || null,
      sourceChannel: channel,
      priority: typeof priority === 'number' ? priority : null,
      rawAssetUrl: rawAssetUrl || '',
      contributorName: contributorName || '',
      contributorContact: contributorContact || '',
      source: channel === 'CHAT_RECYCLE' ? 'CHAT_RECYCLE' : 'CONTRIBUTOR',
      // External channels default to RAW so triage happens before review.
      status: ['RAW', 'PENDING'].includes(status)
        ? status
        : (channel === 'APP' ? 'PENDING' : 'RAW'),
    });
    return res.status(201).json({ data: doc });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/advisories — list; supports status / topic / language / contributor filters.
router.get(BASE, async (req, res) => {
  try {
    const { status, topic, language, contributor, limit = 50, page = 1 } = req.query;
    const filter = {};
    if (status && STATUSES.has(status)) filter.status = status;
    if (topic && TOPICS.has(topic)) filter.topic = topic;
    if (language && LANGUAGES.has(language)) filter.language = language;
    if (contributor) filter.contributor = contributor;

    const parsedLimit = Math.min(parseInt(limit, 10) || 50, 200);
    const parsedPage = Math.max(1, parseInt(page, 10) || 1);

    const [data, total] = await Promise.all([
      AdvisoryEntry.find(filter)
        .populate('contributor', 'firstName lastName accountNumber type profileImage')
        .populate('reviewedBy', 'firstName lastName')
        .sort({ createdAt: -1 })
        .skip((parsedPage - 1) * parsedLimit)
        .limit(parsedLimit)
        .lean(),
      AdvisoryEntry.countDocuments(filter),
    ]);
    return res.status(200).json({
      data,
      total,
      page: parsedPage,
      pages: Math.ceil(total / parsedLimit),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/advisories/stats/:userId — contributor stats.
// Placed before /:id so the literal 'stats' does not get parsed as an ObjectId.
router.get(`${BASE}/stats/:userId`, async (req, res) => {
  try {
    const { userId } = req.params;
    const counts = await AdvisoryEntry.aggregate([
      { $match: { contributor: new (require('mongoose').Types.ObjectId)(userId) } },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]);
    const stats = { approved: 0, pending: 0, rejected: 0, archived: 0 };
    for (const c of counts) {
      const k = String(c._id || '').toLowerCase();
      if (stats[k] !== undefined) stats[k] = c.n;
    }
    return res.status(200).json({ data: stats });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/advisories/:id
router.get(`${BASE}/:id`, async (req, res) => {
  try {
    const doc = await AdvisoryEntry.findById(req.params.id)
      .populate('contributor', 'firstName lastName accountNumber type profileImage')
      .populate('reviewedBy', 'firstName lastName')
      .lean();
    if (!doc) return res.status(404).json({ error: 'Advisory not found' });
    return res.status(200).json({ data: doc });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /v1/advisories/:id — contributor edits while PENDING.
router.patch(`${BASE}/:id`, async (req, res) => {
  try {
    const doc = await AdvisoryEntry.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Advisory not found' });
    if (doc.status !== 'PENDING') {
      return res.status(400).json({ error: 'Only PENDING advisories can be edited' });
    }
    const editable = ['title', 'body', 'topic', 'position', 'ageGroup', 'language', 'tags'];
    for (const key of editable) {
      if (req.body[key] !== undefined) doc[key] = req.body[key];
    }
    if (!TOPICS.has(doc.topic)) doc.topic = 'OTHER';
    if (!LANGUAGES.has(doc.language)) doc.language = 'sw';
    await doc.save();
    return res.status(200).json({ data: doc });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/advisories/:id/review — moderator triages / approves / rejects.
// Triaging a RAW entry to PENDING is a valid transition (typically done
// after transcribing a WhatsApp voice note into title + body).
router.post(`${BASE}/:id/review`, async (req, res) => {
  try {
    const { status, reviewedBy, reviewerNote } = req.body;
    if (!['PENDING', 'APPROVED', 'REJECTED', 'ARCHIVED'].includes(status)) {
      return res.status(400).json({ error: 'status must be PENDING, APPROVED, REJECTED, or ARCHIVED' });
    }
    if (!reviewedBy) {
      return res.status(400).json({ error: 'reviewedBy is required' });
    }
    const doc = await AdvisoryEntry.findByIdAndUpdate(
      req.params.id,
      {
        status,
        reviewedBy,
        reviewedAt: new Date(),
        reviewerNote: reviewerNote || '',
      },
      { new: true }
    );
    if (!doc) return res.status(404).json({ error: 'Advisory not found' });
    return res.status(200).json({ data: doc });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
