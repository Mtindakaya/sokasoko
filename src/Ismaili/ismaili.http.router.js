const express = require('express');
const axios = require('axios');
const { getString, getNumber } = require('@lykmapipo/env');
const IsmailiConversation = require('./ismaili_conversation.model');
const IsmailiUsage = require('./ismaili_usage.model');
const User = require('../User/user.model');

const API_VERSION = getString('API_VERSION', '1.0.0');
const router = express.Router();
const BASE = `/v${API_VERSION.split('.')[0]}/ai/ismaili`;

const HOURLY_CAP = getNumber('ISMAILI_HOURLY_CAP', 30);
const DAILY_CAP = getNumber('ISMAILI_DAILY_CAP', 200);
const MODEL = getString('ISMAILI_MODEL', 'claude-haiku-4-5-20251001');
const MAX_TURNS_CONTEXT = 10;

const SYSTEM_PROMPT = [
  'You are Ismaili, the SokaSoko football knowledge assistant.',
  'You are named after a football-loving persona and speak with warmth and clarity — brief, practical, and encouraging.',
  '',
  'SCOPE — answer only football topics: playing skills, tactics, training, physiology, refereeing, scouting criteria, football history, and the rules of the game. If the question is about the SokaSoko app itself, account issues, billing, or anything unrelated to football, politely say you only handle football questions and suggest the user tap the help/support link in the app.',
  '',
  'STYLE — keep answers under 200 words unless the user explicitly asks for a longer explanation. Use short paragraphs and bullet points. Prefer concrete, position-specific advice.',
  '',
  'CAUTION — never claim to have inside information about specific SokaSoko users, matches, or evaluations unless the app has attached that context to the conversation. When unsure, say so.',
].join('\n');

async function bucketKeys(date = new Date()) {
  const iso = date.toISOString();
  const hourKey = iso.slice(0, 13); // 'YYYY-MM-DDTHH'
  const dayKey = iso.slice(0, 10);  // 'YYYY-MM-DD'
  return { hourKey, dayKey };
}

async function checkAndConsumeQuota(userId) {
  const { hourKey, dayKey } = await bucketKeys();
  // Aggregate today's usage across whichever hourly buckets exist.
  const dailyAgg = await IsmailiUsage.aggregate([
    { $match: { user: userId, dayKey } },
    { $group: { _id: null, total: { $sum: '$count' } } },
  ]);
  const dailyTotal = dailyAgg[0] ? dailyAgg[0].total : 0;
  if (dailyTotal >= DAILY_CAP) {
    return { ok: false, reason: 'daily_cap', remaining: 0 };
  }

  const hourly = await IsmailiUsage.findOne({ user: userId, hourKey }).lean();
  if (hourly && hourly.count >= HOURLY_CAP) {
    return { ok: false, reason: 'hourly_cap', remaining: 0 };
  }

  await IsmailiUsage.findOneAndUpdate(
    { user: userId, hourKey },
    { $inc: { count: 1 }, $set: { dayKey } },
    { upsert: true, new: true }
  );
  return { ok: true, remaining: HOURLY_CAP - (hourly ? hourly.count : 0) - 1 };
}

async function callAnthropic({ system, messages }) {
  const apiKey = getString('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: MODEL,
        max_tokens: 700,
        system,
        messages,
      },
      {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        timeout: 30000,
      }
    );
    const content = (response.data.content || [])
      .map(c => c.text)
      .filter(Boolean)
      .join('\n');
    return content.trim() || 'Sorry — I could not think of a good answer right now.';
  } catch (err) {
    if (err.response) {
      const body = typeof err.response.data === 'string'
        ? err.response.data
        : JSON.stringify(err.response.data);
      throw new Error(`Anthropic ${err.response.status}: ${body.slice(0, 300)}`);
    }
    throw err;
  }
}

// POST /v1/ai/ismaili — send a user turn, get Ismaili's reply.
router.post(BASE, async (req, res) => {
  try {
    const { userId, message } = req.body;
    if (!userId || !message || typeof message !== 'string') {
      return res.status(400).json({ error: 'userId and message are required' });
    }
    if (message.trim().length === 0) {
      return res.status(400).json({ error: 'message is empty' });
    }
    if (message.length > 4000) {
      return res.status(400).json({ error: 'message too long (max 4000 chars)' });
    }

    const user = await User.findById(userId).select('_id firstName type').lean();
    if (!user) return res.status(404).json({ error: 'user not found' });

    const quota = await checkAndConsumeQuota(user._id);
    if (!quota.ok) {
      return res.status(429).json({
        error: quota.reason === 'daily_cap'
          ? 'Daily message limit reached. Try again tomorrow.'
          : 'Hourly message limit reached. Try again shortly.',
      });
    }

    const priorTurns = await IsmailiConversation.find({ user: user._id })
      .sort({ createdAt: -1 })
      .limit(MAX_TURNS_CONTEXT)
      .lean();
    const history = priorTurns
      .reverse()
      .map(t => ({ role: t.role, content: t.content }));

    // Save the user turn first so it lands in history even if the API call fails.
    await IsmailiConversation.create({
      user: user._id,
      role: 'user',
      content: message,
    });

    let reply;
    try {
      reply = await callAnthropic({
        system: SYSTEM_PROMPT,
        messages: [...history, { role: 'user', content: message }],
      });
    } catch (err) {
      console.log('Ismaili LLM error:', err.message);
      return res.status(502).json({
        error: 'Ismaili is temporarily unavailable. Please try again in a moment.',
      });
    }

    await IsmailiConversation.create({
      user: user._id,
      role: 'assistant',
      content: reply,
    });

    return res.status(200).json({
      reply,
      remaining: quota.remaining,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/ai/ismaili/user — returns the Ismaili system user row so the
// mobile app can open a DM with him. Kept behind this endpoint because
// Ismaili is filtered out of /v1/users and /v1/users/search on purpose.
router.get(BASE + '/user', async (req, res) => {
  try {
    const ismaili = await User.findOne({ isSystemAgent: true, firstName: 'Ismaili' })
      .select('_id firstName lastName accountNumber type profileImage short_bio')
      .lean();
    if (!ismaili) return res.status(404).json({ error: 'Ismaili not seeded' });
    return res.status(200).json({ data: ismaili });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/ai/ismaili/history?userId=&limit= — retrieve recent turns.
router.get(BASE + '/history', async (req, res) => {
  try {
    const { userId, limit = 50 } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    const cap = Math.min(parseInt(limit, 10) || 50, 200);
    const turns = await IsmailiConversation.find({ user: userId })
      .sort({ createdAt: -1 })
      .limit(cap)
      .lean();
    return res.status(200).json({ data: turns.reverse() });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
