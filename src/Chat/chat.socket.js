const ChatMessage = require('./chat.model');

module.exports = function attachChat(io) {
  console.log('[Chat] Socket.io attached — waiting for connections');

  io.on('connection', (socket) => {
    console.log(`[Chat] client connected: ${socket.id}`);

    socket.on('join', (userId) => {
      if (!userId) return;
      socket.join(userId);
      console.log(`[Chat] ${socket.id} joined room: ${userId}`);
    });

    socket.on('send_message', async (payload) => {
      console.log('[Chat] send_message received:', payload);
      const { senderId, receiverId, content } = payload || {};
      if (!senderId || !receiverId || !content) {
        console.log('[Chat] send_message missing fields — ignored');
        return;
      }

      try {
        const msg = await ChatMessage.create({ sender: senderId, receiver: receiverId, content });
        console.log(`[Chat] message saved: ${msg._id}`);

        const populated = await ChatMessage.findById(msg._id)
          .populate('sender', 'firstName lastName photo type')
          .populate('receiver', 'firstName lastName photo type')
          .lean();

        console.log(`[Chat] emitting new_message to rooms: ${receiverId} and ${senderId}`);
        io.to(receiverId).emit('new_message', populated);
        io.to(senderId).emit('new_message', populated);
      } catch (err) {
        console.error('[Chat] send_message error:', err.message);
        socket.emit('message_error', { message: err.message });
      }
    });

    socket.on('typing', ({ senderId, receiverId } = {}) => {
      if (receiverId) io.to(receiverId).emit('typing', { senderId });
    });

    socket.on('stop_typing', ({ senderId, receiverId } = {}) => {
      if (receiverId) io.to(receiverId).emit('stop_typing', { senderId });
    });

    socket.on('mark_read', async ({ userId, otherUserId } = {}) => {
      if (!userId || !otherUserId) return;
      await ChatMessage.updateMany(
        { sender: otherUserId, receiver: userId, read: false },
        { $set: { read: true, readAt: new Date() } }
      );
      io.to(userId).emit('messages_read', { otherUserId });
    });

    socket.on('disconnect', (reason) => {
      console.log(`[Chat] client disconnected: ${socket.id} reason: ${reason}`);
    });
  });
};
