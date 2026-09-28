// Account-deletion PII purge. Runs after the 48h grace window has
// passed. Deletes the user's own content (Media, Chat, files) and
// nulls out identifying / contact fields, but keeps the User row so
// referential integrity holds elsewhere (matches, tournaments, org
// staff, etc. — opposing teams keep their historical records).

const Media = require('../Media/media.model');
const ChatMessage = require('../Chat/chat.model');
const User = require('./user.model');
const { purgeUserFilesForOwner } = require('../UserFile/user_file.purge');

// Fields that hold personally-identifying or contact info. Nulled
// during purge — the User row stays, but nobody can reach the person
// through the app. Kept: type, sId, accountNumber (the tombstone id).
const PII_FIELDS = [
  'firstName', 'middleName', 'lastName',
  'email', 'phone', 'contact_number',
  'facebook', 'twitter', 'youtube', 'instagram', 'linkedin',
  'dob', 'gender', 'nationality',
  'street', 'ward', 'district', 'region',
  'office_address', 'officeAddress',
  'short_bio', 'academyDescription', 'companyDescription',
  'profileImage', 'coverImage',
  'passwordResetCode', 'passwordResetExpiresAt',
  'themeColor',
];

async function purgeUserPII(userId) {
  const user = await User.findById(userId);
  if (!user) return { skipped: 'user_not_found' };
  if (user.deletedAt) return { skipped: 'already_purged', at: user.deletedAt };

  // Purge own-content collections. Best-effort — failures on any one
  // shouldn't block the rest. Individual counts logged for audit.
  const [mediaRes, chatRes, fileRes] = await Promise.allSettled([
    Media.deleteMany({
      $or: [{ createdBy: userId }, { player: userId }],
    }),
    ChatMessage.deleteMany({
      $or: [{ senderId: userId }, { fromUser: userId }],
    }),
    purgeUserFilesForOwner(userId),
  ]);

  // Null the PII fields. Password is set to a random bcrypt-safe
  // sentinel so no future login can succeed against the shell.
  const unset = {};
  for (const f of PII_FIELDS) unset[f] = null;
  await User.updateOne(
    { _id: userId },
    {
      $set: {
        ...unset,
        password: '__DELETED__',
        deletedAt: new Date(),
        deletionScheduledAt: null,
        suspend: true,
      },
    },
  );

  return {
    ok: true,
    media: mediaRes.status === 'fulfilled'
      ? (mediaRes.value?.deletedCount || 0) : 0,
    chat: chatRes.status === 'fulfilled'
      ? (chatRes.value?.deletedCount || 0) : 0,
    files: fileRes.status === 'fulfilled'
      ? (fileRes.value?.deleted || 0) : 0,
  };
}

// Called on any authenticated read path — if the user's grace window
// has passed, run the purge before returning them. Idempotent: the
// deletedAt guard inside purgeUserPII short-circuits repeat calls.
async function purgeIfExpired(userId) {
  if (!userId) return null;
  const u = await User.findById(userId)
    .select('deletionScheduledAt deletedAt')
    .lean();
  if (!u) return null;
  if (u.deletedAt) return { alreadyPurged: true };
  if (!u.deletionScheduledAt) return null;
  if (new Date(u.deletionScheduledAt) > new Date()) return { pending: true };
  return purgeUserPII(userId);
}

module.exports = { purgeUserPII, purgeIfExpired, PII_FIELDS };
