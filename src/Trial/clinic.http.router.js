/**
 * Clinic HTTP router — clinics share the Trial collection with an
 * `eventType: 'CLINIC'` discriminator. Registration data lives on the
 * shared TrialRegistration collection with the same eventType field.
 *
 * All routes are namespaced under /v1/clinics so we don't leak clinic
 * documents through /v1/trials (which explicitly filters to
 * eventType='TRIAL').
 */
const express = require('express');
const { getString } = require('@lykmapipo/env');
const Trial = require('./trial.model');
const TrialRegistration = require('./trial_registration.model');
const User = require('../User/user.model');
const { Subscription, FEATURE_CAPS } = require('../Subscription/subscription.model');
const { uploadFor } = require('../Utils/uploader');
const OneTimePurchase = require('../OneTimePurchase/one_time_purchase.model');

const API_VERSION = getString('API_VERSION', '1.0.0');
const router = express.Router();
const BASE = `/v${API_VERSION.split('.')[0]}/clinics`;

// Simple helper: is this user (or their delegated org context) allowed to
// post clinics? Reuses the same context resolver that already handles
// delegation for other org-scoped gates. Returns:
//   { ok: true, tier, userType }
//   { ok: false, reason, tier, userType, canOfferOneTime, oneTimePrice }
async function canPostClinics(userId) {
  if (!userId) return { ok: false, reason: 'MISSING_ORGANIZER' };
  const ctx = await Subscription.getEffectiveContext(userId);
  if (!ctx) return { ok: false, reason: 'USER_NOT_FOUND' };
  const caps = ctx.caps || {};
  if (caps.canPostClinics === true) {
    return { ok: true, tier: ctx.tier, userType: ctx.userType };
  }
  // Check for a PAID one-time purchase that would unlock this action.
  const purchase = await OneTimePurchase.findConsumable(userId, 'POST_CLINIC');
  if (purchase) {
    return {
      ok: true, tier: ctx.tier, userType: ctx.userType,
      viaPurchase: true, purchaseId: purchase._id,
    };
  }
  // No sub, no purchase — is this user even eligible to buy?
  const eligibleTypes = OneTimePurchase.ELIGIBLE_TYPES.POST_CLINIC || [];
  const canOfferOneTime = ctx.tier === 'STANDARD'
    && eligibleTypes.includes(ctx.userType);
  return {
    ok: false,
    reason: `${ctx.actualUserType || ctx.userType}_CLINIC_CREATION_BLOCKED`,
    tier: ctx.tier,
    userType: ctx.userType,
    canOfferOneTime,
    oneTimePrice: canOfferOneTime
      ? { amount: OneTimePurchase.PRICES.POST_CLINIC.TZS,
          currency: 'TZS', actionType: 'POST_CLINIC' }
      : null,
  };
}

// GET /v1/clinics — list clinics with optional filters
router.get(BASE, async (req, res) => {
  try {
    const { status, gender, ageGroup, organizer, region, focusArea,
            skillLevel, page = 1, limit = 20 } = req.query;
    const filter = { eventType: 'CLINIC' };
    if (status)      filter.status = status;
    if (gender)      filter.gender = gender;
    if (ageGroup)    filter.ageGroups = ageGroup;
    if (organizer)   filter.organizer = organizer;
    if (region)      filter.region = region;
    if (focusArea)   filter.focusArea = focusArea;
    if (skillLevel)  filter.skillLevel = skillLevel;

    const [data, total] = await Promise.all([
      Trial.find(filter)
        .populate('organizer', 'firstName lastName type academy_name profileImage accountNumber')
        .populate('leadCoach', 'firstName lastName type accountNumber profileImage')
        .sort({ startDate: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit))
        .lean(),
      Trial.countDocuments(filter),
    ]);

    return res.status(200).json({
      data, total, page: parseInt(page), pages: Math.ceil(total / limit),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/clinics/:id
router.get(`${BASE}/:id`, async (req, res) => {
  try {
    const clinic = await Trial.findOne({ _id: req.params.id, eventType: 'CLINIC' })
      .populate('organizer', 'firstName lastName type academy_name profileImage accountNumber')
      .populate('leadCoach', 'firstName lastName type accountNumber profileImage')
      .populate('staff.coach', 'firstName lastName type accountNumber profileImage')
      .populate('sessions.venue', 'name region district ward');
    if (!clinic) return res.status(404).json({ error: 'Clinic not found' });
    return res.status(200).json({ data: clinic });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/clinics — create a new clinic
router.post(BASE, async (req, res) => {
  try {
    const { title, organizer, startDate, location, gender, focusArea } = req.body;
    if (!title || !organizer || !startDate || !location || !gender || !focusArea) {
      return res.status(400).json({
        error: 'title, organizer, startDate, location, gender and focusArea are required',
      });
    }

    // Tier gate — enforce canPostClinics on the effective context.
    const gate = await canPostClinics(organizer);
    if (!gate.ok) {
      // 402 Payment Required when a one-time purchase can unlock this.
      // Otherwise fall back to a hard 403 upgrade wall.
      const httpStatus = gate.canOfferOneTime ? 402 : 403;
      const suffix = gate.canOfferOneTime
        ? ' Chagua kuboresha kifurushi au kulipa TSh '
          + gate.oneTimePrice.amount.toLocaleString('en-US') + ' kwa mara moja.'
        : ' Boresha kifurushi.';
      return res.status(httpStatus).json({
        error: `Kifurushi cha ${gate.tier || 'sasa'} hakiruhusu kuchapisha clinics.${suffix}`,
        reason: gate.reason,
        tier: gate.tier,
        userType: gate.userType,
        canOfferOneTime: gate.canOfferOneTime,
        oneTimePrice: gate.oneTimePrice,
      });
    }

    const body = { ...req.body, eventType: 'CLINIC' };
    // Guardian consent + medical declaration default to true for clinics.
    if (body.requiresGuardianConsent == null) body.requiresGuardianConsent = true;
    if (body.requiresMedicalDeclaration == null) body.requiresMedicalDeclaration = true;

    // Auto-number sessions if the caller didn't.
    if (Array.isArray(body.sessions)) {
      body.sessions = body.sessions.map((s, i) => ({
        ...s,
        sessionNumber: s.sessionNumber || i + 1,
      }));
    }

    const clinic = await Trial.create(body);

    // Consume the one-time purchase now that the resource exists.
    if (gate.viaPurchase && gate.purchaseId) {
      try {
        await OneTimePurchase.consume(gate.purchaseId, clinic._id);
      } catch (e) {
        console.log('[clinic] failed to consume purchase',
          gate.purchaseId, e.message);
      }
    }

    const populated = await Trial.findById(clinic._id)
      .populate('organizer', 'firstName lastName type academy_name profileImage accountNumber')
      .populate('leadCoach', 'firstName lastName type accountNumber profileImage');
    return res.status(201).json({ data: populated });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /v1/clinics/:id — update clinic details (organizer only in practice)
router.patch(`${BASE}/:id`, async (req, res) => {
  try {
    const patch = { ...req.body };
    delete patch.eventType; // don't allow eventType override
    const clinic = await Trial.findOneAndUpdate(
      { _id: req.params.id, eventType: 'CLINIC' },
      { $set: patch },
      { new: true }
    );
    if (!clinic) return res.status(404).json({ error: 'Clinic not found' });
    return res.json({ data: clinic });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/clinics/:id/sessions — add a session
router.post(`${BASE}/:id/sessions`, async (req, res) => {
  try {
    const clinic = await Trial.findOne({ _id: req.params.id, eventType: 'CLINIC' });
    if (!clinic) return res.status(404).json({ error: 'Clinic not found' });
    const nextNumber = (clinic.sessions || []).length + 1;
    clinic.sessions.push({ ...req.body, sessionNumber: req.body.sessionNumber || nextNumber });
    await clinic.save();
    return res.status(201).json({ data: clinic.sessions[clinic.sessions.length - 1] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /v1/clinics/:id/sessions/:sessionId — mark completed / cancel
router.patch(`${BASE}/:id/sessions/:sessionId`, async (req, res) => {
  try {
    const clinic = await Trial.findOne({ _id: req.params.id, eventType: 'CLINIC' });
    if (!clinic) return res.status(404).json({ error: 'Clinic not found' });
    const s = clinic.sessions.id(req.params.sessionId);
    if (!s) return res.status(404).json({ error: 'Session not found' });
    if (req.body.status) s.status = req.body.status;
    if (req.body.cancellationReason != null) s.cancellationReason = req.body.cancellationReason;
    if (req.body.topic != null) s.topic = req.body.topic;
    if (req.body.topicSw != null) s.topicSw = req.body.topicSw;
    if (req.body.date) s.date = req.body.date;
    if (req.body.startTime != null) s.startTime = req.body.startTime;
    if (req.body.endTime != null) s.endTime = req.body.endTime;
    if (req.body.venue != null) s.venue = req.body.venue;
    if (req.body.status === 'Completed') {
      s.completedAt = new Date();
      if (req.body.completedBy) s.completedBy = req.body.completedBy;
    }
    await clinic.save();
    return res.json({ data: s });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/clinics/:id/staff/:coachId/respond — coach accepts/declines
router.post(`${BASE}/:id/staff/:coachId/respond`, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['ACCEPTED', 'DECLINED'].includes(status)) {
      return res.status(400).json({ error: 'status must be ACCEPTED or DECLINED' });
    }
    const clinic = await Trial.findOne({ _id: req.params.id, eventType: 'CLINIC' });
    if (!clinic) return res.status(404).json({ error: 'Clinic not found' });
    const entry = clinic.staff.find(s => String(s.coach) === req.params.coachId);
    if (!entry) return res.status(404).json({ error: 'Coach not on this clinic' });
    entry.status = status;
    await clinic.save();
    return res.json({ data: entry });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/clinics/:id/enrol — enrol a player. Accepts multipart so the
// caller can upload dobDocument, passportPhoto, and medicalDeclaration
// files inline; uploadFor() replaces each file field with a URL string
// on req.body before we read the fields. Also accepts JSON with URL
// strings directly (already-uploaded docs). Enforces guardian consent +
// mandatory doc set when the clinic requires them.
router.post(`${BASE}/:id/enrol`, uploadFor(), async (req, res) => {
  try {
    const clinic = await Trial.findOne({ _id: req.params.id, eventType: 'CLINIC' });
    if (!clinic) return res.status(404).json({ error: 'Clinic not found' });

    // guardianConsent + emergencyContact may arrive as JSON strings when
    // submitted via multipart — parse defensively.
    for (const k of ['guardianConsent', 'emergencyContact']) {
      if (typeof req.body[k] === 'string') {
        try { req.body[k] = JSON.parse(req.body[k]); } catch (_) {}
      }
    }
    const {
      playerId, academyId, registrantType = 'PLAYER', selectedAgeGroup,
      dobDocument, passportPhoto, medicalDeclaration, medicalDeclarationUrl,
      guardianConsent = {}, emergencyContact = {}, medicalNotes,
      hasMedicalCondition,
    } = req.body;
    // `medicalDeclaration` is the multipart file field; the middleware
    // stashes its URL there. Fall back to explicit URL field for JSON callers.
    const medicalUrl = medicalDeclaration || medicalDeclarationUrl;

    if (registrantType === 'PLAYER' && !playerId) {
      return res.status(400).json({ error: 'playerId is required for player registration' });
    }
    if (registrantType === 'ACADEMY' && !academyId) {
      return res.status(400).json({ error: 'academyId is required for academy registration' });
    }

    // Safeguarding — enforce mandatory upload of the docs the clinic requires.
    if (clinic.requiresGuardianConsent && !guardianConsent.given) {
      return res.status(400).json({
        error: 'Kibali cha mlezi kinahitajika kwa clinic hii.',
        reason: 'GUARDIAN_CONSENT_REQUIRED',
      });
    }
    if (clinic.requiresMedicalDeclaration && !medicalUrl) {
      return res.status(400).json({
        error: 'Tamko la kimatibabu linahitajika kwa clinic hii.',
        reason: 'MEDICAL_DECLARATION_REQUIRED',
      });
    }
    if (!dobDocument || !passportPhoto) {
      return res.status(400).json({
        error: 'DOB certificate na passport photo zinahitajika.',
        reason: 'IDENTITY_DOCS_REQUIRED',
      });
    }

    const consentGiven = guardianConsent.given === true
      || guardianConsent.given === 'true';
    const reg = await TrialRegistration.create({
      eventType: 'CLINIC',
      trialId: clinic._id,
      playerId, academyId, registrantType, selectedAgeGroup,
      dobDocument, passportPhoto,
      medicalDeclarationUrl: medicalUrl,
      guardianConsent: {
        ...guardianConsent,
        given: consentGiven,
        givenAt: consentGiven ? new Date() : null,
      },
      emergencyContact,
      medicalNotes,
      hasMedicalCondition: hasMedicalCondition === true
        || hasMedicalCondition === 'true',
      status: 'pending',
    });
    return res.status(201).json({ data: reg });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Tayari umejisajili kwenye clinic hii.' });
    }
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/clinics/:id/sessions/:sessionId/attendance — mark attendance for
// enrolled players. Body: { entries: [{ registrationId, status, note }] }
router.post(`${BASE}/:id/sessions/:sessionId/attendance`, async (req, res) => {
  try {
    const clinic = await Trial.findOne({ _id: req.params.id, eventType: 'CLINIC' });
    if (!clinic) return res.status(404).json({ error: 'Clinic not found' });
    const s = clinic.sessions.id(req.params.sessionId);
    if (!s) return res.status(404).json({ error: 'Session not found' });

    const entries = Array.isArray(req.body.entries) ? req.body.entries : [];
    const markedBy = req.body.markedBy;
    let updated = 0;
    for (const e of entries) {
      const reg = await TrialRegistration.findById(e.registrationId);
      if (!reg || String(reg.trialId) !== String(clinic._id)) continue;
      // Upsert this session's attendance record on the registration.
      const idx = reg.attendance.findIndex(a =>
        String(a.session) === String(s._id));
      const record = {
        session: s._id,
        sessionNumber: s.sessionNumber,
        sessionDate: s.date,
        status: e.status || 'PRESENT',
        note: e.note,
        markedBy, markedAt: new Date(),
      };
      if (idx >= 0) reg.attendance[idx] = record;
      else reg.attendance.push(record);
      await reg.save();
      updated++;
    }
    return res.json({ updated });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/clinics/:id/sessions/:sessionId/notes — lightweight per-session
// coach note (spec §4.2). Stores directly on the clinic's session for MVP;
// a dedicated ClinicAssessment collection lands in Phase 2.
router.post(`${BASE}/:id/sessions/:sessionId/notes`, async (req, res) => {
  try {
    const { player, coach, workedOn, coachRating, effort, note } = req.body;
    if (!player || !coach) {
      return res.status(400).json({ error: 'player and coach are required' });
    }
    const clinic = await Trial.findOne({ _id: req.params.id, eventType: 'CLINIC' });
    if (!clinic) return res.status(404).json({ error: 'Clinic not found' });
    const reg = await TrialRegistration.findOne({
      trialId: clinic._id, playerId: player,
    });
    if (!reg) return res.status(404).json({ error: 'Player not enrolled' });

    // Store on registration's notes field as a simple audit line for MVP.
    const stamp = new Date().toISOString().slice(0, 10);
    const line = `[${stamp} · session ${req.params.sessionId}] coach:${coach} `
      + `rating:${coachRating || '-'} effort:${effort || '-'} `
      + `workedOn:${workedOn || '-'} note:${note || ''}`;
    reg.notes = reg.notes ? `${reg.notes}\n${line}` : line;
    await reg.save();
    return res.status(201).json({ data: { line } });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/clinics/:id/registrations — list enrolments for the organizer
router.get(`${BASE}/:id/registrations`, async (req, res) => {
  try {
    const rows = await TrialRegistration.find({
      trialId: req.params.id, eventType: 'CLINIC',
    })
      .populate('playerId', 'firstName lastName dob gender accountNumber profileImage')
      .populate('academyId', 'academy_name accountNumber profileImage')
      .sort({ createdAt: -1 })
      .lean();
    return res.json({ data: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
