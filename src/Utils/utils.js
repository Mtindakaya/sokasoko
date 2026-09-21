const bcrypt = require('bcryptjs');
const axios = require('axios');
const https = require('https');
const btoa = require('btoa');
const { info, error } = require('@lykmapipo/logger');
const { getString } = require('@lykmapipo/env');

const generateHash = async (password, saltRounds = 10) => {
  try {
    const salt = await bcrypt.genSalt(saltRounds);
    const payload = await bcrypt.hash(password, salt);
    return payload;
  } catch (err) {
    return error(err);
  }
};

const leftFillNum = (num, targetLength) => {
  return num.toString().padStart(targetLength, 0);
};

const apiKey = getString('BEEM_API_KEY');
const secretKey = getString('BEEM_SECRET_KEY');
const contentType = 'application/json';
const sourceAddr = 'INFO';

const sendSms = async (text, sender) => {
  axios
    .post(
      'https://apisms.beem.africa/v1/send',
      {
        source_addr: sourceAddr,
        schedule_time: '',
        encoding: 0,
        message: text,
        recipients: [
          {
            recipient_id: 1,
            dest_addr: sender,
          },
        ],
      },
      {
        headers: {
          'Content-Type': contentType,
          Authorization: `Basic ${btoa(`${apiKey}:${secretKey}`)}`,
        },
        httpsAgent: new https.Agent({
          rejectUnauthorized: false,
        }),
      }
    )
    .then((response) => {
      info({ message: response.data });
    })
    .catch((err) => console.error('SMS failed:', err?.data?.message || err?.message || err));
};

// Type-aware display name for any User doc. Org accounts (ACADEMY,
// CLUB, SCHOOL, VENDOR, SPONSOR-Entity, FOOTBALL_ASSOCIATION,
// FIELD_OWNER) carry the creator's firstName/lastName as searchable
// person fields, so a blind `${firstName} ${lastName}` join leaks
// the creator's identity into notification bodies, chat pings, and
// invitation copy. This helper mirrors User.getName() on the mobile
// client — check org name fields first, fall back to personal name.
// Any caller that shows a "who did X" label should route through here.
//
// Callers MUST include these fields in the User.find/populate select
// clause: firstName lastName type academy_name entity_name
// company_name football_field_name
const entityLabel = (u) => {
  if (!u) return '';
  const trim = (s) => (typeof s === 'string' ? s.trim() : '');
  const academy = trim(u.academy_name);
  if (academy) return academy;
  const entity = trim(u.entity_name);
  if (entity) return entity;
  const company = trim(u.company_name);
  if (company) return company;
  const field = trim(u.football_field_name);
  if (field) return field;
  const person = `${trim(u.firstName)} ${trim(u.lastName)}`.trim();
  return person;
};

module.exports = { generateHash, leftFillNum, sendSms, entityLabel };
