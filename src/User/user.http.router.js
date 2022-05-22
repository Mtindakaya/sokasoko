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
// const { uploaderFor } = require('@lykmapipo/file');
// const autoParse = require('auto-parse');
const { uploadFor } = require('../Utils/uploader');
const Counter = require('../Counter/counter.model');
const { leftFillNum, sendSms, generateHash } = require('../Utils/utils');

const API_VERSION = getString('API_VERSION', '1.0.0');

const PATH_SINGLE = '/users/:id';
const PATH_RESET = '/users/reset/:id';
const PATH_SUSPEND = '/users/suspend/:id';
const PATH_UNSUSPEND = '/users/unsuspend/:id';
const PATH_REMOVE_AGENT = '/users/agent/:id';
const PATH_LIST = '/users';
const PATH_SEARCH = '/users/search';
const PATH_LOGIN = '/users/login';
const PATH_SCHEMA = '/users/schema/';

const User = require('./user.model');

const router = new Router({
  version: API_VERSION,
});

router.get(
  PATH_SCHEMA,
  schemaFor({
    getSchema: (query, done) => {
      const jsonSchema = User.jsonSchema();
      return done(null, jsonSchema);
    },
  })
);

router.get(
  PATH_LIST,
  getFor({
    get: (options, done) => {
      return User.get(options, done);
    },
  })
);

router.get(PATH_SEARCH, (request, response) => {
  const { mquery } = request;
  const query = _.get(mquery, 'filter.text', '');
  User.find(
    {
      $or: [
        { firstName: { $regex: query, $options: 'i' } },
        { lastName: { $regex: query, $options: 'i' } },
        { accountNumber: { $regex: query, $options: 'i' } },
        { academy_name: { $regex: query, $options: 'i' } },
        { company_name: { $regex: query, $options: 'i' } },
        { type: { $regex: query, $options: 'i' } },
      ],
      suspend: { $ne: true },
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
    getById: (options, done) => {
      const id = _.get(options, 'id');

      User.findById(id, (err, data) => {
        if (err) {
          return done(err, null);
        }
        return done(null, data);
      });
    },
  })
);

router.post(
  PATH_RESET,
  postFor({
    post: (options, done) => {
      const id = _.get(options, 'params.id');
      const newPassword = _.get(options, 'password', 'sokasoko');
      User.findById(id, (error, user) => {
        if (error) {
          return done(error, null);
        }

        user.changePassword(newPassword);

        return done(null, user);
      });
    },
  })
);

router.post(
  PATH_SUSPEND,
  postFor({
    post: (options, done) => {
      const id = _.get(options, 'params.id');
      const message = _.get(options, 'message', 'Account Suspended');

      User.findById(id, async (error, user) => {
        if (error) {
          return done(error, null);
        }

        // eslint-disable-next-line no-param-reassign
        user.suspend = true;
        user.save();

        await sendSms(
          `Sokasoko Account Suspended due to ${message}`,
          user.phone.replace(user.phone.charAt(0), '255')
        );

        return done(null, user);
      });
    },
  })
);

router.post(
  PATH_UNSUSPEND,
  postFor({
    post: (options, done) => {
      const id = _.get(options, 'params.id');
      const message = 'Your Account has been reactivated';

      User.findById(id, async (error, user) => {
        if (error) {
          return done(error, null);
        }

        // eslint-disable-next-line no-param-reassign
        user.suspend = false;
        user.save();

        await sendSms(message, user.phone.replace(user.phone.charAt(0), '255'));

        return done(null, user);
      });
    },
  })
);

router.post(
  PATH_REMOVE_AGENT,
  postFor({
    post: (options, done) => {
      const id = _.get(options, 'params.id');

      User.findById(id, async (error, user) => {
        if (error) {
          return done(error, null);
        }

        // eslint-disable-next-line no-param-reassign
        user.agent = null;
        user.save();

        return done(null, user);
      });
    },
  })
);

router.post(
  PATH_LIST,
  uploadFor(),
  postFor({
    // eslint-disable-next-line consistent-return
    post: async (body, done) => {
      const userType = _.get(body, 'type', 'PLAYER');
      const phone = _.get(body, 'phone');
      const isOwner = _.get(body, 'subAccount', 'false');

      const isPhoneExists = await User.where('phone', phone).count();
      const passwordValue = _.get(body, 'password', 'sokasoko');
      const password = await generateHash(passwordValue);
      if (
        !_.isUndefined(phone) &&
        isPhoneExists === 0 &&
        isOwner.toLowerCase() === 'false'
      ) {
        User.post({ ...body, password }, async (err, data) => {
          if (err) {
            return done(err, null);
          }
          const counter = await Counter.getNextSequenceValue('memberId');
          const accountNumber = `TFH-${userType.charAt(0)}-A${leftFillNum(
            counter,
            6
          )}`;
          data.setAccountNumber(accountNumber);
          const payload = data.phone.replace(data.phone.charAt(0), '255');
          const text =
            data.type === 'SPONSOR' && data.sponsor_type === 'Entity'
              ? `${data.entity_name}`
              : `${data.firstName} ${data.lastName}`;
          sendSms(
            `Karibu Sokasoko ${text}, Tafadhali tunza tarakimu zako hizi za usajili. ${data.accountNumber}`,
            payload
          );
          return done(null, data);
        });
      } else if (_.isUndefined(phone) && isOwner.toLowerCase() === 'true') {
        User.post({ ...body, password }, async (err, data) => {
          if (err) {
            return done(err, null);
          }
          const counter = await Counter.getNextSequenceValue('memberId');
          const accountNumber = `TFH-${userType.charAt(0)}-A${leftFillNum(
            counter,
            6
          )}`;
          data.setAccountNumber(accountNumber);
          return done(null, data);
        });
      } else if (!_.isUndefined(phone) && isOwner.toLowerCase() === 'true') {
        User.post({ ...body, password }, async (err, data) => {
          if (err) {
            return done(err, null);
          }
          const counter = await Counter.getNextSequenceValue('memberId');
          const accountNumber = `TFH-${userType.charAt(0)}-A${leftFillNum(
            counter,
            6
          )}`;
          data.setAccountNumber(accountNumber);
          const payload = data.phone.replace(data.phone.charAt(0), '255');
          sendSms(
            `Karibu Sokasoko ${data.firstName} ${data.lastName}, Tafadhali tunza tarakimu zako hizi za usajili. ${data.accountNumber}`,
            payload
          );
          return done(null, data);
        });
      } else {
        return done(
          new Error('An Error occured. Please contact the Administrator'),
          null
        );
      }
    },
  })
);

router.patch(
  PATH_SINGLE,
  uploadFor(),
  patchFor({
    patch: (body, done) => {
      const remove = _.get(body, 'remove');
      if (remove) {
        // eslint-disable-next-line no-param-reassign
        body = _.assign(body, { agent: null });
        console.log(body);
      }
      return User.patch(body, done);
    },
  })
);

router.put(
  PATH_SINGLE,
  uploadFor(),
  putFor({
    put: (body, done) => {
      return User.put(body, done);
    },
  })
);

router.delete(
  PATH_SINGLE,
  deleteFor({
    del: (options, done) => User.del(options, done),
  })
);

router.post(PATH_LOGIN, (request, response) => {
  const identifier = _.get(request.body, 'identifier');
  const password = _.get(request.body, 'password');

  User.findOne({
    $or: [{ phone: identifier }, { accountNumber: identifier }],
  }).exec((err, user) => {
    if (err) {
      return response.error(err);
    }

    if (_.isNull(user)) {
      return response.notFound();
    }

    return user.comparePassword(password, (error, isMatch) => {
      if (isMatch) {
        return response.ok(user);
      }
      return response.error('Failed to Login');
    });
  });
});

module.exports = router;
