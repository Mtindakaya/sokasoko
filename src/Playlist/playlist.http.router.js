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
const { uploadFor } = require('../Utils/uploader');

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
      const iLiked = userId ? likes.some(id => id.toString() === userId.toString()) : false;
      return { ...v, likesCount: likes.length, voteCount, averageScore, myVote, iLiked };
    });
  }
  return obj;
};

// ── Specific GET routes BEFORE /:id to avoid param capture ───────────────────

// GET /v1/playlists/active
router.get('/playlists/active', async (req, res) => {
  try {
    const { userId } = req.query;
    const playlist = await Playlist.findOne({ isActive: true }).populate({
      path: 'videos',
      populate: { path: 'player', select: 'firstName lastName accountNumber profileImage' },
    });
    if (!playlist) return res.status(404).json({ error: 'No active playlist' });
    return res.status(200).json(withEffectiveOverride(playlist, userId));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/playlists/active/challenge — start or close a challenge in one action
router.post('/playlists/active/challenge', async (req, res) => {
  try {
    const { action } = req.body; // 'start' | 'close'
    if (!['start', 'close'].includes(action)) return res.status(400).json({ error: 'action must be start or close' });
    const update = action === 'start'
      ? { votingEnabled: true, globalOverride: true }
      : { votingEnabled: false, globalOverride: false };
    const playlist = await Playlist.findOneAndUpdate({ isActive: true }, update, { new: true });
    if (!playlist) return res.status(404).json({ error: 'No active playlist' });
    return res.status(200).json(withEffectiveOverride(playlist));
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

// GET /v1/playlists/media-library
router.get('/playlists/media-library', async (req, res) => {
  try {
    const media = await Media.find({ isPlaylist: true }).sort({ createdAt: -1 });
    return res.status(200).json({ data: media });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/playlists/override-players
router.get('/playlists/override-players', async (req, res) => {
  try {
    const players = await User.find({ playlistOverride: true }).select('firstName lastName accountNumber profileImage type');
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

// POST /v1/playlists/:id/activate — set this playlist as active, deactivate others
router.post('/playlists/:id/activate', async (req, res) => {
  try {
    await Playlist.updateMany({}, { isActive: false });
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
