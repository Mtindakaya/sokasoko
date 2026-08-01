const express = require('express');
const axios = require('axios');
const { getString } = require('@lykmapipo/env');
const ChatMessage = require('./chat.model');
const ChatGroup = require('./chat_group.model');
const mongoose = require('mongoose');
const IsmailiConversation = require('../Ismaili/ismaili_conversation.model');
const User = require('../User/user.model');

const ISMAILI_USER_ID = getString('ISMAILI_USER_ID', '');
const ISMAILI_MODEL = getString('ISMAILI_MODEL', 'claude-haiku-4-5-20251001');

const ISMAILI_SYSTEM_PROMPT = [
  'You are Ismaili, the SokaSoko football knowledge assistant.',
  'LANGUAGE — Detect the language of each user turn and reply in the same language. Kiswahili in → Tanzania Kiswahili out; English in → English out; mixed in → mirror the mix. Standard English football terms (penalty, offside, winger, striker, cross, dribble, corner, etc.) stay in English even inside a Kiswahili reply. Use Tanzania Swahili register.',
  'Answer only football topics: playing skills, tactics, training, physiology, refereeing, scouting criteria, football history, and the rules of the game. If the user asks about the SokaSoko app itself, account issues, or anything unrelated to football, politely say you only handle football questions and suggest they tap the help/support link.',
  'Keep answers under 200 words unless asked for more. Use short paragraphs and bullet points. Be practical and encouraging.',
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
      // Block enforcement: either party blocking the other means no send.
      // Cheap two-doc read keyed by _id, using select so we don't drag the
      // full documents across the wire.
      try {
        const [sender, receiver] = await Promise.all([
          require('../User/user.model').findById(senderId).select('blockedUsers').lean(),
          require('../User/user.model').findById(receiverId).select('blockedUsers').lean(),
        ]);
        const senderBlocked = (receiver && receiver.blockedUsers || [])
          .some(id => String(id) === String(senderId));
        const receiverBlocked = (sender && sender.blockedUsers || [])
          .some(id => String(id) === String(receiverId));
        if (senderBlocked || receiverBlocked) {
          return res.status(403).json({ message: 'Message not delivered — user blocked.' });
        }
      } catch (blockErr) {
        // Non-fatal — if the block check itself failed, still send the
        // message rather than lock the user out. Log and continue.
        console.log('block check failed:', blockErr.message);
      }

      const msg = await ChatMessage.create({
        sender: senderId,
        receiver: receiverId,
        content,
        read: false,
        replyTo: replyToId || null,
        forwardedFrom: forwardedFromId || null,
        sharedMedia: sharedMediaId || null,
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

  // DELETE /v1/chat/messages/:id — sender may delete their own message
  router.delete('/v1/chat/messages/:id', async (req, res) => {
    const { id } = req.params;
    const { userId } = req.query;
    if (!userId) {
      return res.status(400).json({ message: 'userId required' });
    }
    try {
      const msg = await ChatMessage.findById(id);
      if (!msg) return res.status(404).json({ message: 'not found' });
      if (String(msg.sender) !== String(userId)) {
        return res.status(403).json({ message: 'not owner' });
      }
      await ChatMessage.deleteOne({ _id: id });
      if (io) {
        io.to(String(msg.receiver)).emit('message_deleted', { _id: id });
        io.to(String(msg.sender)).emit('message_deleted', { _id: id });
      }
      return res.json({ success: true });
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

  return router;
};
