// Push notification transport. Wraps firebase-admin so callers don't
// have to know about tokens, batching, or pruning.
//
// Phase A (current): firebase-admin is optional. If FIREBASE_CREDENTIALS_JSON
// (or GOOGLE_APPLICATION_CREDENTIALS) is unset, sendPush() no-ops and
// logs — inbox writes continue to work, only device push is skipped.
// Phase B: drop the service-account JSON into env, install firebase-admin,
// pushes start firing without any other code changes.

const mongoose = require('mongoose');

let admin = null;
let initTried = false;

function initFirebase() {
  if (initTried) return admin;
  initTried = true;
  try {
    // eslint-disable-next-line global-require, import/no-unresolved
    admin = require('firebase-admin');
    const raw = process.env.FIREBASE_CREDENTIALS_JSON;
    if (raw) {
      const cred = JSON.parse(raw);
      admin.initializeApp({ credential: admin.credential.cert(cred) });
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      admin.initializeApp();
    } else {
      console.warn('[push] firebase-admin loaded but no credentials — push disabled');
      admin = null;
    }
  } catch (err) {
    console.warn('[push] firebase-admin not installed — push disabled:', err.message);
    admin = null;
  }
  return admin;
}

// Quiet-hours check. Uses UTC HH:mm compared naively against the
// user-stored window (also HH:mm). Good enough for beta — timezone
// support comes when we ship the settings screen v2.
function isInQuietWindow(prefs) {
  const start = prefs && prefs.push && prefs.push.quietStart;
  const end = prefs && prefs.push && prefs.push.quietEnd;
  if (!start || !end) return false;
  const now = new Date();
  const hhmm = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`;
  if (start <= end) return hhmm >= start && hhmm < end;
  // window wraps midnight
  return hhmm >= start || hhmm < end;
}

// Category → prefs key map. Callers pass the category (e.g. 'myMatches')
// and this decides whether to push based on the user's toggles.
// Moderation always pushes regardless of prefs.
const ALWAYS_PUSH = new Set(['moderation']);

async function sendPush({
  userId,
  category,
  title,
  body,
  titleKey = '',
  bodyKey = '',
  params = {},
  data = {},
}) {
  if (!userId || !category) return { skipped: true, reason: 'missing_args' };
  const User = mongoose.model('User');
  const user = await User.findById(userId)
    .select('notificationPrefs')
    .lean();
  if (!user) return { skipped: true, reason: 'no_user' };
  const prefs = user.notificationPrefs || {};
  const master = !prefs.push || prefs.push.enabled !== false;
  const category_enabled =
    !prefs.categories || prefs.categories[category] !== false;
  if (!ALWAYS_PUSH.has(category) && (!master || !category_enabled)) {
    return { skipped: true, reason: 'muted' };
  }
  if (!ALWAYS_PUSH.has(category) && isInQuietWindow(prefs)) {
    // For beta we drop quiet-hours pushes silently; queueing them for
    // later delivery requires a scheduler and can wait.
    return { skipped: true, reason: 'quiet_hours' };
  }
  const DeviceToken = mongoose.model('DeviceToken');
  const rows = await DeviceToken.find({ userId }).select('token platform').lean();
  if (!rows.length) return { skipped: true, reason: 'no_tokens' };

  const client = initFirebase();
  if (!client) {
    // Push transport not configured yet — inbox already handled by
    // caller, so this is a clean no-op.
    return { skipped: true, reason: 'no_transport', tokens: rows.length };
  }
  const message = {
    tokens: rows.map((r) => r.token),
    notification: { title: title || '', body: body || '' },
    data: {
      titleKey: String(titleKey || ''),
      bodyKey: String(bodyKey || ''),
      params: JSON.stringify(params || {}),
      category: String(category),
      ...Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)]),
      ),
    },
    android: { priority: 'high' },
    apns: { headers: { 'apns-priority': '10' } },
  };
  try {
    const res = await client.messaging().sendEachForMulticast(message);
    // Prune invalid tokens so we stop trying to reach dead installs.
    const dead = [];
    res.responses.forEach((r, i) => {
      if (r.success) return;
      const code = r.error && r.error.code;
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-argument' ||
        code === 'messaging/invalid-registration-token'
      ) {
        dead.push(rows[i].token);
      }
    });
    if (dead.length) {
      await DeviceToken.deleteMany({ token: { $in: dead } });
    }
    return {
      sent: res.successCount,
      failed: res.failureCount,
      pruned: dead.length,
    };
  } catch (err) {
    console.error('[push] send failed for user', String(userId), err.message);
    return { skipped: true, reason: 'send_error' };
  }
}

module.exports = { sendPush };
