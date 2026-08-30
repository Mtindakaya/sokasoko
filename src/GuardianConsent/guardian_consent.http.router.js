// Guardian consent endpoints. Backs the client dialog that appears
// before a minor is created:
//
//   GET  /v1/consent/guardian/text?version=V1&locale=sw
//        → { version, locale, text } — the letter body (with the
//        {MINOR_NAME} placeholder still present; client interpolates).
//
//   GET  /v1/guardians/:id/consents/latest
//        → { hasSigned, count, latestVersion, latestSignedAt,
//            currentVersion } — client uses `hasSigned` to decide
//        full-letter-vs-short-reminder UX.
//
//   POST /v1/guardians/:id/consents
//        body { minorId, minorName, consentVersion, snapshotText,
//               locale, signatureName }
//        → { data } — creates one row (guardian+minor); 409 on dup.

const express = require('express');
const GuardianConsent = require('./guardian_consent.model');
const { getText, CURRENT_VERSION } = require('./consent_texts');

const router = express.Router();

router.get('/v1/consent/guardian/text', (req, res) => {
  const { version, locale } = req.query;
  return res.json(getText(version, locale));
});

router.get('/v1/guardians/:id/consents/latest', async (req, res) => {
  try {
    const guardianId = req.params.id;
    const [latest, count] = await Promise.all([
      GuardianConsent.findOne({ guardian: guardianId })
        .sort({ signedAt: -1 })
        .select('consentVersion signedAt minor minorName')
        .lean(),
      GuardianConsent.countDocuments({ guardian: guardianId }),
    ]);
    return res.json({
      hasSigned: !!latest,
      count,
      latestVersion: latest ? latest.consentVersion : null,
      latestSignedAt: latest ? latest.signedAt : null,
      currentVersion: CURRENT_VERSION,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/v1/guardians/:id/consents', async (req, res) => {
  try {
    const guardianId = req.params.id;
    const {
      minorId, minorName, consentVersion, snapshotText,
      locale, signatureName,
    } = req.body;

    if (!minorId || !minorName || !consentVersion || !snapshotText ||
        !signatureName || !locale) {
      return res.status(400).json({
        error: 'minorId, minorName, consentVersion, snapshotText, locale and signatureName are required',
      });
    }

    const doc = await GuardianConsent.create({
      guardian: guardianId,
      minor: minorId,
      minorName: String(minorName).trim(),
      consentVersion,
      snapshotText,
      locale,
      signatureName: String(signatureName).trim(),
      signedAt: new Date(),
      ipAddress: req.headers['x-forwarded-for'] || req.ip,
      userAgent: req.headers['user-agent'],
    });
    return res.status(201).json({ data: doc });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({
        error: 'This guardian has already signed for this minor',
      });
    }
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
