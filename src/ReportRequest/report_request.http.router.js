const express = require('express');
const path = require('path');
const fs = require('fs');
const { getString } = require('@lykmapipo/env');
const User = require('../User/user.model');
const ReportRequest = require('./report_request.model');
const { Subscription } = require('../Subscription/subscription.model');

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
      const activeSub = await Subscription.getActiveSubscription(requestedBy);
      if (activeSub && (activeSub.userType === 'SCOUT' || activeSub.userType === 'AGENT')) {
        price = 0;
      }
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
          doc
            .fontSize(12)
            .font('Helvetica-Bold')
            .text(`${index + 1}. ${profile.firstName || ''} ${profile.lastName || ''}`.trim());

          doc.fontSize(10).font('Helvetica');

          if (profile.accountNumber) doc.text(`Account #: ${profile.accountNumber}`);
          if (profile.type) doc.text(`Type: ${profile.type}`);
          if (profile.region) doc.text(`Region: ${profile.region}`);
          if (profile.district) doc.text(`District: ${profile.district}`);
          if (profile.position && reportType === 'PLAYER') doc.text(`Position: ${profile.position}`);
          if (profile.phone) doc.text(`Phone: ${profile.phone}`);

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

    const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
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
