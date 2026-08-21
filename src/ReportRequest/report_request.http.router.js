const express = require('express');
const path = require('path');
const fs = require('fs');
const { getString } = require('@lykmapipo/env');
const User = require('../User/user.model');
const ReportRequest = require('./report_request.model');
const { Subscription, FEATURE_CAPS } = require('../Subscription/subscription.model');
const { SubscriptionUsage } = require('../Subscription/subscription_usage.model');
const OneTimePurchase = require('../OneTimePurchase/one_time_purchase.model');
const Notification = require('../Notification/notification.model');

// npm install pdfkit
const PDFDocument = require('pdfkit');

const API_VERSION = getString('API_VERSION', '1.0.0');
const router = express.Router();
const BASE = `/v${API_VERSION.split('.')[0]}/report-requests`;

function calcAge(dob) {
  const now = new Date();
  const birth = new Date(dob);
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age -= 1;
  return age;
}

// POST /v1/report-requests
router.post(BASE, async (req, res) => {
  try {
    const { requestedBy, reportType, filters, dateFrom, dateTo, notes } = req.body;

    if (!requestedBy || !reportType) {
      return res.status(400).json({ error: 'requestedBy and reportType are required' });
    }

    const user = await User.findById(requestedBy);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    let isSelfReport = false;
    let price = 3000;

    if (user.dob) {
      const age = calcAge(user.dob);
      if (age < 18) {
        isSelfReport = true;
        price = 0;
      }
    }

    if (!isSelfReport) {
      // Scouts and agents with any active subscription get Level 1 reports free
      if (user.type === 'SCOUT' || user.type === 'AGENT') {
        const activeSub = await Subscription.getActiveSubscription(requestedBy);
        if (activeSub) price = 0;
      }
    }

    // COACH / ACADEMY tier gating (same rules for both).
    // Standard  : cannot generate any reports on subscription — one-time
    //             purchase available for Standard COACH/ACADEMY/CLUB/AGENT.
    // Gold      : PLAYER reports only (10/month cap on generation).
    // Platinum  : PLAYER + TEAM + MARKET reports, unlimited.
    let viaPurchase = false;
    let purchaseId = null;
    if (['COACH', 'ACADEMY', 'CLUB', 'AGENT'].includes(user.type) && !isSelfReport) {
      const utype = user.type;
      const tier = await Subscription.getEffectiveTier(requestedBy, utype);
      const caps = FEATURE_CAPS[utype]?.[tier] || {};
      const typeKey = {
        PLAYER: 'canGeneratePlayerReport',
        TEAM:   'canGenerateTeamReport',
        MARKET: 'canGenerateMarketReport',
        CUSTOM: 'canGenerateCustomAnalysis',
      }[reportType];
      // ACADEMY / CLUB caps intentionally don't define canGenerate* keys —
      // they reuse the same {PLAYER on Gold, PLAYER+TEAM+MARKET on Platinum}
      // policy via a shared inference below. AGENT does define them
      // explicitly so the first branch handles it directly.
      let allowed = false;
      if (typeKey && caps[typeKey] === true) {
        allowed = true;
      } else if (utype === 'ACADEMY' || utype === 'CLUB') {
        if (reportType === 'PLAYER') {
          allowed = (caps.reportsGeneratedPerMonth == null || caps.reportsGeneratedPerMonth > 0);
        } else if (reportType === 'TEAM' || reportType === 'MARKET') {
          allowed = tier === 'PLATINUM';
        }
      }
      // Map reportType → one-time actionType for the soft-paywall path.
      const oneTimeActionType = {
        PLAYER: 'REPORT_PLAYER', TEAM: 'REPORT_TEAM',
        MARKET: 'REPORT_MARKET', CUSTOM: 'REPORT_CUSTOM',
      }[reportType];
      if (!allowed && oneTimeActionType) {
        // A PAID unconsumed purchase covers this report type.
        const purchase = await OneTimePurchase.findConsumable(
          requestedBy, oneTimeActionType);
        if (purchase) {
          viaPurchase = true;
          purchaseId = purchase._id;
          allowed = true;
        }
      }
      if (!allowed) {
        const eligibleTypes = oneTimeActionType
          ? (OneTimePurchase.ELIGIBLE_TYPES[oneTimeActionType] || [])
          : [];
        const canOfferOneTime = !!oneTimeActionType
          && tier === 'STANDARD'
          && eligibleTypes.includes(utype);
        const priceAmount = canOfferOneTime
          ? OneTimePurchase.PRICES[oneTimeActionType]?.TZS : null;
        const httpStatus = canOfferOneTime ? 402 : 403;
        const suffix = canOfferOneTime
          ? ' Chagua kuboresha kifurushi au kulipa TSh '
            + priceAmount.toLocaleString('en-US') + ' kwa mara moja.'
          : ' Boresha kifurushi.';
        return res.status(httpStatus).json({
          error: `Kifurushi chako cha ${tier} hakiruhusu ripoti ya ${reportType}.${suffix}`,
          reason: `${utype}_REPORT_TYPE_BLOCKED`,
          tier,
          userType: utype,
          canOfferOneTime,
          oneTimePrice: canOfferOneTime
            ? { amount: priceAmount, currency: 'TZS', actionType: oneTimeActionType }
            : null,
        });
      }
      if (!viaPurchase) {
        // Meter monthly generation against the tier's cap. One-time
        // purchases bypass the monthly cap — they're per-action.
        const check = await SubscriptionUsage.consume({
          user: requestedBy, userType: utype, feature: 'reportsGenerated',
        });
        if (!check.allowed) {
          return res.status(429).json({
            error: `Umefikia kikomo cha ${check.cap} ripoti kwa mwezi. Boresha hadi Platinum kwa matumizi bila kikomo.`,
            reason: check.reason,
            cap: check.cap,
            tier: check.tier,
          });
        }
      }
      price = 0; // subscribed / one-time callers don't pay per-report on top.
    }

    const reportRequest = await ReportRequest.create({
      requestedBy,
      reportType,
      filters: filters || {},
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
      notes,
      isSelfReport,
      price,
    });

    // Consume the one-time purchase now that the report request exists.
    if (viaPurchase && purchaseId) {
      try {
        await OneTimePurchase.consume(purchaseId, reportRequest._id);
      } catch (e) {
        console.log('[report-request] failed to consume purchase',
          purchaseId, e.message);
      }
    }

    // Confirmation notification (guardian fan-out picks this up when the
    // requester is a minor).
    try {
      await Notification.create({
        userId: requestedBy,
        type: 'SYSTEM',
        title: 'Ombi la Ripoti',
        body:
          `Ombi lako la ripoti ya ${reportType} limepokelewa. Utapata taarifa mara ripoti itakapokuwa tayari.`,
        titleKey: 'notif.report_request.title',
        bodyKey: 'notif.report_request.body',
        params: { reportType },
        metadata: { reportRequestId: reportRequest._id, reportType },
      });
    } catch (notifyErr) {
      console.log('[report-request] notification error:', notifyErr.message);
    }

    return res.status(201).json({ data: reportRequest });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/report-requests
router.get(BASE, async (req, res) => {
  try {
    const { requestedBy, status } = req.query;
    const filter = {};
    if (requestedBy) filter.requestedBy = requestedBy;
    if (status) filter.status = status;

    const requests = await ReportRequest.find(filter)
      .populate('requestedBy', 'firstName lastName accountNumber type')
      .sort({ createdAt: -1 });

    return res.status(200).json({ data: requests });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/report-requests/my/:userId
router.get(`${BASE}/my/:userId`, async (req, res) => {
  try {
    const { userId } = req.params;
    const requests = await ReportRequest.find({ requestedBy: userId }).sort({ createdAt: -1 });
    return res.status(200).json({ data: requests });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/report-requests/:id
router.get(`${BASE}/:id`, async (req, res) => {
  try {
    const reportRequest = await ReportRequest.findById(req.params.id)
      .populate('requestedBy', 'firstName lastName accountNumber type')
      .populate('generatedBy', 'firstName lastName');

    if (!reportRequest) {
      return res.status(404).json({ error: 'Report request not found' });
    }

    return res.status(200).json({ data: reportRequest });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/report-requests/:id/mark-paid
router.post(`${BASE}/:id/mark-paid`, async (req, res) => {
  try {
    const { paymentRef } = req.body;
    const reportRequest = await ReportRequest.findById(req.params.id);

    if (!reportRequest) {
      return res.status(404).json({ error: 'Report request not found' });
    }

    reportRequest.status = 'PAID';
    if (paymentRef) reportRequest.paymentRef = paymentRef;
    await reportRequest.save();

    return res.status(200).json({ data: reportRequest });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/report-requests/:id/generate
router.post(`${BASE}/:id/generate`, async (req, res) => {
  try {
    const { adminUserId } = req.body;
    const reportRequest = await ReportRequest.findById(req.params.id);

    if (!reportRequest) {
      return res.status(404).json({ error: 'Report request not found' });
    }

    reportRequest.status = 'GENERATING';
    await reportRequest.save();

    const { reportType, filters, isSelfReport, requestedBy } = reportRequest;

    let profiles = [];

    if (isSelfReport) {
      const self = await User.findById(requestedBy).lean();
      if (self) profiles = [self];
    } else if (reportType !== 'VENUE') {
      const query = { type: reportType };

      if (filters.region) query.region = filters.region;
      if (filters.district) query.district = filters.district;
      if (filters.gender) query.gender = filters.gender;
      if (filters.position) query.position = filters.position;
      if (filters.nationality) query.nationality = filters.nationality;

      // Age filters: minAge means dob must be <= minAge years ago (born earlier)
      if (filters.minAge || filters.maxAge) {
        query.dob = {};
        if (filters.minAge) {
          const minDate = new Date();
          minDate.setFullYear(minDate.getFullYear() - parseInt(filters.minAge, 10));
          query.dob.$lte = minDate;
        }
        if (filters.maxAge) {
          const maxDate = new Date();
          maxDate.setFullYear(maxDate.getFullYear() - parseInt(filters.maxAge, 10));
          query.dob.$gte = maxDate;
        }
      }

      profiles = await User.find(query).lean();
    }

    const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const fileName = `report_${reportRequest._id}_${Date.now()}.pdf`;
    const filePath = path.join(uploadsDir, fileName);
    const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

    await new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 });
      const writeStream = fs.createWriteStream(filePath);
      doc.pipe(writeStream);

      // Header
      doc
        .fontSize(22)
        .font('Helvetica-Bold')
        .text(`SokaSoko ${reportType} Report`, { align: 'center' });

      doc.moveDown(0.5);
      doc
        .fontSize(10)
        .font('Helvetica')
        .text(`Generated: ${new Date().toUTCString()}`, { align: 'center' });

      doc.moveDown(0.5);
      doc
        .moveTo(50, doc.y)
        .lineTo(doc.page.width - 50, doc.y)
        .strokeColor('#cccccc')
        .stroke();
      doc.moveDown(1);

      if (profiles.length === 0) {
        doc.fontSize(12).text('No profiles matched the selected filters.', { align: 'center' });
      } else {
        doc
          .fontSize(11)
          .font('Helvetica-Bold')
          .text(`Total profiles: ${profiles.length}`, { align: 'left' });
        doc.moveDown(1);

        profiles.forEach((profile, index) => {
          const profileUrl = `${BASE_URL}/profile/${profile._id}`;
          const nameText = `${index + 1}. ${profile.firstName || ''} ${profile.lastName || ''}`.trim();

          // Name as a clickable hyperlink
          const nameY = doc.y;
          doc
            .fontSize(12)
            .font('Helvetica-Bold')
            .fillColor('#1B5E20')
            .text(nameText, { underline: true, continued: false });
          // Overlay invisible link on the name text area
          doc.link(50, nameY, doc.page.width - 100, doc.currentLineHeight(true) + 2, profileUrl);
          doc.fillColor('black');

          doc.fontSize(10).font('Helvetica');

          if (profile.accountNumber) doc.text(`Account #: ${profile.accountNumber}`);
          if (profile.region) doc.text(`Region: ${profile.region}`);
          if (profile.district) doc.text(`District: ${profile.district}`);
          if (profile.position && reportType === 'PLAYER') doc.text(`Position: ${profile.position}`);
          if (profile.nationality) doc.text(`Nationality: ${profile.nationality}`);
          if (profile.phone) doc.text(`Phone: ${profile.phone}`);

          // Explicit "View Profile" link line
          const linkY = doc.y;
          doc
            .fontSize(9)
            .fillColor('#1565C0')
            .text('View full profile →', { underline: true });
          doc.link(50, linkY, 120, doc.currentLineHeight(true) + 2, profileUrl);
          doc.fillColor('black');

          doc.moveDown(0.5);
          doc
            .moveTo(50, doc.y)
            .lineTo(doc.page.width - 50, doc.y)
            .strokeColor('#eeeeee')
            .stroke();
          doc.moveDown(0.5);
        });
      }

      doc.end();
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    reportRequest.reportUrl = `${BASE_URL}/uploads/${fileName}`;
    reportRequest.status = 'FULFILLED';
    reportRequest.generatedAt = new Date();
    if (adminUserId) reportRequest.generatedBy = adminUserId;
    await reportRequest.save();

    return res.status(200).json({ data: reportRequest });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/report-requests/:id/cancel
router.post(`${BASE}/:id/cancel`, async (req, res) => {
  try {
    const reportRequest = await ReportRequest.findById(req.params.id);

    if (!reportRequest) {
      return res.status(404).json({ error: 'Report request not found' });
    }

    if (!['PENDING_PAYMENT', 'PAID'].includes(reportRequest.status)) {
      return res.status(400).json({ error: 'Only PENDING_PAYMENT or PAID requests can be cancelled' });
    }

    reportRequest.status = 'CANCELLED';
    await reportRequest.save();

    return res.status(200).json({ data: reportRequest });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
