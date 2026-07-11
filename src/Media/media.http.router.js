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
const _ = require('lodash');
const { uploadFor } = require('../Utils/uploader');

const API_VERSION = getString('API_VERSION', '1.0.0');
const PATH_SINGLE = '/medias/:id';
const PATH_LIST = '/medias';
const PATH_SCHEMA = '/medias/schema/';
const PATH_SEARCH = '/medias/search';

const Media = require('./media.model');
const Comment = require('./comment.model');

const router = new Router({
  version: API_VERSION,
});

// GET /v1/medias/:id/comments — list comments oldest → newest
router.get('/medias/:id/comments', async (req, res) => {
  try {
    const data = await Comment
      .find({ media: req.params.id })
      .populate('user', 'firstName lastName profileImage type')
      .sort({ createdAt: 1 })
      .lean();
    return res.status(200).json({ data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/medias/:id/comments — add a comment
router.post('/medias/:id/comments', async (req, res) => {
  try {
    const { userId, text } = req.body;
    if (!userId || !text || !String(text).trim()) {
      return res.status(400).json({ error: 'userId and text are required' });
    }
    const comment = await Comment.create({
      media: req.params.id,
      user: userId,
      text: String(text).trim(),
    });
    const populated = await Comment
      .findById(comment._id)
      .populate('user', 'firstName lastName profileImage type')
      .lean();
    return res.status(201).json(populated);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /v1/medias/:id/comments/:cid — author-only delete
router.delete('/medias/:id/comments/:cid', async (req, res) => {
  try {
    const { userId } = req.query;
    const comment = await Comment.findById(req.params.cid);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    if (String(comment.user) !== String(userId)) {
      return res.status(403).json({ error: 'Not comment author' });
    }
    await Comment.deleteOne({ _id: req.params.cid });
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get(
  PATH_SCHEMA,
  schemaFor({
    getSchema: (query, done) => {
      const jsonSchema = Media.jsonSchema();
      return done(null, jsonSchema);
    },
  })
);

router.get(PATH_SEARCH, (request, response) => {
  const { mquery } = request;
  const query = _.get(mquery, 'filter.text', '');
  Media.find(
    {
      type: 'Link',
      $or: [{ title: { $regex: query, $options: 'i' } }],
    },
    (error, data) => {
      if (error) {
        return response.error(error);
      }

      return response.ok({ data });
    }
  );
});

router.get(
  PATH_SINGLE,
  getByIdFor({
    getById: (options, done) => Media.get(options, done),
  })
);

router.get(PATH_LIST, async (req, res) => {
  try {
    const filter = { isPlaylist: { $ne: true } };
    const query = _.get(req, 'query.query');
    if (query) {
      try {
        const parsed = typeof query === 'string' ? JSON.parse(query) : query;
        Object.assign(filter, parsed);
      } catch (_) {
        Object.assign(filter, query);
      }
    }
    const data = await Media.find(filter).sort({ order: 1, createdAt: 1 });
    return res.status(200).json({ data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /v1/medias/playlist/:id — edit a playlist media item (title, url, description, player)
router.patch('/medias/playlist/:id', async (req, res) => {
  try {
    const { title, url, description, playerId } = req.body;
    const update = {};
    if (title !== undefined) update.title = title;
    if (url !== undefined) update.url = url;
    if (description !== undefined) update.description = description;
    update.player = playerId || null;
    const media = await Media.findByIdAndUpdate(req.params.id, update, { new: true })
      .populate('player', 'firstName lastName accountNumber');
    if (!media) return res.status(404).json({ error: 'Media not found' });
    return res.status(200).json(media);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/medias/playlist — create standalone playlist video (no user required)
router.post('/medias/playlist', async (req, res) => {
  try {
    const { title, url, description, playerId } = req.body;
    if (!title || !url) return res.status(400).json({ error: 'title and url are required' });
    const media = await Media.create({
      title, url, description, type: 'Link', isPlaylist: true,
      ...(playerId ? { player: playerId } : {}),
    });
    return res.status(201).json(media);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/medias/reorder — Router auto-prefixes with /v1/, so path here is /medias/reorder
router.post('/medias/reorder', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids must be an array' });
    await Promise.all(ids.map((id, index) => Media.findByIdAndUpdate(id, { order: index })));
    return res.status(200).json({ message: 'Reordered successfully' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post(
  PATH_LIST,
  uploadFor(),
  postFor({
    post: async (body, done) => {
      return Media.post(body, done);
    },
  })
);

router.patch(
  PATH_SINGLE,
  patchFor({
    patch: (body, done) => Media.patch(body, done),
  })
);

router.put(
  PATH_SINGLE,
  putFor({
    put: (body, done) => Media.put(body, done),
  })
);

router.delete(
  PATH_SINGLE,
  deleteFor({
    del: (options, done) => Media.del(options, done),
  })
);

module.exports = router;
