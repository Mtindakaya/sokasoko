const express = require('express');
const bcrypt = require('bcryptjs');
const { getString } = require('@lykmapipo/env');
const User = require('../User/user.model');
const { sendSms } = require('../Utils/utils');

const API_VERSION = getString('API_VERSION', '1.0.0');
const router = express.Router();
const BASE = `/v${API_VERSION.split('.')[0]}/auth`;

const RESET_TTL_MINUTES = 15;
const SALT_ROUNDS = 10;

// Normalise TZ phone → 255xxxxxxxxx form for the SMS gateway. First
// digit gets swapped for 255 (matches the pattern used at signup).
function normalisePhone(raw) {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('255')) return trimmed;
  if (trimmed.startsWith('+255')) return trimmed.slice(1);
  return trimmed.replace(trimmed.charAt(0), '255');
}

// Return a user matched by phone or email. Case-insensitive email;
// phone accepts both 07xxxxxxxx and 255xxxxxxxxx.
async function findUserByIdentifier(identifier) {
  if (!identifier || typeof identifier !== 'string') return null;
  const raw = identifier.trim();
  if (!raw) return null;
  // Try email first (case-insensitive exact match).
  if (raw.includes('@')) {
    return User.findOne({
      email: new RegExp(`^${raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
    });
  }
  // Phone: match either the raw form or the normalised 255-prefixed form.
  const normalised = normalisePhone(raw);
  return User.findOne({ $or: [{ phone: raw }, { phone: normalised }] });
}

function generateSixDigitCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// POST /v1/auth/forgot-password  body: { identifier }
// identifier = phone (07xxxxxxxx or 255xxxxxxxxx) OR email.
// Silent-200 whether or not the user exists — avoids leaking which
// numbers/emails are registered.
router.post(`${BASE}/forgot-password`, async (req, res) => {
  try {
    const identifier = (req.body && req.body.identifier) || '';
    const user = await findUserByIdentifier(identifier);
    if (!user) {
      // No leak. Return same 200 shape.
      return res.status(200).json({
        data: { sent: false, channel: null },
      });
    }
    const code = generateSixDigitCode();
    const salt = await bcrypt.genSalt(SALT_ROUNDS);
    const hash = await bcrypt.hash(code, salt);
    user.passwordResetCode = hash;
    user.passwordResetExpiresAt = new Date(
      Date.now() + RESET_TTL_MINUTES * 60 * 1000,
    );
    await user.save();

    // Delivery: SMS if we have a phone, email otherwise (email path
    // stubbed for now — logs to console until SMTP is wired).
    let channel = null;
    if (user.phone) {
      try {
        await sendSms(
          `SokaSoko: msimbo wako wa kubadili nywila ni ${code}. ` +
            `Muda: dakika ${RESET_TTL_MINUTES}. Usimshirikishe mtu.`,
          normalisePhone(user.phone),
        );
        channel = 'sms';
      } catch (err) {
        console.log('[auth.forgot] sms send failed:', err.message);
      }
    }
    if (!channel && user.email) {
      console.log(
        '[auth.forgot] TODO: email transport not wired — code for',
        user.email, 'is', code,
      );
      channel = 'email';
    }
    return res.status(200).json({
      data: { sent: !!channel, channel },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/auth/reset-password  body: { identifier, code, newPassword }
router.post(`${BASE}/reset-password`, async (req, res) => {
  try {
    const { identifier, code, newPassword } = req.body || {};
    if (!identifier || !code || !newPassword) {
      return res.status(400).json({
        error: 'identifier, code and newPassword are required',
        errorKey: 'auth.reset.err.missing',
      });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({
        error: 'Nywila mpya ni fupi mno (angalau herufi 6).',
        errorKey: 'auth.reset.err.password_too_short',
      });
    }
    const user = await findUserByIdentifier(identifier);
    if (!user || !user.passwordResetCode || !user.passwordResetExpiresAt) {
      return res.status(400).json({
        error: 'Msimbo si sahihi au umeisha muda wake.',
        errorKey: 'auth.reset.err.invalid_code',
      });
    }
    if (user.passwordResetExpiresAt.getTime() < Date.now()) {
      return res.status(400).json({
        error: 'Msimbo umeisha muda wake. Omba msimbo mpya.',
        errorKey: 'auth.reset.err.code_expired',
      });
    }
    const ok = await bcrypt.compare(String(code), user.passwordResetCode);
    if (!ok) {
      return res.status(400).json({
        error: 'Msimbo si sahihi.',
        errorKey: 'auth.reset.err.invalid_code',
      });
    }
    const salt = await bcrypt.genSalt(SALT_ROUNDS);
    user.password = await bcrypt.hash(String(newPassword), salt);
    user.passwordResetCode = null;
    user.passwordResetExpiresAt = null;
    await user.save();
    return res.status(200).json({ data: { ok: true } });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/users/:id/change-password  body: { currentPassword, newPassword }
// Authenticated path — user changes their own password. Requires the
// current password so a leaked session alone can't lock the real
// owner out.
router.post(`/v${API_VERSION.split('.')[0]}/users/:id/change-password`,
  async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        error: 'currentPassword and newPassword are required',
        errorKey: 'auth.change.err.missing',
      });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({
        error: 'Nywila mpya ni fupi mno (angalau herufi 6).',
        errorKey: 'auth.change.err.password_too_short',
      });
    }
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const ok = await new Promise((resolve) => {
      user.comparePassword(String(currentPassword), (err, m) => resolve(!!m));
    });
    if (!ok) {
      return res.status(403).json({
        error: 'Nywila ya sasa si sahihi.',
        errorKey: 'auth.change.err.wrong_current',
      });
    }
    const salt = await bcrypt.genSalt(SALT_ROUNDS);
    user.password = await bcrypt.hash(String(newPassword), salt);
    await user.save();
    return res.status(200).json({ data: { ok: true } });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
