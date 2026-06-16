const ChatMessage = require('./chat.model');
const ChatGroup = require('./chat_group.model');

module.exports = function attachChat(io) {
  io.on('connection', (socket) => {
    socket.on('join', (userId) => {
      if (!userId) return;
      socket.join(userId);
    });

    socket.on('send_message', async (payload) => {
      const { senderId, receiverId, content } = payload || {};
      if (!senderId || !receiverId || !content) return;
      try {
        const msg = await ChatMessage.create({ sender: senderId, receiver: receiverId, content });
        const populated = await ChatMessage.findById(msg._id)
          .populate('sender', 'firstName lastName photo type')
          .populate('receiver', 'firstName lastName photo type')
          .lean();
        io.to(receiverId).emit('new_message', populated);
        io.to(senderId).emit('new_message', populated);
      } catch (err) {
        socket.emit('message_error', { message: err.message });
      }
    });

    socket.on('send_group_message', async (payload) => {
      const { senderId, groupId, content } = payload || {};
      if (!senderId || !groupId || !content) return;
      try {
        const group = await ChatGroup.findById(groupId).lean();
        if (!group || !group.members.map(String).includes(String(senderId))) return;

        const msg = await ChatMessage.create({ sender: senderId, group: groupId, content, readBy: [senderId] });
        const populated = await ChatMessage.findById(msg._id)
          .populate('sender', 'firstName lastName photo type')
          .lean();

        await ChatGroup.findByIdAndUpdate(groupId, { updatedAt: new Date() });

        group.members.forEach((memberId) => {
          io.to(String(memberId)).emit('new_group_message', { ...populated, groupId });
        });
      } catch (err) {
        socket.emit('message_error', { message: err.message });
      }
    });

    socket.on('typing', ({ senderId, receiverId } = {}) => {
      if (receiverId) io.to(receiverId).emit('typing', { senderId });
    });

    socket.on('stop_typing', ({ senderId, receiverId } = {}) => {
      if (receiverId) io.to(receiverId).emit('stop_typing', { senderId });
    });

    socket.on('group_typing', ({ senderId, groupId, groupMembers } = {}) => {
      if (!groupId || !groupMembers) return;
      groupMembers.forEach((memberId) => {
        if (String(memberId) !== String(senderId)) {
          io.to(String(memberId)).emit('group_typing', { senderId, groupId });
        }
      });
    });

    socket.on('mark_read', async ({ userId, otherUserId } = {}) => {
      if (!userId || !otherUserId) return;
      await ChatMessage.updateMany(
        { sender: otherUserId, receiver: userId, read: false },
        { $set: { read: true, readAt: new Date() } }
      );
      io.to(userId).emit('messages_read', { otherUserId });
    });

    socket.on('disconnect', () => {});
  });
};
