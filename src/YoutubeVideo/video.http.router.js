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
const { uploadFor } = require('../Utils/uploader');

const API_VERSION = getString('API_VERSION', '1.0.0');
const PATH_SINGLE = '/videos/:id';
const PATH_LIST = '/videos';
const PATH_SCHEMA = '/videos/schema/';

const Video = require('./video.model');
// const User = require('../User/user.model');

const router = new Router({
  version: API_VERSION,
});

router.get(
  PATH_SCHEMA,
  schemaFor({
    getSchema: (query, done) => {
      const jsonSchema = Video.jsonSchema();
      return done(null, jsonSchema);
    },
  })
);

router.get(
  PATH_SINGLE,
  getByIdFor({
    getById: (options, done) => Video.get(options, done),
  })
);

router.get(
  PATH_LIST,
  getFor({
    get: (options, done) => Video.get(options, done),
  })
);

router.post(
  PATH_LIST,
  uploadFor(),
  postFor({
    post: async (body, done) => {
      return Video.post(body, done);
    },
  })
);

router.patch(
  PATH_SINGLE,
  patchFor({
    patch: (body, done) => {
      return Video.findOneAndUpdate(
        { active: true },
        { active: false },
        (error) => {
          if (error) {
            return done(error, null);
          }
          return Video.patch(body, done);
        }
      );
    },
  })
);

router.patch(
  PATH_SINGLE,
  patchFor({
    patch: (body, done) => Video.patch(body, done),
  })
);

router.put(
  PATH_SINGLE,
  putFor({
    put: (body, done) => Video.put(body, done),
  })
);

router.delete(
  PATH_SINGLE,
  deleteFor({
    del: (options, done) => Video.del(options, done),
  })
);

module.exports = router;
