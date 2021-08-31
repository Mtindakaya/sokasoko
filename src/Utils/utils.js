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
    .catch((err) => error({ message: err.data.message }));
};

module.exports = { generateHash, leftFillNum, sendSms };
