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

const router = new Router({
  version: API_VERSION,
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

router.get(
  PATH_LIST,
  getFor({
    get: (options, done) => Media.get(options, done),
  })
);

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
