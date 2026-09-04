// Sponsorship endpoints — Wanufaika / Beneficiaries feature.
//
//   POST   /v1/sponsorships                       (multipart, ≤3 photos)
//   GET    /v1/sponsorships/sponsor/:id           list this sponsor's entries
//   GET    /v1/sponsorships/beneficiary/:id       list entries received by user
//   PATCH  /v1/sponsorships/:id                   edit (sponsor-only)
//   DELETE /v1/sponsorships/:id                   delete (sponsor-only)
//
//   POST   /v1/sponsorships/:id/comments          beneficiary comment/complain
//   GET    /v1/sponsorships/:id/comments          list comments on an entry
//
//   POST   /v1/sponsorship-requests               beneficiary → sponsor request
//   GET    /v1/sponsorship-requests/sponsor/:id   sponsor's pending requests
//   POST   /v1/sponsorship-requests/:id/accept    sponsor accepts
//   POST   /v1/sponsorship-requests/:id/decline   sponsor declines

const express = require('express');
const { uploadFor } = require('../Utils/uploader');
const User = require('../User/user.model');
const Sponsorship = require('./sponsorship.model');
const SponsorshipRequest = require('./sponsorship_request.model');
const SponsorshipComment = require('./sponsorship_comment.model');
const Notification = require('../Notification/notification.model');

const router = express.Router();
const BASE = '/v1';

// Helper — safely parse a date from body; returns null if missing/invalid.
function parseDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

// Helper — collect any uploaded photo URLs from req.body. uploader.js
// writes each file's URL onto req.body[file.fieldname], so photos come
// in as body.photo1 / photo2 / photo3 (or "photo" if only one).
function collectPhotos(body) {
  const out = [];
  ['photo', 'photo1', 'photo2', 'photo3'].forEach((k) => {
    if (body[k] && typeof body[k] === 'string') out.push(body[k]);
  });
  return out.slice(0, 3);
}

// ── Sponsorship (main entries) ─────────────────────────────────────────

router.post(`${BASE}/sponsorships`, uploadFor(), async (req, res) => {
  try {
    const b = req.body || {};
    const sponsor = b.sponsor;
    const beneficiary = b.beneficiary;
    const title = String(b.title || '').trim();
    const description = String(b.description || '').trim();
    const supportKind = b.supportKind;
    if (!sponsor || !beneficiary || !title || !description || !supportKind) {
      return res.status(400).json({
        error: 'sponsor, beneficiary, title, description, supportKind required',
      });
    }
    if (!Sponsorship.SUPPORT_KINDS.includes(supportKind)) {
      return res.status(400).json({ error: 'invalid supportKind' });
    }
    const doc = await Sponsorship.create({
      sponsor,
      beneficiary,
      title,
      description,
      supportKind,
      supportDate:  supportKind === 'ONE_TIME_DATE' ? parseDate(b.supportDate)  : null,
      supportStart: supportKind === 'DATE_RANGE'    ? parseDate(b.supportStart) : null,
      supportEnd:   supportKind === 'DATE_RANGE'    ? parseDate(b.supportEnd)   : null,
      photos: collectPhotos(b),
    });

    // Best-effort notification to the beneficiary.
    try {
      const s = await User.findById(sponsor).select('firstName lastName entity_name isAnonymous').lean();
      const sponsorName = s?.isAnonymous
        ? 'Mdhamini'
        : (s?.entity_name?.trim() || `${s?.firstName || ''} ${s?.lastName || ''}`.trim() || 'Mdhamini');
      await Notification.create({
        userId: beneficiary,
        title: 'Umepokea mchango',
        body: `${sponsorName} ameongeza mchango kwako: "${title}".`,
        titleKey: 'notif.sponsor.created.title',
        bodyKey: 'notif.sponsor.created.body',
        params: { sponsor: sponsorName, title },
        type: 'SYSTEM',
        metadata: {
          kind: 'SPONSORSHIP_CREATED',
          sponsorshipId: doc._id.toString(),
          sponsorId: sponsor.toString(),
        },
      });
    } catch (_) {}

    return res.status(201).json({ data: doc });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get(`${BASE}/sponsorships/sponsor/:id`, async (req, res) => {
  try {
    const rows = await Sponsorship.find({ sponsor: req.params.id })
      .populate('beneficiary', 'firstName lastName academy_name entity_name company_name profileImage accountNumber type')
      .sort({ createdAt: -1 })
      .lean();
    return res.json({ data: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get(`${BASE}/sponsorships/beneficiary/:id`, async (req, res) => {
  try {
    const rows = await Sponsorship.find({ beneficiary: req.params.id })
      .populate('sponsor', 'firstName lastName entity_name sponsor_type isAnonymous profileImage accountNumber type')
      .sort({ createdAt: -1 })
      .lean();
    // Respect entity-sponsor anonymity toggle.
    for (const r of rows) {
      if (r.sponsor && r.sponsor.isAnonymous) {
        r.sponsor = {
          _id: r.sponsor._id,
          firstName: 'Anonymous',
          lastName: '',
          entity_name: 'Anonymous',
          profileImage: null,
          accountNumber: null,
          type: 'SPONSOR',
          isAnonymous: true,
        };
      }
    }
    return res.json({ data: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.patch(`${BASE}/sponsorships/:id`, uploadFor(), async (req, res) => {
  try {
    const b = req.body || {};
    const doc = await Sponsorship.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'sponsorship not found' });
    // Ownership check — sponsor-only edits.
    if (b.editor && String(doc.sponsor) !== String(b.editor)) {
      return res.status(403).json({ error: 'Wewe si mdhamini wa mchango huu.' });
    }
    if (b.title) doc.title = String(b.title).trim();
    if (b.description) doc.description = String(b.description).trim();
    if (b.supportKind && Sponsorship.SUPPORT_KINDS.includes(b.supportKind)) {
      doc.supportKind = b.supportKind;
      doc.supportDate  = b.supportKind === 'ONE_TIME_DATE' ? parseDate(b.supportDate)  : null;
      doc.supportStart = b.supportKind === 'DATE_RANGE'    ? parseDate(b.supportStart) : null;
      doc.supportEnd   = b.supportKind === 'DATE_RANGE'    ? parseDate(b.supportEnd)   : null;
    }
    const newPhotos = collectPhotos(b);
    if (newPhotos.length) {
      // Append + cap at 3. Client sends any additional photos with the
      // same photo1/2/3 field naming.
      doc.photos = [...doc.photos, ...newPhotos].slice(0, 3);
    }
    if (b.clearPhotos === 'true' || b.clearPhotos === true) doc.photos = [];
    await doc.save();
    return res.json({ data: doc });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete(`${BASE}/sponsorships/:id`, async (req, res) => {
  try {
    const doc = await Sponsorship.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'sponsorship not found' });
    const editor = req.query.editor || req.body?.editor;
    if (editor && String(doc.sponsor) !== String(editor)) {
      return res.status(403).json({ error: 'Wewe si mdhamini wa mchango huu.' });
    }
    // Cascade: comments on this entry lose their anchor; delete them too.
    await SponsorshipComment.deleteMany({ sponsorship: doc._id });
    await doc.deleteOne();
    return res.json({ data: { deleted: true } });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Comments ───────────────────────────────────────────────────────────

router.post(`${BASE}/sponsorships/:id/comments`, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.author || !b.text) {
      return res.status(400).json({ error: 'author + text required' });
    }
    const s = await Sponsorship.findById(req.params.id);
    if (!s) return res.status(404).json({ error: 'sponsorship not found' });
    const kind = SponsorshipComment.COMMENT_KINDS.includes(b.kind) ? b.kind : 'COMMENT';
    const doc = await SponsorshipComment.create({
      sponsorship: s._id,
      author: b.author,
      kind,
      text: String(b.text).trim(),
    });

    // Notify sponsor.
    try {
      const author = await User.findById(b.author)
        .select('firstName lastName academy_name entity_name company_name').lean();
      const name = author?.academy_name || author?.entity_name || author?.company_name
        || `${author?.firstName || ''} ${author?.lastName || ''}`.trim() || 'Mnufaika';
      await Notification.create({
        userId: s.sponsor,
        title: kind === 'COMPLAINT' ? 'Malalamiko mapya' : 'Maoni mapya',
        body: `${name}: ${String(b.text).trim().slice(0, 140)}`,
        titleKey: kind === 'COMPLAINT'
          ? 'notif.sponsor.comment.complaint_title'
          : 'notif.sponsor.comment.comment_title',
        bodyKey: 'notif.sponsor.comment.body',
        params: { author: name, snippet: String(b.text).trim().slice(0, 140) },
        type: 'SYSTEM',
        metadata: {
          kind: 'SPONSORSHIP_COMMENT',
          commentKind: kind,
          sponsorshipId: s._id.toString(),
          commentId: doc._id.toString(),
        },
      });
    } catch (_) {}

    return res.status(201).json({ data: doc });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get(`${BASE}/sponsorships/:id/comments`, async (req, res) => {
  try {
    const rows = await SponsorshipComment.find({ sponsorship: req.params.id })
      .populate('author', 'firstName lastName academy_name profileImage accountNumber type')
      .sort({ createdAt: 1 })
      .lean();
    return res.json({ data: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Requests ───────────────────────────────────────────────────────────

router.post(`${BASE}/sponsorship-requests`, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.sponsor || !b.requester || !b.beneficiary) {
      return res.status(400).json({
        error: 'sponsor + requester + beneficiary required',
      });
    }
    const doc = await SponsorshipRequest.create({
      sponsor: b.sponsor,
      requester: b.requester,
      beneficiary: b.beneficiary,
      message: String(b.message || '').trim(),
    });
    // Notify sponsor.
    try {
      const [requester, benef] = await Promise.all([
        User.findById(b.requester).select('firstName lastName academy_name entity_name').lean(),
        User.findById(b.beneficiary).select('firstName lastName academy_name entity_name').lean(),
      ]);
      const requesterName = requester?.academy_name || requester?.entity_name
        || `${requester?.firstName || ''} ${requester?.lastName || ''}`.trim() || 'Mtumiaji';
      const benefName = benef?.academy_name || benef?.entity_name
        || `${benef?.firstName || ''} ${benef?.lastName || ''}`.trim() || 'mtu';
      await Notification.create({
        userId: b.sponsor,
        title: 'Ombi la udhamini',
        body: `${requesterName} ameomba udhamini kwa ${benefName}.`,
        titleKey: 'notif.sponsor.request.title',
        bodyKey: 'notif.sponsor.request.body',
        params: { requester: requesterName, beneficiary: benefName },
        type: 'SYSTEM',
        metadata: {
          kind: 'SPONSORSHIP_REQUEST',
          requestId: doc._id.toString(),
          requesterId: b.requester.toString(),
          beneficiaryId: b.beneficiary.toString(),
        },
      });
    } catch (_) {}
    return res.status(201).json({ data: doc });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        error: 'Tayari kuna ombi lililopo linalosubiri jibu.',
        reason: 'REQUEST_PENDING',
      });
    }
    return res.status(500).json({ error: err.message });
  }
});

router.get(`${BASE}/sponsorship-requests/sponsor/:id`, async (req, res) => {
  try {
    const rows = await SponsorshipRequest.find({
      sponsor: req.params.id,
      status: 'PENDING',
    })
      .populate('requester', 'firstName lastName academy_name entity_name profileImage accountNumber type')
      .populate('beneficiary', 'firstName lastName academy_name entity_name profileImage accountNumber type')
      .sort({ createdAt: -1 })
      .lean();
    return res.json({ data: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

async function respondToRequest(res, requestId, sponsor, status, note) {
  const doc = await SponsorshipRequest.findById(requestId);
  if (!doc) return res.status(404).json({ error: 'request not found' });
  if (String(doc.sponsor) !== String(sponsor)) {
    return res.status(403).json({ error: 'Wewe si mdhamini wa ombi hili.' });
  }
  doc.status = status;
  doc.respondedAt = new Date();
  doc.responseNote = String(note || '').trim();
  await doc.save();
  // Notify requester.
  try {
    await Notification.create({
      userId: doc.requester,
      title: status === 'ACCEPTED' ? 'Ombi lako limekubaliwa' : 'Ombi lako limekataliwa',
      body: status === 'ACCEPTED'
        ? 'Mdhamini amekubali ombi lako. Watawasiliana nawe hivi karibuni.'
        : 'Mdhamini amekataa ombi lako.',
      titleKey: status === 'ACCEPTED'
        ? 'notif.sponsor.request.accepted_title'
        : 'notif.sponsor.request.declined_title',
      bodyKey: status === 'ACCEPTED'
        ? 'notif.sponsor.request.accepted_body'
        : 'notif.sponsor.request.declined_body',
      params: {},
      type: 'SYSTEM',
      metadata: {
        kind: 'SPONSORSHIP_REQUEST_RESULT',
        requestId: doc._id.toString(),
        status,
      },
    });
  } catch (_) {}
  return res.json({ data: doc });
}

router.post(`${BASE}/sponsorship-requests/:id/accept`, async (req, res) => {
  try {
    const sponsor = req.body?.sponsor;
    if (!sponsor) return res.status(400).json({ error: 'sponsor required' });
    return respondToRequest(res, req.params.id, sponsor, 'ACCEPTED', req.body?.note);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post(`${BASE}/sponsorship-requests/:id/decline`, async (req, res) => {
  try {
    const sponsor = req.body?.sponsor;
    if (!sponsor) return res.status(400).json({ error: 'sponsor required' });
    return respondToRequest(res, req.params.id, sponsor, 'DECLINED', req.body?.note);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
