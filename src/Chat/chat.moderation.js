// In-memory chat moderation helpers.
//
// - Rate limit: sliding-window per-user message counter (max N per M
//   seconds). Kept in-process to avoid a Redis dependency at MVP scale.
//   Resets on server restart which is acceptable — moderators care about
//   sustained abuse, not one bad minute across a restart.
//
// - Profanity/hate wordlist: minimal Swahili + English list. Whole-word
//   match (case-insensitive). Messages matching are flagged=true but
//   still delivered so moderators can review and act via the admin CMS.

const RATE_LIMIT_MAX = 30;      // messages
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // per 60 seconds

const _timestamps = new Map(); // userId -> [ms, ms, ...]

// English + Kiswahili wordlist. Keep short and only clear-cut. Nuance
// belongs in moderator review, not automated blocking.
const WORDLIST = [
  // Slurs / harassment (English)
  'fuck', 'shit', 'bitch', 'asshole', 'nigger', 'faggot',
  // Kiswahili offensive terms
  'mjinga', 'mshamba', 'malaya',
  // Threats
  'kill you', 'nitakuua', 'nitakupiga',
];

function checkRateLimit(userId) {
  const now = Date.now();
  const key = String(userId);
  const arr = (_timestamps.get(key) || []).filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  if (arr.length >= RATE_LIMIT_MAX) {
    _timestamps.set(key, arr); // no push
    return { ok: false, retryAfterMs: RATE_LIMIT_WINDOW_MS - (now - arr[0]) };
  }
  arr.push(now);
  _timestamps.set(key, arr);
  return { ok: true };
}

function scanContent(content) {
  if (!content || typeof content !== 'string') return { flagged: false, reasons: [] };
  const lower = content.toLowerCase();
  const hits = [];
  for (const word of WORDLIST) {
    // Whole-word-ish: bounded by non-word characters or string edges.
    const re = new RegExp(`(^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i');
    if (re.test(lower)) hits.push(word);
  }
  return { flagged: hits.length > 0, reasons: hits };
}

module.exports = { checkRateLimit, scanContent, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS };
