const {
  getByIdFor,
  getFor,
  deleteFor,
  Router,
  postFor,
  patchFor,
  putFor,
  schemaFor,
} = require('@lykmapipo/express-rest-actions');
const { getString } = require('@lykmapipo/env');

const API_VERSION = getString('API_VERSION', '1.0.0');
const PATH_SINGLE = '/playlists/:id';
const PATH_LIST = '/playlists';
const PATH_SCHEMA = '/playlists/schema/';

const Playlist = require('./playlist.model');
const User = require('../User/user.model');
const Media = require('../Media/media.model');
const { Subscription } = require('../Subscription/subscription.model');
const { uploadFor } = require('../Utils/uploader');
const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

// Sponsor tiers allowed to attach a brand color to their challenge.
// GOLD sponsors can still be attached (name + logo render); only the
// color override is gated behind PLATINUM / ENTERPRISE.
const BRAND_COLOR_TIERS = new Set(['PLATINUM', 'ENTERPRISE']);
// Simple hex-color validator (#RGB or #RRGGBB). Server discards
// anything that doesn't match.
const HEX_COLOR_RE = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

const router = new Router({ version: API_VERSION });

const isScheduledNow = (sessions = []) => {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const dayNames = ['sun','mon','tue','wed','thu','fri','sat'];
  const today = dayNames[now.getDay()];
  return sessions.some(({ startTime, durationMinutes, days }) => {
    const [h, m] = (startTime || '0:0').split(':').map(Number);
    const start = h * 60 + m;
    const end = start + (durationMinutes || 0);
    const dayMatch = !days || days.length === 0 || days.includes(today);
    return dayMatch && currentMinutes >= start && currentMinutes < end;
  });
};

const withEffectiveOverride = (playlist, userId) => {
  if (!playlist) return null;
  const obj = playlist.toObject ? playlist.toObject() : { ...playlist };
  obj.effectiveOverride = obj.globalOverride || isScheduledNow(obj.scheduledSessions);
  let viewerHasVoted = false;
  if (obj.videos) {
    obj.videos = obj.videos.map(v => {
      const votes = v.votes || [];
      const likes = v.likes || [];
      const voteCount = votes.length;
      const averageScore = voteCount > 0
        ? Math.round((votes.reduce((s, vt) => s + vt.score, 0) / voteCount) * 10) / 10
        : null;
      const myVoteEntry = userId
        ? votes.find(vt => vt.userId && vt.userId.toString() === userId.toString())
        : null;
      const myVote = myVoteEntry != null ? myVoteEntry.score : null;
      if (myVote != null) viewerHasVoted = true;
      const iLiked = userId ? likes.some(id => id.toString() === userId.toString()) : false;
      return { ...v, likesCount: likes.length, voteCount, averageScore, myVote, iLiked };
    });
  }
  // Single vote on any video in the challenge = viewer's carousel
  // unlocks (their own videos resume). Client checks
  // (globalOverride && !viewerHasVoted) to decide which set to render.
  obj.viewerHasVoted = viewerHasVoted;
  return obj;
};

// ── Specific GET routes BEFORE /:id to avoid param capture ───────────────────

// GET /v1/playlists/active
// Audience routing:
//   - No userId → return the first isActive playlist (legacy behavior).
//   - With userId → look up the caller's type. Prefer an audience-scoped
//     active playlist whose targetAudiences includes their type; fall
//     back to a broadcast active playlist (targetAudiences empty).
router.get('/playlists/active', async (req, res) => {
  try {
    const { userId } = req.query;
    let userType = null;
    if (userId) {
      const u = await User.findById(userId).select('type').lean();
      if (u) userType = u.type;
    }
    const SPONSOR_SELECT =
      'firstName lastName academy_name company_name entity_name type profileImage themeColor';
    let playlist = null;
    if (userType) {
      playlist = await Playlist.findOne({
        isActive: true,
        targetAudiences: userType,
      })
        .populate('sponsor', SPONSOR_SELECT)
        .populate({
          path: 'videos',
          populate: { path: 'player', select: 'firstName lastName accountNumber profileImage' },
        });
    }
    if (!playlist) {
      // Broadcast fallback (or no-user-context legacy).
      playlist = await Playlist.findOne({
        isActive: true,
        $or: [
          { targetAudiences: { $exists: false } },
          { targetAudiences: { $size: 0 } },
        ],
      })
        .populate('sponsor', SPONSOR_SELECT)
        .populate({
          path: 'videos',
          populate: { path: 'player', select: 'firstName lastName accountNumber profileImage' },
        });
    }
    if (!playlist) return res.status(404).json({ error: 'No active playlist' });
    return res.status(200).json(withEffectiveOverride(playlist, userId));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Challenge briefs ────────────────────────────────────────────────────────
// A brief is an admin-authored preamble that runs for `durationDays`
// BEFORE the challenge opens for submissions. Either a reference video
// or written instructions must be provided (or both). While the brief is
// live, submissions to that playlist are blocked (enforced elsewhere).

const MIN_BRIEF_DAYS = 1;
const MAX_BRIEF_DAYS = 30;
const DEFAULT_BRIEF_DAYS = 7;

function clampDays(raw) {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return DEFAULT_BRIEF_DAYS;
  return Math.max(MIN_BRIEF_DAYS, Math.min(MAX_BRIEF_DAYS, n));
}

// POST /v1/playlists/with-brief — create a NEW playlist and attach a
// brief atomically. Multipart: optional `video` file becomes a Media doc
// referenced by brief.video. Body: title, description?, instructions?,
// durationDays?, source?, recommendedBy?, createdBy, sponsor?,
// sponsorBrandColor?, targetAudiences?.
router.post('/playlists/with-brief', uploadFor(), async (req, res) => {
  try {
    const {
      title,
      description = '',
      instructions = '',
      durationDays,
      source = 'SOKASOKO',
      recommendedBy = null,
      createdBy = null,
      sponsor = null,
      sponsorBrandColor = '',
      targetAudiences,
    } = req.body;

    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: 'title is required' });
    }
    if (!createdBy) {
      return res.status(400).json({ error: 'createdBy is required' });
    }
    // Admin can attach ONE piece of media via three routes:
    //   1. multipart file 'video'  → Media type 'Video'
    //   2. multipart file 'image'  → Media type 'Image'
    //   3. body field 'videoUrl'   → Media type 'Link' (YouTube etc.)
    // uploadFor rewrites files into req.body[fieldname] = <public url>.
    // Precedence when >1 is sent: uploaded video > uploaded image > url.
    const uploadedVideoUrl =
      typeof req.body.video === 'string' && req.body.video.trim().length > 0
        ? req.body.video.trim()
        : null;
    const uploadedImageUrl =
      typeof req.body.image === 'string' && req.body.image.trim().length > 0
        ? req.body.image.trim()
        : null;
    const externalVideoUrl =
      typeof req.body.videoUrl === 'string' && req.body.videoUrl.trim().length > 0
        ? req.body.videoUrl.trim()
        : null;
    const hasInstructions = String(instructions || '').trim().length > 0;
    const hasAttachment = !!(uploadedVideoUrl || uploadedImageUrl || externalVideoUrl);
    if (!hasAttachment && !hasInstructions) {
      return res.status(400).json({
        error: 'Provide a brief video, image, video URL, or instructions',
      });
    }
    // recommendedBy must resolve to a real user _id (stored as ObjectId
    // ref on brief.recommendedBy). Accept either a 24-hex _id from the
    // Platinum picker, or a raw accountNumber the admin typed (e.g.
    // 'TFH-V-A000173') for the non-Platinum override path. Anything
    // else 400s cleanly instead of leaking a Mongoose cast 500.
    let resolvedRecommendedBy = null;
    if (source === 'RECOMMENDATION') {
      const raw = String(recommendedBy || '').trim();
      if (!raw) {
        return res.status(400).json({
          error: 'recommendedBy is required for RECOMMENDATION source (pick from the Platinum list or enter an account number).',
        });
      }
      if (OBJECT_ID_RE.test(raw)) {
        resolvedRecommendedBy = raw;
      } else {
        const found = await User.findOne({ accountNumber: raw })
          .select('_id')
          .lean();
        if (!found) {
          return res.status(400).json({
            error: `recommendedBy not found: no user with _id or accountNumber "${raw}".`,
          });
        }
        resolvedRecommendedBy = found._id;
      }
    }

    let briefVideoId = null;
    let attachUrl = null;
    let attachType = null;
    if (uploadedVideoUrl) { attachUrl = uploadedVideoUrl; attachType = 'Video'; }
    else if (uploadedImageUrl) { attachUrl = uploadedImageUrl; attachType = 'Image'; }
    else if (externalVideoUrl) { attachUrl = externalVideoUrl; attachType = 'Link'; }

    if (attachUrl) {
      const media = await Media.create({
        title: `[Brief] ${String(title).trim()}`,
        description: hasInstructions ? String(instructions).trim() : '',
        url: attachUrl,
        type: attachType,
        createdBy,
        isPlaylist: false,
      });
      briefVideoId = media._id;
    }

    const days = clampDays(durationDays);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    let cleanAudiences = [];
    if (Array.isArray(targetAudiences)) {
      const allowed = new Set(['PLAYER','COACH','GUARDIAN','ACADEMY','SCHOOL','VENDOR','CLUB','SPONSOR','AGENT','REFEREE','SCOUT','FIELD_OWNER']);
      cleanAudiences = targetAudiences.filter((t) => allowed.has(t));
    }

    const cleanSponsorBrandColor =
      sponsorBrandColor && HEX_COLOR_RE.test(sponsorBrandColor)
        ? sponsorBrandColor
        : '';

    const playlist = await Playlist.create({
      title: String(title).trim(),
      description,
      videos: [],
      isActive: false,
      globalOverride: false,
      votingEnabled: false,
      sponsor: sponsor || null,
      sponsorBrandColor: cleanSponsorBrandColor,
      targetAudiences: cleanAudiences,
      brief: {
        video: briefVideoId,
        instructions: hasInstructions ? String(instructions).trim() : '',
        createdBy,
        source: ['SOKASOKO', 'RECOMMENDATION'].includes(source)
          ? source
          : 'SOKASOKO',
        recommendedBy: source === 'RECOMMENDATION' ? resolvedRecommendedBy : null,
        publishedAt: now,
        expiresAt,
        showOnHome: true,
        carouselWeight: 1,
      },
    });

    const populated = await Playlist.findById(playlist._id).populate('brief.video');
    return res.status(201).json(populated);
  } catch (err) {
    console.error('[POST /v1/playlists/with-brief] failed:', err);
    return res.status(500).json({
      error: err.message,
      name: err.name,
      // ValidationError adds .errors — pull out the first field-specific
      // message so the client toast is actionable ("type: 'Video' is not
      // a valid enum" rather than a generic 500).
      details: err.errors
        ? Object.entries(err.errors).map(([k, v]) => `${k}: ${v.message}`).join('; ')
        : undefined,
    });
  }
});

// PATCH /v1/playlists/:id/brief — edit brief fields on an existing playlist.
// Body: any subset of { instructions, durationDays, showOnHome,
// carouselWeight }. `durationDays` re-computes expiresAt from NOW so admin
// can extend or shorten the preview window.
router.patch('/playlists/:id/brief', async (req, res) => {
  try {
    const { instructions, durationDays, showOnHome, carouselWeight } = req.body;
    const update = {};
    if (typeof instructions === 'string') {
      update['brief.instructions'] = instructions.trim();
    }
    if (durationDays !== undefined) {
      const days = clampDays(durationDays);
      update['brief.expiresAt'] = new Date(
        Date.now() + days * 24 * 60 * 60 * 1000,
      );
    }
    if (typeof showOnHome === 'boolean') update['brief.showOnHome'] = showOnHome;
    if (typeof carouselWeight === 'number') {
      update['brief.carouselWeight'] = Math.max(0, Math.min(5, carouselWeight));
    }
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: 'No brief fields provided' });
    }
    const playlist = await Playlist.findByIdAndUpdate(
      req.params.id,
      update,
      { new: true },
    ).populate('brief.video');
    if (!playlist) return res.status(404).json({ error: 'Playlist not found' });
    return res.status(200).json(playlist);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /v1/playlists/:id/brief — end the brief preview early. Sets
// expiresAt to now so submissions can open immediately.
router.delete('/playlists/:id/brief', async (req, res) => {
  try {
    const playlist = await Playlist.findByIdAndUpdate(
      req.params.id,
      { 'brief.expiresAt': new Date() },
      { new: true },
    ).populate('brief.video');
    if (!playlist) return res.status(404).json({ error: 'Playlist not found' });
    return res.status(200).json(playlist);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/playlists/briefs — admin console list of every playlist that
// carries a brief, live or ended. Sorted newest published first so the
// CMS Brief Challenges page shows current on top, archive below.
router.get('/playlists/briefs', async (req, res) => {
  try {
    const now = new Date();
    const rows = await Playlist.find({ 'brief.publishedAt': { $ne: null } })
      .sort({ 'brief.publishedAt': -1 })
      .populate('brief.video')
      .populate('brief.createdBy', 'firstName lastName accountNumber isAdmin')
      .populate('brief.recommendedBy', 'firstName lastName accountNumber');
    const items = rows.map((p) => {
      const obj = p.toObject({ getters: true });
      const exp = obj.brief && obj.brief.expiresAt
        ? new Date(obj.brief.expiresAt)
        : null;
      obj.brief.state = exp && exp > now ? 'live' : 'ended';
      return obj;
    });
    return res.status(200).json({ data: items });
  } catch (err) {
    console.error('[GET /v1/playlists/briefs] failed:', err);
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/playlists/active/brief — the currently-running brief for
// Home / carousel rendering. Returns null when no brief is active.
router.get('/playlists/active/brief', async (req, res) => {
  try {
    const now = new Date();
    const playlist = await Playlist.findOne({
      'brief.publishedAt': { $ne: null },
      'brief.expiresAt': { $gt: now },
    })
      .sort({ 'brief.publishedAt': -1 })
      .populate('brief.video');
    if (!playlist) return res.status(200).json({ data: null });
    return res.status(200).json({ data: playlist });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/playlists/active/challenge — start or close a challenge in one action.
// `close` expires any live brief so the mobile home banner clears, and
// turns off voting + global override so the challenge stops taking over
// the carousel. It deliberately does NOT flip isActive:false — the
// playlist stays alive as the user-account carousel's system-content
// fallback (users with no personal media still see something to play).
// Admin can fully deactivate via the CMS "Deactivate" button.
router.post('/playlists/active/challenge', async (req, res) => {
  try {
    const { action } = req.body; // 'start' | 'close'
    if (!['start', 'close'].includes(action)) return res.status(400).json({ error: 'action must be start or close' });
    const update = action === 'start'
      ? { votingEnabled: true, globalOverride: true }
      : {
          votingEnabled: false,
          globalOverride: false,
          'brief.expiresAt': new Date(),
        };
    const playlist = await Playlist.findOneAndUpdate({ isActive: true }, update, { new: true });
    if (!playlist) return res.status(404).json({ error: 'No active playlist' });
    return res.status(200).json(withEffectiveOverride(playlist));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/playlists/:id/deactivate — CMS manual toggle counterpart to
// /:id/activate. Turns off the active flag + voting + global override
// so the playlist stops running everywhere.
router.post('/playlists/:id/deactivate', async (req, res) => {
  try {
    const playlist = await Playlist.findByIdAndUpdate(
      req.params.id,
      { isActive: false, votingEnabled: false, globalOverride: false },
      { new: true },
    );
    if (!playlist) return res.status(404).json({ error: 'Playlist not found' });
    return res.status(200).json(playlist);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /v1/playlists/active/info — update title and/or description of the active playlist
router.patch('/playlists/active/info', async (req, res) => {
  try {
    const { title, description } = req.body;
    const update = {};
    if (title && title.trim()) update.title = title.trim();
    if (description !== undefined) update.description = description;
    const playlist = await Playlist.findOneAndUpdate({ isActive: true }, update, { new: true });
    if (!playlist) return res.status(404).json({ error: 'No active playlist' });
    return res.status(200).json(withEffectiveOverride(playlist));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /v1/playlists/:id/audiences — replace the targetAudiences list
// on any playlist (active or not). Body: { targetAudiences: [<type>...] }
router.patch('/playlists/:id/audiences', async (req, res) => {
  try {
    const raw = req.body.targetAudiences;
    if (!Array.isArray(raw)) {
      return res.status(400).json({ error: 'targetAudiences must be an array' });
    }
    const allowed = new Set(['PLAYER','COACH','GUARDIAN','ACADEMY','SCHOOL','VENDOR','CLUB','SPONSOR','AGENT','REFEREE','SCOUT','FIELD_OWNER']);
    const clean = raw.filter(t => allowed.has(t));
    const playlist = await Playlist.findByIdAndUpdate(
      req.params.id,
      { targetAudiences: clean },
      { new: true },
    );
    if (!playlist) return res.status(404).json({ error: 'Playlist not found' });
    return res.status(200).json(playlist);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/playlists/media-library
router.get('/playlists/media-library', async (req, res) => {
  try {
    const media = await Media.find({ isPlaylist: true })
      .select('title description url type player createdAt')
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    return res.status(200).json({ data: media });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/playlists/override-players
router.get('/playlists/override-players', async (req, res) => {
  try {
    const players = await User.find({ playlistOverride: true })
      .select('firstName lastName accountNumber profileImage type')
      .lean();
    return res.status(200).json({ data: players });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Generic CRUD routes (/:id param must come after all specific paths) ───────
router.get(PATH_SCHEMA, schemaFor({ getSchema: (query, done) => done(null, Playlist.jsonSchema()) }));
router.get(PATH_LIST, getFor({ get: (options, done) => Playlist.get(options, done) }));
router.get(PATH_SINGLE, getByIdFor({ getById: (options, done) => Playlist.get(options, done) }));
router.post(PATH_LIST, postFor({ post: async (body, done) => Playlist.post(body, done) }));

// PUT /v1/playlists/active/schedule — save scheduled sessions on the active playlist
router.put('/playlists/active/schedule', async (req, res) => {
  try {
    const { scheduledSessions } = req.body;
    if (!Array.isArray(scheduledSessions)) return res.status(400).json({ error: 'scheduledSessions must be an array' });
    const playlist = await Playlist.findOneAndUpdate(
      { isActive: true },
      { scheduledSessions },
      { new: true }
    );
    if (!playlist) return res.status(404).json({ error: 'No active playlist' });
    return res.status(200).json(withEffectiveOverride(playlist));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/playlists/active/voting — toggle voting on the active playlist
router.post('/playlists/active/voting', async (req, res) => {
  try {
    const { enabled } = req.body;
    const playlist = await Playlist.findOneAndUpdate(
      { isActive: true },
      { votingEnabled: !!enabled },
      { new: true }
    );
    if (!playlist) return res.status(404).json({ error: 'No active playlist' });
    return res.status(200).json(withEffectiveOverride(playlist));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/medias/:id/aspect — cache a video's natural dimensions
// so subsequent viewers can render at the right aspect from the
// first paint (no probe, no dark-frame load-in). Idempotent write —
// re-sending the same w/h is a no-op. Silently drops implausible
// values (< 16 or > 8192 in either dimension).
router.post('/medias/:id/aspect', async (req, res) => {
  try {
    const w = Number(req.body?.w);
    const h = Number(req.body?.h);
    if (!Number.isFinite(w) || !Number.isFinite(h)) {
      return res.status(400).json({ error: 'w and h required' });
    }
    if (w < 16 || h < 16 || w > 8192 || h > 8192) {
      return res.status(400).json({ error: 'implausible dimensions' });
    }
    await Media.findByIdAndUpdate(req.params.id, {
      videoWidth: Math.round(w),
      videoHeight: Math.round(h),
    });
    return res.status(200).json({ data: { videoWidth: w, videoHeight: h } });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/medias/:id/like — binary like (always available)
router.post('/medias/:id/like', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const media = await Media.findByIdAndUpdate(req.params.id, { $addToSet: { likes: userId } }, { new: true });
    if (!media) return res.status(404).json({ error: 'Media not found' });
    return res.status(200).json({ likesCount: media.likes.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /v1/medias/:id/like — remove like
router.delete('/medias/:id/like', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const media = await Media.findByIdAndUpdate(req.params.id, { $pull: { likes: userId } }, { new: true });
    if (!media) return res.status(404).json({ error: 'Media not found' });
    return res.status(200).json({ likesCount: media.likes.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/medias/:id/vote — submit or update a score vote (0–10)
router.post('/medias/:id/vote', async (req, res) => {
  try {
    const { userId, score } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    if (score === undefined || score === null) return res.status(400).json({ error: 'score required' });
    const s = Number(score);
    if (isNaN(s) || s < 0 || s > 10) return res.status(400).json({ error: 'score must be 0–10' });
    // Remove any existing vote from this user, then push the new score
    await Media.findByIdAndUpdate(req.params.id, { $pull: { votes: { userId } } });
    const media = await Media.findByIdAndUpdate(
      req.params.id,
      { $push: { votes: { userId, score: s } } },
      { new: true }
    );
    if (!media) return res.status(404).json({ error: 'Media not found' });
    const voteCount = media.votes.length;
    const averageScore = voteCount > 0
      ? Math.round((media.votes.reduce((sum, v) => sum + v.score, 0) / voteCount) * 10) / 10
      : 0;
    return res.status(200).json({ voteCount, averageScore });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /v1/playlists/:id/sponsor  body { sponsorId, brandColor }
// Admin attaches a sponsor to a playlist. Brand color is a Platinum/
// Enterprise perk — server discards it when the sponsor's effective
// tier is below PLATINUM (or the color isn't a valid hex). GOLD /
// STANDARD sponsors can still be attached; only the color is gated.
// Passing sponsorId=null clears the sponsor entirely.
router.patch('/playlists/:id/sponsor', async (req, res) => {
  try {
    const { sponsorId, brandColor } = req.body;
    // Clear path — no sponsor.
    if (sponsorId === null || sponsorId === '') {
      const playlist = await Playlist.findByIdAndUpdate(
        req.params.id,
        { sponsor: null, sponsorBrandColor: '' },
        { new: true },
      ).populate('sponsor',
        'firstName lastName academy_name company_name entity_name type profileImage themeColor');
      if (!playlist) return res.status(404).json({ error: 'Playlist not found' });
      return res.status(200).json(playlist);
    }

    const sponsor = await User.findById(sponsorId).select('type').lean();
    if (!sponsor) return res.status(404).json({ error: 'Sponsor user not found' });

    // Brand color validation: hex format + tier gate. Silently discard
    // (fall back to default gradient) rather than 402 — the sponsor
    // attachment itself still succeeds.
    let cleanColor = '';
    if (brandColor && HEX_COLOR_RE.test(brandColor)) {
      const tier = await Subscription.getEffectiveTier(sponsorId, sponsor.type);
      if (BRAND_COLOR_TIERS.has(tier)) {
        cleanColor = brandColor;
      }
    }

    const playlist = await Playlist.findByIdAndUpdate(
      req.params.id,
      { sponsor: sponsorId, sponsorBrandColor: cleanColor },
      { new: true },
    ).populate('sponsor',
      'firstName lastName academy_name company_name entity_name type profileImage themeColor');
    if (!playlist) return res.status(404).json({ error: 'Playlist not found' });
    return res.status(200).json(playlist);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/playlists/active/global-override — toggle global override on the active playlist
router.post('/playlists/active/global-override', async (req, res) => {
  try {
    const { enabled } = req.body;
    const playlist = await Playlist.findOneAndUpdate(
      { isActive: true },
      { globalOverride: !!enabled },
      { new: true }
    );
    if (!playlist) return res.status(404).json({ error: 'No active playlist' });
    return res.status(200).json(playlist);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/playlists/:id/add-video — add a media ID to a specific playlist
router.post('/playlists/:id/add-video', async (req, res) => {
  try {
    const { mediaId } = req.body;
    if (!mediaId) return res.status(400).json({ error: 'mediaId is required' });
    const playlist = await Playlist.findByIdAndUpdate(
      req.params.id,
      { $push: { videos: mediaId } },
      { new: true }
    ).populate('videos');
    if (!playlist) return res.status(404).json({ error: 'Playlist not found' });
    return res.status(200).json(withEffectiveOverride(playlist));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /v1/playlists/:id/rename — rename a playlist
router.patch('/playlists/:id/rename', async (req, res) => {
  try {
    const { title } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ error: 'title is required' });
    const playlist = await Playlist.findByIdAndUpdate(
      req.params.id,
      { title: title.trim() },
      { new: true }
    );
    if (!playlist) return res.status(404).json({ error: 'Playlist not found' });
    return res.status(200).json(playlist);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/playlists/:id/activate — set this playlist as active.
// Only deactivates OTHER active playlists whose audience set overlaps
// with this one's (broadcast [] is treated as "any audience"), so
// audience-scoped playlists can coexist. Two PLAYER-only playlists
// still can't both be active — the newly activated one wins.
router.post('/playlists/:id/activate', async (req, res) => {
  try {
    const target = await Playlist.findById(req.params.id).select('targetAudiences').lean();
    if (!target) return res.status(404).json({ error: 'Playlist not found' });
    const targetAud = target.targetAudiences || [];
    let deactivateFilter;
    if (targetAud.length === 0) {
      // Broadcast — deactivate any active broadcast (there should be at
      // most one). Audience-scoped playlists keep running independently.
      deactivateFilter = {
        _id: { $ne: req.params.id },
        isActive: true,
        $or: [
          { targetAudiences: { $exists: false } },
          { targetAudiences: { $size: 0 } },
        ],
      };
    } else {
      // Audience-scoped — deactivate any active playlist whose audience
      // set intersects (same specific type would double-target users).
      deactivateFilter = {
        _id: { $ne: req.params.id },
        isActive: true,
        targetAudiences: { $in: targetAud },
      };
    }
    await Playlist.updateMany(deactivateFilter, { isActive: false });
    const playlist = await Playlist.findByIdAndUpdate(req.params.id, { isActive: true }, { new: true });
    if (!playlist) return res.status(404).json({ error: 'Playlist not found' });
    return res.status(200).json(playlist);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/playlists/:id/videos — add a media item (by URL or file upload) to a playlist
router.post('/playlists/:id/videos', uploadFor(), async (req, res) => {
  try {
    const { title, url, description } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });
    if (!url && !req.body.url) return res.status(400).json({ error: 'url is required' });

    const media = await Media.create({
      title,
      description,
      url: req.body.url || url,
      type: 'Link',
      isPlaylist: true,
    });

    const playlist = await Playlist.findByIdAndUpdate(
      req.params.id,
      { $push: { videos: media._id } },
      { new: true }
    ).populate('videos');

    if (!playlist) return res.status(404).json({ error: 'Playlist not found' });
    return res.status(200).json({ playlist, media });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /v1/playlists/:id/videos/:videoId — remove a video from a playlist
router.delete('/playlists/:id/videos/:videoId', async (req, res) => {
  try {
    const playlist = await Playlist.findByIdAndUpdate(
      req.params.id,
      { $pull: { videos: req.params.videoId } },
      { new: true }
    ).populate('videos');
    if (!playlist) return res.status(404).json({ error: 'Playlist not found' });
    return res.status(200).json(playlist);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PUT /v1/playlists/:id/videos/reorder — reorder videos in a playlist
router.put('/playlists/:id/videos/reorder', async (req, res) => {
  try {
    const { videoIds } = req.body;
    if (!Array.isArray(videoIds)) return res.status(400).json({ error: 'videoIds must be an array' });
    const playlist = await Playlist.findByIdAndUpdate(
      req.params.id,
      { videos: videoIds },
      { new: true }
    ).populate('videos');
    if (!playlist) return res.status(404).json({ error: 'Playlist not found' });
    return res.status(200).json(playlist);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/playlists/override-players/:userId — enable playlist override for a player
router.post('/playlists/override-players/:userId', async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.userId, { playlistOverride: true }, { new: true });
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.status(200).json(user);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /v1/playlists/override-players/:userId — disable playlist override for a player
router.delete('/playlists/override-players/:userId', async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.userId, { playlistOverride: false }, { new: true });
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.status(200).json(user);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.patch(PATH_SINGLE, patchFor({ patch: (body, done) => Playlist.patch(body, done) }));
router.put(PATH_SINGLE, putFor({ put: (body, done) => Playlist.put(body, done) }));
router.delete(PATH_SINGLE, deleteFor({ del: (options, done) => Playlist.del(options, done) }));

module.exports = router;
