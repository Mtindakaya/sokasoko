const express = require('express');
const { getString, getNumber } = require('@lykmapipo/env');
const Anthropic = require('@anthropic-ai/sdk');
const AiQuery = require('./ai_advisor.model');
const { Subscription } = require('../Subscription/subscription.model');
const User = require('../User/user.model');

const API_VERSION = getString('API_VERSION', '1.0.0');
const router = express.Router();
const BASE = `/v${API_VERSION.split('.')[0]}/ai`;

const FREE_MONTHLY_LIMIT = 5;

const SYSTEM_PROMPT = `You are SokaSoko AI, a football advisor built into the SokaSoko platform for East African players, coaches, scouts, and referees.

Your role:
- Answer practical questions about football training, tactics, positioning, fitness, nutrition, and career development
- Give advice relevant to the East African football context (Tanzania, Kenya, Uganda, Rwanda)
- Be encouraging and constructive — many users are young players developing their careers
- Keep answers concise (3–5 short paragraphs max) and actionable
- If asked about specific players or clubs, give general advice rather than speculation
- Do not answer questions unrelated to football or sports

Always respond in the same language the user writes in (Swahili or English).`;

async function getMonthlyUsage(userId) {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  return AiQuery.countDocuments({ userId, createdAt: { $gte: start }, status: 'answered' });
}

async function hasUnlimitedAccess(userId, userType) {
  if (['SCOUT', 'AGENT', 'COACH', 'ACADEMY', 'SCHOOL'].includes(userType)) {
    const sub = await Subscription.getActiveSubscription(userId);
    if (sub) return true;
  }
  if (userType === 'PLAYER') {
    const sub = await Subscription.getActiveSubscription(userId);
    if (sub) return true;
  }
  return false;
}

// POST /v1/ai/ask
router.post(`${BASE}/ask`, async (req, res) => {
  try {
    const { userId, question, context } = req.body;
    if (!userId || !question || !question.trim()) {
      return res.status(400).json({ error: 'userId and question are required' });
    }

    const user = await User.findById(userId).select('type firstName dob').lean();
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Quota check
    const unlimited = await hasUnlimitedAccess(userId, user.type);
    if (!unlimited) {
      const used = await getMonthlyUsage(userId);
      if (used >= FREE_MONTHLY_LIMIT) {
        return res.status(429).json({
          error: 'monthly_limit_reached',
          message: `You have used your ${FREE_MONTHLY_LIMIT} free questions this month. Subscribe to ask unlimited questions.`,
          used,
          limit: FREE_MONTHLY_LIMIT,
        });
      }
    }

    // Save query first (pending)
    const query = await AiQuery.create({ userId, question: question.trim(), context, status: 'pending' });

    const apiKey = getString('ANTHROPIC_API_KEY', '');

    // If no API key yet, return a placeholder response
    if (!apiKey) {
      const placeholder = `Hi ${user.firstName}! The AI Advisor is almost ready — we're finalising the setup. Check back soon and you'll be able to ask any football question you have. In the meantime, explore your profile and keep training! 🏆`;
      query.answer = placeholder;
      query.status = 'answered';
      await query.save();
      return res.status(200).json({ data: { answer: placeholder, queryId: query._id, unlimited, remainingFree: unlimited ? null : FREE_MONTHLY_LIMIT - (await getMonthlyUsage(userId)) } });
    }

    // Call Claude
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: question.trim() }],
    });

    const answer = response.content[0]?.text || 'Sorry, I could not generate a response. Please try again.';
    const tokensUsed = (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);

    query.answer = answer;
    query.tokensUsed = tokensUsed;
    query.status = 'answered';
    await query.save();

    const used = await getMonthlyUsage(userId);
    return res.status(200).json({
      data: {
        answer,
        queryId: query._id,
        unlimited,
        remainingFree: unlimited ? null : FREE_MONTHLY_LIMIT - used,
      },
    });
  } catch (err) {
    console.error('[AI Advisor] ask error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/ai/history/:userId — load past Q&A
router.get(`${BASE}/history/:userId`, async (req, res) => {
  try {
    const queries = await AiQuery.find({ userId: req.params.userId, status: 'answered' })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    return res.status(200).json({ data: queries });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/ai/quota/:userId — check remaining quota
router.get(`${BASE}/quota/:userId`, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select('type').lean();
    if (!user) return res.status(404).json({ error: 'User not found' });
    const unlimited = await hasUnlimitedAccess(req.params.userId, user.type);
    const used = await getMonthlyUsage(req.params.userId);
    return res.status(200).json({
      data: {
        unlimited,
        used,
        limit: FREE_MONTHLY_LIMIT,
        remaining: unlimited ? null : Math.max(0, FREE_MONTHLY_LIMIT - used),
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
