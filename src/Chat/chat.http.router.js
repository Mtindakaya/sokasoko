const express = require('express');
const ChatMessage = require('./chat.model');
const mongoose = require('mongoose');

module.exports = function createChatRouter(io) {
  const router = express.Router();

  // POST /v1/chat/messages — save to DB first, then notify via socket
  router.post('/v1/chat/messages', async (req, res) => {
    const { senderId, receiverId, content } = req.body;
    if (!senderId || !receiverId || !content) {
      return res.status(400).json({ message: 'senderId, receiverId and content required' });
    }
    try {
      const msg = await ChatMessage.create({ sender: senderId, receiver: receiverId, content });
      const populated = await ChatMessage.findById(msg._id)
        .populate('sender', 'firstName lastName photo type')
        .populate('receiver', 'firstName lastName photo type')
        .lean();

      if (io) {
        io.to(String(receiverId)).emit('new_message', populated);
        io.to(String(senderId)).emit('new_message', populated);
      }

      return res.status(201).json(populated);
    } catch (err) {
      console.error('[Chat REST] send error:', err.message);
      return res.status(500).json({ message: err.message });
    }
  });

  // GET /v1/chat/conversations/:userId
  router.get('/v1/chat/conversations/:userId', async (req, res) => {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: 'Invalid userId' });
    }
    const uid = new mongoose.Types.ObjectId(userId);
    try {
      const conversations = await ChatMessage.aggregate([
        { $match: { $or: [{ sender: uid }, { receiver: uid }] } },
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
            partnerId: '$_id',
            partnerName: {
              $concat: [
                { $ifNull: ['$partner.firstName', ''] },
                ' ',
                { $ifNull: ['$partner.lastName', ''] },
              ],
            },
            partnerPhoto: '$partner.photo',
            partnerType: '$partner.type',
            lastMessage: 1,
            unreadCount: 1,
          },
        },
      ]);
      return res.json({ data: conversations });
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

  return router;
};
