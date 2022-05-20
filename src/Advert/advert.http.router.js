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
const PATH_SINGLE = '/adverts/:id';
const PATH_LIST = '/adverts';
const CurrentAdvertTimer = '/currentAdvertTimer';
const PATH_SCHEMA = '/adverts/schema/';

const Advert = require('./advert.model');
const User = require('../User/user.model');

const router = new Router({
  version: API_VERSION,
});

router.get(
  PATH_SCHEMA,
  schemaFor({
    getSchema: (query, done) => {
      const jsonSchema = Advert.jsonSchema();
      return done(null, jsonSchema);
    },
  })
);

router.get(
  PATH_SINGLE,
  getByIdFor({
    getById: (options, done) => Advert.get(options, done),
  })
);

router.get(
  PATH_LIST,
  getFor({
    get: (options, done) => Advert.get(options, done),
  })
);

router.post(
  PATH_LIST,
  uploadFor(),
  postFor({
    post: async (body, done) => {
      return Advert.post(body, done);
    },
  })
);

router.post(
  CurrentAdvertTimer,
  postFor({
    post: async (body, done) => {
      const duration = _.get(body, 'duration');
      return User.updateMany({}, { advertDuration: duration }, (error, res) => {
        if (error) {
          return done(error, null);
        }
        return done(null, res);
      });
    },
  })
);

router.patch(
  PATH_SINGLE,
  uploadFor(),
  patchFor({
    patch: (body, done) => Advert.patch(body, done),
  })
);

router.put(
  PATH_SINGLE,
  uploadFor(),
  putFor({
    put: (body, done) => Advert.put(body, done),
  })
);

router.delete(
  PATH_SINGLE,
  deleteFor({
    del: (options, done) => Advert.del(options, done),
  })
);

module.exports = router;
