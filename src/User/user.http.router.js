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
const Counter = require('../Counter/counter.model');
const { leftFillNum, sendSms, generateHash } = require('../Utils/utils');
const { Subscription } = require('../Subscription/subscription.model');
const ProfileView = require('./profile_view.model');

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
const PATH_EXPIRING = '/users/expiring';
const PATH_STATUS = '/users/status/:id';

const User = require('./user.model');

const router = new Router({
  version: API_VERSION,
});

const RESTRICTED_FIELDS = [
  'phone', 'email', 'contact_number', 'street',
  'facebook', 'instagram', 'twitter', 'youtube',
  'linkedin', 'agent', 'academy', 'password',
];

const stripRestrictedFields = (user) => {
  const obj = _.isFunction(user.toObject) ? user.toObject() : user;
  RESTRICTED_FIELDS.forEach((field) => { delete obj[field]; });
  return obj;
};

const canViewFullProfile = async (requestingUserId, targetUser) => {
  if (_.get(targetUser, 'type') !== 'PLAYER') return true;
  if (!requestingUserId) return false;
  const requestingUser = await User.findById(requestingUserId);
  if (!requestingUser) return false;
  if (requestingUser.type !== 'SCOUT') return true;
  const accessStatus = requestingUser.getAccessStatus();
  if (
    accessStatus.status === 'FREE_TRIAL' ||
    accessStatus.status === 'GRACE_PERIOD' ||
    accessStatus.status === 'UNRESTRICTED'
  ) return true;
  const isSubscribed = await Subscription.isUserSubscribed(requestingUserId);
  return isSubscribed;
};

router.get(PATH_SCHEMA, schemaFor({
  getSchema: (query, done) => {
    const jsonSchema = User.jsonSchema();
    return done(null, jsonSchema);
  },
}));

router.get(PATH_EXPIRING, async (request, response) => {
  try {
    const now = new Date();
    const in7Days = new Date(now);
    in7Days.setDate(in7Days.getDate() + 7);
    const fields = 'firstName lastName phone type accountNumber freeTrialEndDate gracePeriodEndDate';

    const expiringSoon = await User.find({
      type: { $in: ['PLAYER', 'SCOUT'] },
      freeTrialEndDate: { $gte: now, $lte: in7Days },
      suspend: { $ne: true },
    }).select(fields);

    const inGracePeriod = await User.find({
      type: { $in: ['PLAYER', 'SCOUT'] },
      freeTrialEndDate: { $lt: now },
      gracePeriodEndDate: { $gte: now },
      suspend: { $ne: true },
    }).select(fields);

    const expired = await User.find({
      type: { $in: ['PLAYER', 'SCOUT'] },
      gracePeriodEndDate: { $lt: now },
      suspend: { $ne: true },
    }).select(fields);

    return response.ok({ expiringSoon, inGracePeriod, expired });
  } catch (err) {
    return response.error(err);
  }
});

router.get(PATH_STATUS, async (request, response) => {
  const { id } = request.params;
  try {
    const user = await User.findById(id);
    if (!user) return response.notFound();
    const accessStatus = user.getAccessStatus();
    return response.status(200).json({ ...accessStatus, type: user.type });
  } catch (err) {
    return response.error(err);
  }
});

router.get(PATH_LIST, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(parseInt(req.query.limit) || 20, 500);
    const filter = { suspend: { $ne: true } };
    if (req.query.type) filter.type = req.query.type;
    if (req.query.school) filter.school = req.query.school;
    if (req.query.gender) filter.gender = req.query.gender;

    const [data, total] = await Promise.all([
      User.find(filter)
        .select('firstName lastName academy_name company_name entity_name profileImage type accountNumber position sponsor_type vendor_type region tafoca gender school school_class school_jersey_number')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      User.countDocuments(filter),
    ]);

    return res.status(200).json({ data, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get(PATH_SEARCH, async (request, response) => {
  const { mquery } = request;
  const query = _.get(mquery, 'filter.text', '') || _.get(request, 'query.filter.text', '');
  const requestingUserId = _.get(request, 'query.viewerId');
  const limit = Math.min(parseInt(_.get(request, 'query.limit', '50')), 100);
  const typeFilter = request.query.type ? { type: request.query.type } : {};

  try {
    const data = await User.find({
      $or: [
        { firstName: { $regex: query, $options: 'i' } },
        { lastName: { $regex: query, $options: 'i' } },
        { accountNumber: { $regex: query, $options: 'i' } },
        { academy_name: { $regex: query, $options: 'i' } },
        { company_name: { $regex: query, $options: 'i' } },
        { entity_name: { $regex: query, $options: 'i' } },
      ],
      suspend: { $ne: true },
      ...typeFilter,
    })
      .select('firstName lastName academy_name company_name entity_name profileImage type accountNumber position sponsor_type vendor_type region tafoca')
      .limit(limit)
      .lean();

    return response.ok({ data });
  } catch (error) {
    return response.error(error);
  }
});

router.get(PATH_SINGLE, getByIdFor({
  getById: async (options, done) => {
    const id = _.get(options, 'id');
    const requestingUserId = _.get(options, 'query.viewerId');
    User.findById(id, async (err, user) => {
      if (err) return done(err, null);
      if (!user) return done(null, null);
      const canView = await canViewFullProfile(requestingUserId, user);
      // Track profile view (fire and forget)
      if (requestingUserId && requestingUserId !== id) {
        User.findById(requestingUserId).then(viewer => {
          if (viewer) {
            ProfileView.create({ profile: id, viewer: requestingUserId, viewerType: viewer.type });
          }
        }).catch(() => {});
      }
      if (!canView) return done(null, stripRestrictedFields(user));
      return done(null, user);
    });
  },
}));

router.post(PATH_RESET, postFor({
  post: async (options, done) => {
    try {
      const id = _.get(options, 'params.id');
      const newPassword = _.get(options, 'password', 'sokasoko');
      const user = await User.findById(id);
      if (!user) return done(new Error('User not found'), null);
      await user.changePassword(newPassword);
      return done(null, user);
    } catch (e) {
      return done(e, null);
    }
  },
}));

router.post(PATH_SUSPEND, postFor({
  post: (options, done) => {
    const id = _.get(options, 'params.id');
    const message = _.get(options, 'message', 'Account Suspended');
    User.findById(id, async (error, user) => {
      if (error) return done(error, null);
      user.suspend = true;
      user.save();
      await sendSms(
        `Sokasoko Account Suspended due to ${message}`,
        user.phone.replace(user.phone.charAt(0), '255')
      );
      return done(null, user);
    });
  },
}));

router.post(PATH_UNSUSPEND, postFor({
  post: (options, done) => {
    const id = _.get(options, 'params.id');
    const message = 'Your Account has been reactivated';
    User.findById(id, async (error, user) => {
      if (error) return done(error, null);
      user.suspend = false;
      user.save();
      await sendSms(message, user.phone.replace(user.phone.charAt(0), '255'));
      return done(null, user);
    });
  },
}));

router.post(PATH_REMOVE_AGENT, postFor({
  post: (options, done) => {
    const id = _.get(options, 'params.id');
    User.findById(id, async (error, user) => {
      if (error) return done(error, null);
      user.agent = null;
      user.save();
      return done(null, user);
    });
  },
}));

router.post(PATH_LIST, uploadFor(), postFor({
  post: async (body, done) => {
    const userType = _.get(body, 'type', 'PLAYER');
    const phoneRaw = _.get(body, 'phone');
    const phone = phoneRaw === '' || phoneRaw === null ? undefined : phoneRaw;
    // Fix dob format if needed
    if (body.dob) body.dob = body.dob.toString().replace(' ', 'T');
    const isOwnerRaw = _.get(body, 'subAccount', 'false');
    const isOwner = isOwnerRaw === true || isOwnerRaw === 'true' ? 'true' : 'false';
    const isPhoneExists = await User.where('phone', phone).count();
    const passwordValue = _.get(body, 'password', 'sokasoko');
    const password = await generateHash(passwordValue);

    if (userType === 'SCHOOL' && isOwner === 'false') {
      const regNum = _.get(body, 'academy_registration');
      if (!regNum) return done(new Error('School registration number is required'), null);
      const exists = await User.where({ academy_registration: regNum, type: 'SCHOOL' }).count();
      if (exists > 0) return done(new Error('School registration number already in use'), null);
      User.post({ ...body, firstName: body.academy_name || 'School', lastName: 'School', password }, async (err, data) => {
        if (err) return done(err, null);
        const counter = await Counter.getNextSequenceValue('memberId');
        const accountNumber = `TFH-SC-A${leftFillNum(counter, 6)}`;
        await data.setAccountNumber(accountNumber);
        return done(null, data);
      });
    } else if ((!_.isUndefined(phone) && isPhoneExists === 0 && isOwner === 'false') || (_.isUndefined(phone) && !_.isUndefined(_.get(body, 'email')) && isOwner === 'false')) {
      User.post({ ...body, password }, async (err, data) => {
        if (err) return done(err, null);
        const counter = await Counter.getNextSequenceValue('memberId');
        const accountNumber = `TFH-${userType.charAt(0)}-A${leftFillNum(counter, 6)}`;
        await data.setAccountNumber(accountNumber);
        if (data.phone) {
          const payload = data.phone.replace(data.phone.charAt(0), '255');
          const text = data.type === 'SPONSOR' && data.sponsor_type === 'Entity'
            ? `${data.entity_name}` : `${data.firstName} ${data.lastName}`;
          sendSms(`Karibu Sokasoko ${text}, Tafadhali tunza tarakimu zako hizi za usajili. ${data.accountNumber}`, payload);
        }
        return done(null, data);
      });
    } else if (_.isUndefined(phone) && isOwner === 'true') {
      User.post({ ...body, password }, async (err, data) => {
        if (err) return done(err, null);
        const counter = await Counter.getNextSequenceValue('memberId');
        const accountNumber = `TFH-${userType.charAt(0)}-A${leftFillNum(counter, 6)}`;
        await data.setAccountNumber(accountNumber);
        return done(null, data);
      });
    } else if (!_.isUndefined(phone) && isOwner === 'true') {
      User.post({ ...body, password }, async (err, data) => {
        if (err) return done(err, null);
        const counter = await Counter.getNextSequenceValue('memberId');
        const accountNumber = `TFH-${userType.charAt(0)}-A${leftFillNum(counter, 6)}`;
        await data.setAccountNumber(accountNumber);
        const payload = data.phone.replace(data.phone.charAt(0), '255');
        sendSms(`Karibu Sokasoko ${data.firstName} ${data.lastName}, Tafadhali tunza tarakimu zako hizi za usajili. ${data.accountNumber}`, payload);
        return done(null, data);
      });
    } else {
      if (isPhoneExists > 0) return done(new Error('Phone number already registered. Please use a different number.'), null);
      return done(new Error('An Error occured. Please contact the Administrator'), null);
    }
  },
}));

router.patch(PATH_SINGLE, uploadFor(), patchFor({
  patch: (body, done) => {
    const remove = _.get(body, 'remove');
    if (remove) body = _.assign(body, { agent: null });
    return User.patch(body, done);
  },
}));

router.put(PATH_SINGLE, uploadFor(), putFor({
  put: (body, done) => User.put(body, done),
}));

router.delete(PATH_SINGLE, deleteFor({
  del: (options, done) => User.del(options, done),
}));

router.post(PATH_LOGIN, (request, response) => {
  const rawIdentifier = _.get(request.body, 'identifier', '');
  const identifier = rawIdentifier.trim();
  const password = _.get(request.body, 'password');

  User.findOne({
    $or: [
      { phone: identifier },
      { accountNumber: new RegExp(`^${identifier}$`, 'i') },
      { email: new RegExp(`^${identifier}$`, 'i') },
      { academy_registration: new RegExp(`^${identifier}$`, 'i') },
    ],
  }).exec((err, user) => {
    if (err) return response.error(err);
    if (_.isNull(user)) return response.notFound();
    return user.comparePassword(password, (error, isMatch) => {
      if (error) return response.error(error);
      if (isMatch) return response.ok(user);
      return response.error('Failed to Login');
    });
  });
});


// POST /v1/users/:id/link-coach — academy links a coach
router.post('/v1/users/:id/link-coach', async (req, res) => {
  try {
    const { coachId, requestedBy } = req.body;
    const academy = await User.findById(req.params.id);
    if (!academy) return res.status(404).json({ error: 'Academy not found' });
    if (academy.type !== 'ACADEMY') return res.status(400).json({ error: 'User is not an academy' });

    // Verify requestedBy is owner or secretary
    const isOwner = academy.owner && academy.owner.toString() === requestedBy;
    const isSecretary = academy.secretary && academy.secretary.toString() === requestedBy;
    const isAcademy = academy._id.toString() === requestedBy;
    if (!isOwner && !isSecretary && !isAcademy) {
      return res.status(403).json({ error: 'Only the academy owner or secretary can link a coach' });
    }

    // Link coach to academy
    const coach = await User.findById(coachId);
    if (!coach) return res.status(404).json({ error: 'Coach not found' });
    if (coach.type !== 'COACH') return res.status(400).json({ error: 'User is not a coach' });

    coach.linkedAcademy = academy._id;
    await coach.save();

    return res.status(200).json({ message: 'Coach linked successfully', coach });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/users/:id/link-owner — set academy owner
router.post('/v1/users/:id/link-owner', async (req, res) => {
  try {
    const { userId } = req.body;
    const academy = await User.findByIdAndUpdate(req.params.id, { owner: userId }, { new: true });
    if (!academy) return res.status(404).json({ error: 'Academy not found' });
    return res.status(200).json({ data: academy });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/users/:id/link-secretary — set academy secretary
router.post('/v1/users/:id/link-secretary', async (req, res) => {
  try {
    const { userId } = req.body;
    const academy = await User.findByIdAndUpdate(req.params.id, { secretary: userId }, { new: true });
    if (!academy) return res.status(404).json({ error: 'Academy not found' });
    return res.status(200).json({ data: academy });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});


module.exports = router;
