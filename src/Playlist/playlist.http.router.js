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

const router = new Router({
  version: API_VERSION,
});

router.get(
  PATH_SCHEMA,
  schemaFor({
    getSchema: (query, done) => {
      const jsonSchema = Playlist.jsonSchema();
      return done(null, jsonSchema);
    },
  })
);

router.get(
  PATH_SINGLE,
  getByIdFor({
    getById: (options, done) => Playlist.get(options, done),
  })
);

router.get(
  PATH_LIST,
  getFor({
    get: (options, done) => Playlist.get(options, done),
  })
);

router.post(
  PATH_LIST,
  postFor({
    post: async (body, done) => {
      return Playlist.post(body, done);
    },
  })
);

router.patch(
  PATH_SINGLE,
  patchFor({
    patch: (body, done) => {
      return Playlist.findOneAndUpdate(
        { isActive: true },
        { isActive: false },
        (error) => {
          if (error) {
            return done(error, null);
          }
          return Playlist.patch(body, done);
        }
      );
    },
  })
);

router.put(
  PATH_SINGLE,
  putFor({
    put: (body, done) => Playlist.put(body, done),
  })
);

router.delete(
  PATH_SINGLE,
  deleteFor({
    del: (options, done) => Playlist.del(options, done),
  })
);

module.exports = router;
