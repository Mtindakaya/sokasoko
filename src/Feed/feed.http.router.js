const express = require('express');
const Media = require('../Media/media.model');
const Advert = require('../Advert/advert.model');
const mongoose = require('mongoose');

const router = express.Router();

// GET /v1/feed?userId=X&page=1&limit=10
// Returns media posts interleaved with adverts
router.get('/v1/feed', async (req, res) => {
  const { userId, page = 1, limit = 10 } = req.query;
  const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  const uid = userId && mongoose.Types.ObjectId.isValid(userId)
    ? new mongoose.Types.ObjectId(userId)
    : null;

  try {
    const [allDocs, total, adverts] = await Promise.all([
      Media.find({ isPlaylist: { $ne: true } })
        .populate('createdBy', 'firstName lastName profileImage type position academy_name company_name')
        .lean(),
      Media.countDocuments({ isPlaylist: { $ne: true } }),
      parseInt(page, 10) === 1
        ? Advert.find({}).sort({ createdAt: -1 }).limit(6).lean()
        : Promise.resolve([]),
    ]);

    // Shuffle so the feed is random, not time-ordered
    for (let i = allDocs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allDocs[i], allDocs[j]] = [allDocs[j], allDocs[i]];
    }
    const mediaDocs = allDocs.slice(skip, skip + parseInt(limit, 10));

    let posts = mediaDocs.map((m) => {
      const creator = m.createdBy || {};
      const likesArr = Array.isArray(m.likes) ? m.likes : [];
      return {
        _id: m._id,
        title: m.title,
        description: m.description,
        url: m.url,
        type: m.type,
        likesCount: likesArr.length,
        iLiked: uid ? likesArr.some((id) => String(id) === String(uid)) : false,
        createdAt: m.createdAt,
        creator: {
          _id: creator._id,
          firstName: creator.firstName || '',
          lastName: creator.lastName || '',
          profileImage: creator.profileImage || null,
          type: creator.type || '',
          position: creator.position || null,
          academy_name: creator.academy_name || null,
          company_name: creator.company_name || null,
        },
      };
    });

    // Fallback sample posts — only shown when the database has no real content yet
    if (posts.length === 0 && parseInt(page, 10) === 1) {
      const now = Date.now();
      posts = [
        {
          _id: 'sample1',
          title: 'Welcome to SokaSoko!',
          description: 'This is the community feed. Players, coaches, academies and scouts can share highlights, news and updates here.',
          url: null, type: 'Image', likesCount: 12, iLiked: false,
          createdAt: new Date(now).toISOString(),
          creator: { _id: 'ss0', firstName: 'SokaSoko', lastName: 'Team', profileImage: null, type: 'SCOUT', position: null, academy_name: null, company_name: 'SokaSoko' },
        },
        {
          _id: 'sample2',
          title: 'Player Highlight – Emmanuel Osei',
          description: 'Striker | Simba SC | Watch this week\'s best goal from the weekend fixture.',
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          type: 'Link', likesCount: 34, iLiked: false,
          createdAt: new Date(now - 1800000).toISOString(),
          creator: { _id: 'ss1', firstName: 'Emmanuel', lastName: 'Osei', profileImage: null, type: 'PLAYER', position: 'Striker', academy_name: null, company_name: null },
        },
        {
          _id: 'sample3',
          title: 'Academy Open Trials – Nairobi FC',
          description: 'We are holding open trials for U17 and U19 players this Saturday. Come ready to impress.',
          url: null, type: 'Image', likesCount: 8, iLiked: false,
          createdAt: new Date(now - 3600000).toISOString(),
          creator: { _id: 'ss2', firstName: 'Nairobi', lastName: 'FC Academy', profileImage: null, type: 'ACADEMY', position: null, academy_name: 'Nairobi FC Academy', company_name: null },
        },
        {
          _id: 'sample4',
          title: 'Scout Report – U19 Regional Tournament',
          description: 'Attended last weekend\'s tournament. Several standout midfielders worth following. Full report available on request.',
          url: null, type: 'Image', likesCount: 21, iLiked: false,
          createdAt: new Date(now - 5400000).toISOString(),
          creator: { _id: 'ss3', firstName: 'David', lastName: 'Kariuki', profileImage: null, type: 'SCOUT', position: null, academy_name: null, company_name: 'East Africa Scouts Network' },
        },
        {
          _id: 'sample5',
          title: 'Training Session – Technical Drills',
          description: 'Our U16 squad working on first touch and combination play. Great attitude from the boys today.',
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          type: 'Link', likesCount: 15, iLiked: false,
          createdAt: new Date(now - 7200000).toISOString(),
          creator: { _id: 'ss4', firstName: 'Coach', lastName: 'Mwangi', profileImage: null, type: 'COACH', position: null, academy_name: 'Rift Valley FC', company_name: null },
        },
        {
          _id: 'sample6',
          title: 'Match Result – Simba SC 3-1 Young Africans',
          description: 'Incredible performance from our strikers. Two goals in the last 10 minutes sealed the win.',
          url: null, type: 'Image', likesCount: 47, iLiked: false,
          createdAt: new Date(now - 9000000).toISOString(),
          creator: { _id: 'ss5', firstName: 'Simba', lastName: 'SC Official', profileImage: null, type: 'ACADEMY', position: null, academy_name: 'Simba SC', company_name: null },
        },
        {
          _id: 'sample7',
          title: 'Free Agent – Goalkeeper Looking for Club',
          description: 'Age 22 | 6\'2" | Strong shot-stopper. Open to trials at senior or academy level. Based in Dar es Salaam.',
          url: null, type: 'Image', likesCount: 9, iLiked: false,
          createdAt: new Date(now - 10800000).toISOString(),
          creator: { _id: 'ss6', firstName: 'Juma', lastName: 'Hassan', profileImage: null, type: 'PLAYER', position: 'Goalkeeper', academy_name: null, company_name: null },
        },
        {
          _id: 'sample8',
          title: 'Agent Update – Players Available for Transfer',
          description: 'Representing 3 players currently seeking moves. Ages 19-24. Contact us for full profiles and video highlights.',
          url: null, type: 'Image', likesCount: 6, iLiked: false,
          createdAt: new Date(now - 12600000).toISOString(),
          creator: { _id: 'ss7', firstName: 'Sports', lastName: 'Agency EA', profileImage: null, type: 'AGENT', position: null, academy_name: null, company_name: 'EA Sports Agency' },
        },
      ];
    }

    return res.json({ data: posts, total: total || posts.length, page: parseInt(page, 10), adverts });
  } catch (err) {
    console.error('[Feed] error:', err.message);
    return res.status(500).json({ message: err.message });
  }
});

// POST /v1/feed/:mediaId/like — toggle like
router.post('/v1/feed/:mediaId/like', async (req, res) => {
  const { mediaId } = req.params;
  const { userId } = req.body;
  if (!userId || !mongoose.Types.ObjectId.isValid(mediaId) || !mongoose.Types.ObjectId.isValid(userId)) {
    return res.status(400).json({ message: 'mediaId and userId required' });
  }
  try {
    const uid = new mongoose.Types.ObjectId(userId);
    const media = await Media.findById(mediaId);
    if (!media) return res.status(404).json({ message: 'Not found' });

    const liked = media.likes.some((id) => String(id) === String(uid));
    if (liked) {
      media.likes = media.likes.filter((id) => String(id) !== String(uid));
    } else {
      media.likes.push(uid);
    }
    await media.save();
    return res.json({ likesCount: media.likes.length, iLiked: !liked });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;
