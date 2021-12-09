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
const PATH_SINGLE = '/agents/:id';
const PATH_LIST = '/agents';
const PATH_SCHEMA = '/agents/schema/';

const Agent = require('./agent.model');

const router = new Router({
  version: API_VERSION,
});

router.get(
  PATH_SCHEMA,
  schemaFor({
    getSchema: (query, done) => {
      const jsonSchema = Agent.jsonSchema();
      return done(null, jsonSchema);
    },
  })
);

router.get(
  PATH_SINGLE,
  getByIdFor({
    getById: (options, done) => Agent.get(options, done),
  })
);

router.get(
  PATH_LIST,
  getFor({
    get: (options, done) => Agent.get(options, done),
  })
);

router.post(
  PATH_LIST,
  postFor({
    post: async (body, done) => {
      return Agent.post(body, done);
    },
  })
);

router.patch(
  PATH_SINGLE,
  patchFor({
    patch: (body, done) => Agent.patch(body, done),
  })
);

router.put(
  PATH_SINGLE,
  putFor({
    put: (body, done) => Agent.put(body, done),
  })
);

router.delete(
  PATH_SINGLE,
  deleteFor({
    del: (options, done) => Agent.del(options, done),
  })
);

module.exports = router;
