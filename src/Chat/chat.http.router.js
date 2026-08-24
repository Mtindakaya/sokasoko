const express = require('express');
const axios = require('axios');
const { getString } = require('@lykmapipo/env');
const ChatMessage = require('./chat.model');
const ChatGroup = require('./chat_group.model');
const mongoose = require('mongoose');
const IsmailiConversation = require('../Ismaili/ismaili_conversation.model');
const User = require('../User/user.model');
const { checkRateLimit, scanContent } = require('./chat.moderation');

const ISMAILI_USER_ID = getString('ISMAILI_USER_ID', '');
const ISMAILI_MODEL = getString('ISMAILI_MODEL', 'claude-haiku-4-5-20251001');

const ISMAILI_SYSTEM_PROMPT = [
  'You are Ismaili, the SokaSoko football knowledge assistant. Warm, clear, brief.',
  '',
  'LANGUAGE (ALWAYS mirror the user): Kiswahili in → Tanzania Kiswahili out; English in → English out; mixed in → mirror the mix. Standard English football terms (penalty, offside, winger, striker, cross, dribble, corner, VAR) stay in English even inside a Kiswahili reply. Kiswahili is fully supported — NEVER refuse a question because it is written in Kiswahili and NEVER ask the user to switch to English.',
  '',
  'SCOPE — you answer FOOTBALL/SOCCER questions in ANY language.',
  '',
  'IN SCOPE: playing skills, tactics, training, conditioning, footballer nutrition, refereeing, Laws of the Game, scouting, player evaluation, football history, leagues, competitions, career pathways (academies, trials, agents, clubs), and football-adjacent topics (physics of a curved shot, psychology of a striker under pressure, injury recovery for footballers).',
  '',
  'OUT OF SCOPE (topic, not language) — refuse: other sports (basketball, cricket, rugby, tennis, athletics); general knowledge unrelated to football; coding/tech help; homework/essays/translation; politics, religion, medical/legal/financial advice; SokaSoko app support (redirect to in-app Help).',
  '',
  'REFUSAL — for OUT OF SCOPE only, reply in the USER\'S LANGUAGE with one short paragraph. Never refuse based on language.',
  '• Kiswahili: "Samahani, mimi ni msaidizi wa mpira wa miguu tu — sikuweza kukusaidia na hili. Kama ni suala la app, tumia kitufe cha Msaada."',
  '• English: "Sorry, I\'m a football-only assistant — I can\'t help with this one. For app support, use the Help option."',
  '',
  'STYLE — under 200 words unless asked for more. Short paragraphs, bullet points welcome, practical, encouraging.',
].join('\n');

// Fire-and-forget: when a user DMs Ismaili, generate a reply and post it
// back over the same chat channel so it appears in the user's Messages
// inbox like any other message.
async function generateAndPostIsmailiReply(io, { userMessageDoc, populatedUser }) {
  try {
    if (!ISMAILI_USER_ID) {
      console.log('ISMAILI_USER_ID not set — skipping AI reply');
      return;
    }
    // Load recent turns for context.
    const prior = await IsmailiConversation.find({ user: userMessageDoc.sender })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();
    const history = prior.reverse().map(t => ({ role: t.role, content: t.content }));

    // Save the incoming user message to Ismaili's memory before the LLM call
    // so future turns see it even if the API fails.
    await IsmailiConversation.create({
      user: userMessageDoc.sender,
      role: 'user',
      content: userMessageDoc.content,
    });

    const apiKey = getString('ANTHROPIC_API_KEY');
    if (!apiKey) {
      console.log('ANTHROPIC_API_KEY not set — skipping AI reply');
      return;
    }

    let data;
    try {
      const response = await axios.post(
        'https://api.anthropic.com/v1/messages',
        {
          model: ISMAILI_MODEL,
          max_tokens: 700,
          system: ISMAILI_SYSTEM_PROMPT,
          messages: [...history, { role: 'user', content: userMessageDoc.content }],
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
      data = response.data;
    } catch (err) {
      if (err.response) {
        console.log('Ismaili chat LLM error:', err.response.status,
          JSON.stringify(err.response.data).slice(0, 200));
      } else {
        console.log('Ismaili chat LLM error:', err.message);
      }
      return;
    }
    const reply = (data.content || [])
      .map(c => c.text)
      .filter(Boolean)
      .join('\n')
      .trim() || 'I am not sure how to answer that just now.';

    await IsmailiConversation.create({
      user: userMessageDoc.sender,
      role: 'assistant',
      content: reply,
    });

    const replyMsg = await ChatMessage.create({
      sender: ISMAILI_USER_ID,
      receiver: userMessageDoc.sender,
      content: reply,
      read: false,
    });
    const populatedReply = await ChatMessage.findById(replyMsg._id)
      .populate('sender', 'firstName lastName photo type')
      .populate('receiver', 'firstName lastName photo type')
      .lean();

    if (io) {
      io.to(String(userMessageDoc.sender)).emit('new_message', populatedReply);
      io.to(String(ISMAILI_USER_ID)).emit('new_message', populatedReply);
    }
  } catch (err) {
    console.log('generateAndPostIsmailiReply error:', err.message);
  }
}

// ─── SokaSoko house-account support helpers ───────────────────────────────
// Per-sender rate limit on DMs INTO the SokaSoko house account.
// In-memory sliding window; ephemeral is fine — the goal is preventing
// a single user from flooding support, not perfect accounting across
// process restarts. 5 msgs / 60 min.
const SOKASOKO_RATE_WINDOW_MS = 60 * 60 * 1000;
const SOKASOKO_RATE_MAX = 5;
const _sokasokoRateHits = new Map(); // senderId → number[] (epoch ms)

async function checkHouseAccountRateLimit(senderId) {
  const now = Date.now();
  const arr = (_sokasokoRateHits.get(String(senderId)) || [])
    .filter((t) => now - t < SOKASOKO_RATE_WINDOW_MS);
  if (arr.length >= SOKASOKO_RATE_MAX) {
    return { ok: false, retryAfterMs: SOKASOKO_RATE_WINDOW_MS - (now - arr[0]) };
  }
  arr.push(now);
  _sokasokoRateHits.set(String(senderId), arr);
  return { ok: true };
}

// Send the canned greeting from the house account to a first-time
// support-inbox visitor. Called AFTER the user's first message is
// persisted; the greeting appears right after their message so the
// thread starts as user→SokaSoko→SokaSoko.
async function sendSokasokoGreetingIfFirstContact(io, houseAccountId, userId) {
  try {
    const priorFromHouse = await ChatMessage.exists({
      sender: houseAccountId,
      receiver: userId,
    });
    if (priorFromHouse) return; // already seen the greeting
    const greeting = 'Karibu SokaSoko Support 👋\n\n'
      + 'Andika swali lako lolote hapa — timu yetu itakujibu haraka iwezekanavyo. '
      + 'Wastani wa majibu: masaa 24 wakati wa siku za kazi.\n\n'
      + 'Welcome to SokaSoko Support — write your question here and our team '
      + 'will get back to you. Typical response time: 24 hours on business days.';
    const msg = await ChatMessage.create({
      sender: houseAccountId,
      receiver: userId,
      content: greeting,
      read: false,
    });
    const populated = await ChatMessage.findById(msg._id)
      .populate('sender', 'firstName lastName companyName photo type')
      .populate('receiver', 'firstName lastName photo type')
      .lean();
    if (io) {
      io.to(String(userId)).emit('new_message', populated);
      io.to(String(houseAccountId)).emit('new_message', populated);
    }
  } catch (err) {
    console.log('[sokasoko] greeting failed:', err.message);
  }
}

module.exports = function createChatRouter(io) {
  const router = express.Router();

  // ─── 1-to-1 messaging ────────────────────────────────────────────────────

  // POST /v1/chat/messages
  router.post('/v1/chat/messages', async (req, res) => {
    const {
      senderId,
      receiverId,
      content,
      replyToId,
      forwardedFromId,
      sharedMediaId,
    } = req.body;
    if (!senderId || !receiverId || !content) {
      return res.status(400).json({ message: 'senderId, receiverId and content required' });
    }
    try {
      // Rate limit — sustained-abuse guard.
      const rl = checkRateLimit(senderId);
      if (!rl.ok) {
        return res.status(429).json({
          message:
            'Sending too fast. Please wait a moment before sending more messages.',
          retryAfterMs: rl.retryAfterMs,
        });
      }

      // Block + friends-only + orphaned-minor enforcement in one pair of
      // reads. Any of the three checks failing = refuse.
      let receiverIsHouseAccount = false;
      try {
        const [sender, receiver] = await Promise.all([
          require('../User/user.model').findById(senderId)
            .select('blockedUsers friends type guardianOrphaned').lean(),
          require('../User/user.model').findById(receiverId)
            .select('blockedUsers friends friendsOnly type guardianOrphaned isHouseAccount').lean(),
        ]);
        receiverIsHouseAccount = !!(receiver && receiver.isHouseAccount);
        // Enforce the SokaSoko-specific per-user rate limit (5 msg/hour)
        // BEFORE the general block/friends/orphan checks — support has to
        // be reachable but not floodable.
        if (receiverIsHouseAccount) {
          const houseRl = await checkHouseAccountRateLimit(senderId);
          if (!houseRl.ok) {
            return res.status(429).json({
              message: 'Umefikia kikomo cha ujumbe kwa SokaSoko kwa saa. Jaribu tena baadaye.',
              error: 'Umefikia kikomo cha ujumbe kwa SokaSoko kwa saa. Jaribu tena baadaye.',
              errorKey: 'chat.err.sokasoko_rate_limit',
              retryAfterMs: houseRl.retryAfterMs,
            });
          }
        }
        const senderBlocked = (receiver && receiver.blockedUsers || [])
          .some(id => String(id) === String(senderId));
        const receiverBlocked = (sender && sender.blockedUsers || [])
          .some(id => String(id) === String(receiverId));
        if (senderBlocked || receiverBlocked) {
          return res.status(403).json({ message: 'Message not delivered — user blocked.' });
        }
        // House account exemption: users must always be able to reach
        // customer support even if they're an orphaned minor or the
        // house account is friends-only (which it shouldn't be, but
        // belt + suspenders). All non-house recipients get the normal
        // orphan + friends-only enforcement below.
        if (!receiverIsHouseAccount) {
          const senderOrphaned = sender && ['PLAYER', 'REFEREE'].includes(sender.type) && sender.guardianOrphaned === true;
          const receiverOrphaned = receiver && ['PLAYER', 'REFEREE'].includes(receiver.type) && receiver.guardianOrphaned === true;
          if (senderOrphaned || receiverOrphaned) {
            return res.status(403).json({
              error: 'Huwezi kutuma ujumbe bila mlezi.',
              message: 'Huwezi kutuma ujumbe bila mlezi.',
              errorKey: 'gate.err.no_guardian_message',
            });
          }
          if (receiver && receiver.friendsOnly) {
            const isFriend = (receiver.friends || [])
              .some(id => String(id) === String(senderId));
            if (!isFriend) {
              return res.status(403).json({
                message:
                  'Message not delivered — recipient only accepts messages from their friends.',
              });
            }
          }
        }
      } catch (blockErr) {
        console.log('block/friends/orphan check failed:', blockErr.message);
      }

      // Wordlist scan — flagged messages still deliver but land in the
      // moderator queue for review.
      const scan = scanContent(content);

      const msg = await ChatMessage.create({
        sender: senderId,
        receiver: receiverId,
        content,
        read: false,
        replyTo: replyToId || null,
        forwardedFrom: forwardedFromId || null,
        sharedMedia: sharedMediaId || null,
        flagged: scan.flagged,
        flagReasons: scan.reasons,
      });
      const populated = await ChatMessage.findById(msg._id)
        .populate('sender', 'firstName lastName photo type')
        .populate('receiver', 'firstName lastName photo type')
        .populate({
          path: 'replyTo',
          select: 'sender content createdAt',
          populate: { path: 'sender', select: 'firstName lastName' },
        })
        .populate('forwardedFrom', 'firstName lastName')
        .populate({
          path: 'sharedMedia',
          select: 'title description url type createdBy',
          populate: { path: 'createdBy', select: 'firstName lastName profileImage' },
        })
        .lean();

      if (io) {
        io.to(String(receiverId)).emit('new_message', populated);
        io.to(String(senderId)).emit('new_message', populated);
      }

      // If the DM was to Ismaili, generate a reply in the background so
      // the HTTP response returns immediately. The reply lands over the
      // same socket channel and shows up in the user's inbox.
      if (ISMAILI_USER_ID && String(receiverId) === String(ISMAILI_USER_ID)) {
        generateAndPostIsmailiReply(io, {
          userMessageDoc: msg,
          populatedUser: populated,
        }).catch(err => console.log('Ismaili reply failed:', err.message));
      }

      // House-account side effects: fire the canned greeting on first
      // contact, and clear any prior "resolved" flag on the sender so
      // their new question shows back up in the admin inbox as open.
      if (receiverIsHouseAccount) {
        sendSokasokoGreetingIfFirstContact(io, receiverId, senderId)
          .catch((err) => console.log('[sokasoko] greeting err:', err.message));
        User.updateOne(
          { _id: senderId, sokasokoSupportResolvedAt: { $ne: null } },
          { $set: { sokasokoSupportResolvedAt: null } },
        ).catch((err) => console.log('[sokasoko] clear resolved err:', err.message));
      }

      return res.status(201).json(populated);
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  });

  // GET /v1/chat/messages?senderId=X&receiverId=Y&page=1&limit=30
  router.get('/v1/chat/messages', async (req, res) => {
    const { senderId, receiverId, page = 1, limit = 30 } = req.query;
    if (!senderId || !receiverId) {
      return res.status(400).json({ message: 'senderId and receiverId required' });
    }
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    try {
      const messages = await ChatMessage.find({
        $or: [
          { sender: senderId, receiver: receiverId },
          { sender: receiverId, receiver: senderId },
        ],
      })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit, 10))
        .populate('sender', 'firstName lastName photo')
        .populate('receiver', 'firstName lastName photo')
        .populate({
          path: 'replyTo',
          select: 'sender content createdAt',
          populate: { path: 'sender', select: 'firstName lastName' },
        })
        .populate('forwardedFrom', 'firstName lastName')
        .populate({
          path: 'sharedMedia',
          select: 'title description url type createdBy',
          populate: { path: 'createdBy', select: 'firstName lastName profileImage' },
        })
        .lean();
      return res.json({ data: messages.reverse() });
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  });

  // GET /v1/chat/unread/:userId
  router.get('/v1/chat/unread/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
      const count = await ChatMessage.countDocuments({ receiver: userId, read: false });
      return res.json({ count });
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  });

  // DELETE /v1/chat/messages/:id — sender may delete their own message.
  // Admin override: pass ?adminKey=<value> matching env ADMIN_KEY to
  // let a moderator remove any message regardless of sender.
  router.delete('/v1/chat/messages/:id', async (req, res) => {
    const { id } = req.params;
    const { userId, adminKey } = req.query;
    const envAdminKey = getString('ADMIN_KEY', '');
    const isAdmin = adminKey && envAdminKey && adminKey === envAdminKey;
    if (!userId && !isAdmin) {
      return res.status(400).json({ message: 'userId or admin credentials required' });
    }
    try {
      const msg = await ChatMessage.findById(id);
      if (!msg) return res.status(404).json({ message: 'not found' });
      if (!isAdmin && String(msg.sender) !== String(userId)) {
        return res.status(403).json({ message: 'not owner' });
      }
      await ChatMessage.deleteOne({ _id: id });
      if (io) {
        io.to(String(msg.receiver)).emit('message_deleted', { _id: id });
        io.to(String(msg.sender)).emit('message_deleted', { _id: id });
      }
      return res.json({ success: true, deletedByAdmin: !!isAdmin });
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  });

  // POST /v1/chat/mark-read
  router.post('/v1/chat/mark-read', async (req, res) => {
    const { userId, otherUserId } = req.body;
    if (!userId || !otherUserId) {
      return res.status(400).json({ message: 'userId and otherUserId required' });
    }
    try {
      await ChatMessage.updateMany(
        { sender: otherUserId, receiver: userId, read: false },
        { $set: { read: true, readAt: new Date() } }
      );
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ─── Group messaging ──────────────────────────────────────────────────────

  // POST /v1/chat/groups — create a group
  router.post('/v1/chat/groups', async (req, res) => {
    const { name, memberIds, createdBy, description } = req.body;
    if (!name || !createdBy || !Array.isArray(memberIds) || memberIds.length < 1) {
      return res.status(400).json({ message: 'name, createdBy and at least one memberId required' });
    }
    try {
      const members = [...new Set([createdBy, ...memberIds])];
      const group = await ChatGroup.create({ name, members, createdBy, description });
      const populated = await ChatGroup.findById(group._id)
        .populate('members', 'firstName lastName photo type')
        .populate('createdBy', 'firstName lastName')
        .lean();
      // Notify all members of the new group
      if (io) {
        members.forEach((memberId) => {
          io.to(String(memberId)).emit('group_created', populated);
        });
      }
      return res.status(201).json({ data: populated });
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  });

  // GET /v1/chat/groups/user/:userId — groups the user belongs to
  router.get('/v1/chat/groups/user/:userId', async (req, res) => {
    try {
      const groups = await ChatGroup.find({ members: req.params.userId })
        .populate('members', 'firstName lastName photo type')
        .populate('createdBy', 'firstName lastName')
        .sort({ updatedAt: -1 })
        .lean();
      return res.json({ data: groups });
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  });

  // POST /v1/chat/groups/:id/members — add members
  router.post('/v1/chat/groups/:id/members', async (req, res) => {
    const { memberIds } = req.body;
    if (!Array.isArray(memberIds) || memberIds.length === 0) {
      return res.status(400).json({ message: 'memberIds array required' });
    }
    try {
      const group = await ChatGroup.findByIdAndUpdate(
        req.params.id,
        { $addToSet: { members: { $each: memberIds } } },
        { new: true }
      ).populate('members', 'firstName lastName photo type').lean();
      if (!group) return res.status(404).json({ message: 'Group not found' });
      return res.json({ data: group });
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  });

  // DELETE /v1/chat/groups/:id/members/:memberId — remove a member
  router.delete('/v1/chat/groups/:id/members/:memberId', async (req, res) => {
    try {
      const group = await ChatGroup.findByIdAndUpdate(
        req.params.id,
        { $pull: { members: req.params.memberId } },
        { new: true }
      ).populate('members', 'firstName lastName photo type').lean();
      if (!group) return res.status(404).json({ message: 'Group not found' });
      return res.json({ data: group });
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  });

  // POST /v1/chat/group-messages — send a message to a group
  router.post('/v1/chat/group-messages', async (req, res) => {
    const { senderId, groupId, content } = req.body;
    if (!senderId || !groupId || !content) {
      return res.status(400).json({ message: 'senderId, groupId and content required' });
    }
    try {
      const group = await ChatGroup.findById(groupId).lean();
      if (!group) return res.status(404).json({ message: 'Group not found' });
      if (!group.members.map(String).includes(String(senderId))) {
        return res.status(403).json({ message: 'You are not a member of this group' });
      }

      const msg = await ChatMessage.create({
        sender: senderId,
        group: groupId,
        content,
        readBy: [senderId],
      });
      const populated = await ChatMessage.findById(msg._id)
        .populate('sender', 'firstName lastName photo type')
        .populate('group', 'name members')
        .lean();

      // Update group's updatedAt so it surfaces in sorted lists
      await ChatGroup.findByIdAndUpdate(groupId, { updatedAt: new Date() });

      // Emit to all group members
      if (io) {
        group.members.forEach((memberId) => {
          io.to(String(memberId)).emit('new_group_message', { ...populated, groupId });
        });
      }
      return res.status(201).json(populated);
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  });

  // GET /v1/chat/group-messages/:groupId?page=1&limit=30
  router.get('/v1/chat/group-messages/:groupId', async (req, res) => {
    const { page = 1, limit = 30 } = req.query;
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    try {
      const messages = await ChatMessage.find({ group: req.params.groupId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit, 10))
        .populate('sender', 'firstName lastName photo')
        .lean();
      return res.json({ data: messages.reverse() });
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  });

  // POST /v1/chat/group-messages/:groupId/mark-read
  router.post('/v1/chat/group-messages/:groupId/mark-read', async (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ message: 'userId required' });
    try {
      await ChatMessage.updateMany(
        { group: req.params.groupId, readBy: { $ne: userId } },
        { $addToSet: { readBy: userId } }
      );
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ─── Conversations list (1-to-1 + groups merged) ──────────────────────────

  // GET /v1/chat/conversations/:userId
  router.get('/v1/chat/conversations/:userId', async (req, res) => {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: 'Invalid userId' });
    }
    const uid = new mongoose.Types.ObjectId(userId);
    try {
      // 1-to-1 conversations
      const directConvs = await ChatMessage.aggregate([
        { $match: { $or: [{ sender: uid }, { receiver: uid }], group: null } },
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: { $cond: [{ $eq: ['$sender', uid] }, '$receiver', '$sender'] },
            lastMessage: { $first: '$$ROOT' },
            unreadCount: {
              $sum: {
                $cond: [
                  { $and: [{ $eq: ['$receiver', uid] }, { $eq: ['$read', false] }] },
                  1,
                  0,
                ],
              },
            },
          },
        },
        { $sort: { 'lastMessage.createdAt': -1 } },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'partner' } },
        { $unwind: '$partner' },
        {
          $project: {
            type: { $literal: 'direct' },
            partnerId: '$_id',
            partnerName: { $concat: [{ $ifNull: ['$partner.firstName', ''] }, ' ', { $ifNull: ['$partner.lastName', ''] }] },
            partnerPhoto: '$partner.photo',
            partnerType: '$partner.type',
            lastMessage: 1,
            unreadCount: 1,
          },
        },
      ]);

      // Group conversations
      const groups = await ChatGroup.find({ members: uid }).lean();
      const groupConvs = await Promise.all(
        groups.map(async (g) => {
          const lastMsg = await ChatMessage.findOne({ group: g._id })
            .sort({ createdAt: -1 })
            .populate('sender', 'firstName lastName')
            .lean();
          const unreadCount = await ChatMessage.countDocuments({
            group: g._id,
            sender: { $ne: uid },
            readBy: { $ne: uid },
          });
          return {
            type: 'group',
            _id: g._id,
            groupId: g._id,
            groupName: g.name,
            memberCount: g.members.length,
            lastMessage: lastMsg || null,
            unreadCount,
            updatedAt: g.updatedAt,
          };
        })
      );

      // Merge and sort by last activity
      const getTime = (conv) => {
        const t = conv.lastMessage?.createdAt || conv.updatedAt || new Date(0);
        return new Date(t).getTime();
      };
      const all = [...directConvs, ...groupConvs].sort((a, b) => getTime(b) - getTime(a));

      return res.json({ data: all });
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ─── SokaSoko Support Inbox (admin-only) ───────────────────────────────
  //
  // These endpoints power the mobile app's Support Console for admins:
  //   GET  /v1/chat/sokasoko/inbox?adminId=…      → list open conversations
  //   POST /v1/chat/sokasoko/reply                → reply-as-SokaSoko
  //   POST /v1/chat/sokasoko/resolve              → mark thread resolved
  //   POST /v1/chat/sokasoko/reopen               → clear the resolved flag
  //
  // Every endpoint verifies the caller carries isAdmin=true. That flag
  // is flipped manually in the DB (see scripts/grant-admin.js) — a
  // deliberate belt-and-suspenders control against a leaked APK.

  async function requireAdmin(req, res) {
    const adminId = req.query.adminId || req.body.adminId;
    if (!adminId) {
      res.status(400).json({ error: 'adminId is required' });
      return null;
    }
    const admin = await User.findById(adminId).select('isAdmin').lean();
    if (!admin || admin.isAdmin !== true) {
      res.status(403).json({ error: 'Admin access required' });
      return null;
    }
    return admin;
  }

  async function findHouseAccount() {
    return User.findOne({ isHouseAccount: true })
      .select('_id firstName lastName companyName').lean();
  }

  // GET /v1/chat/sokasoko/inbox?adminId=…&filter=open|resolved|all
  // Returns one row per user who has ever DM'd SokaSoko, with the
  // latest message + unread-count + resolved status. Default filter is
  // "open" — resolved threads are hidden unless explicitly requested.
  router.get('/v1/chat/sokasoko/inbox', async (req, res) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      const house = await findHouseAccount();
      if (!house) return res.status(404).json({ error: 'SokaSoko house account not seeded' });
      const filter = req.query.filter || 'open';

      // Aggregate all messages either direction between users and the
      // house account, group by the OTHER party, grab the latest message
      // per pair.
      const rows = await ChatMessage.aggregate([
        {
          $match: {
            $or: [
              { sender: house._id },
              { receiver: house._id },
            ],
          },
        },
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: {
              $cond: [
                { $eq: ['$sender', house._id] },
                '$receiver',
                '$sender',
              ],
            },
            lastMessage: { $first: '$$ROOT' },
            unreadFromUser: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ['$receiver', house._id] },
                      { $ne: ['$read', true] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            messageCount: { $sum: 1 },
          },
        },
      ]);

      const userIds = rows.map((r) => r._id).filter(Boolean);
      const users = await User.find({ _id: { $in: userIds } })
        .select('firstName lastName companyName academyName type accountNumber profileImage sokasokoSupportResolvedAt')
        .lean();
      const userById = new Map(users.map((u) => [String(u._id), u]));

      const enriched = rows.map((r) => {
        const u = userById.get(String(r._id));
        return {
          userId: String(r._id),
          user: u || null,
          lastMessage: r.lastMessage,
          unreadFromUser: r.unreadFromUser,
          messageCount: r.messageCount,
          resolvedAt: u ? u.sokasokoSupportResolvedAt : null,
        };
      });

      const visible = filter === 'all'
        ? enriched
        : enriched.filter((c) => filter === 'resolved'
            ? !!c.resolvedAt
            : !c.resolvedAt);
      visible.sort((a, b) => {
        const at = new Date(a.lastMessage?.createdAt || 0).getTime();
        const bt = new Date(b.lastMessage?.createdAt || 0).getTime();
        return bt - at;
      });

      return res.json({
        data: visible,
        houseAccountId: String(house._id),
        counts: {
          open: enriched.filter((c) => !c.resolvedAt).length,
          resolved: enriched.filter((c) => !!c.resolvedAt).length,
        },
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // POST /v1/chat/sokasoko/reply
  // Body: { adminId, userId, content }
  // Admin sends a message to `userId`; on the wire the sender is
  // stamped as the house account so the user only ever sees "SokaSoko"
  // in their inbox.
  router.post('/v1/chat/sokasoko/reply', async (req, res) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      const { userId, content } = req.body;
      if (!userId || !content || !content.trim()) {
        return res.status(400).json({ error: 'userId and content required' });
      }
      const house = await findHouseAccount();
      if (!house) return res.status(404).json({ error: 'SokaSoko house account not seeded' });

      const msg = await ChatMessage.create({
        sender: house._id,
        receiver: userId,
        content: content.trim(),
        read: false,
      });
      const populated = await ChatMessage.findById(msg._id)
        .populate('sender', 'firstName lastName companyName photo type')
        .populate('receiver', 'firstName lastName photo type')
        .lean();

      if (io) {
        io.to(String(userId)).emit('new_message', populated);
        io.to(String(house._id)).emit('new_message', populated);
      }
      return res.status(201).json(populated);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // POST /v1/chat/sokasoko/resolve   Body: { adminId, userId }
  router.post('/v1/chat/sokasoko/resolve', async (req, res) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      const { userId } = req.body;
      if (!userId) return res.status(400).json({ error: 'userId required' });
      await User.updateOne(
        { _id: userId },
        { $set: { sokasokoSupportResolvedAt: new Date() } },
      );
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // POST /v1/chat/sokasoko/reopen    Body: { adminId, userId }
  router.post('/v1/chat/sokasoko/reopen', async (req, res) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      const { userId } = req.body;
      if (!userId) return res.status(400).json({ error: 'userId required' });
      await User.updateOne(
        { _id: userId },
        { $set: { sokasokoSupportResolvedAt: null } },
      );
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // GET /v1/chat/sokasoko/account
  // Public — returns the house account's minimal identity so the mobile
  // app can render the "Contact SokaSoko" tile + open a chat with it.
  router.get('/v1/chat/sokasoko/account', async (req, res) => {
    try {
      const house = await findHouseAccount();
      if (!house) return res.status(404).json({ error: 'SokaSoko house account not seeded' });
      return res.json({ data: house });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  return router;
};
