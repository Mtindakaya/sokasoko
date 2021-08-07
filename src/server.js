const { start, app, mount } = require('@lykmapipo/express-common');
const { connect } = require('@lykmapipo/mongoose-common');
const { getNumber, getString } = require('@lykmapipo/env');

const PlayerRouter = require('./Player/player.http.router');
const GuardianRouter = require('./Guardian/guardian.http.router');
const CoachRouter = require('./Coach/coach.http.router');
const AcademyRouter = require('./Academy/academy.http.router');

const PORT = getNumber('PORT', 5000);
const MONGODB_URI = getString('MONGODB_URI');

app.get('/', (req, res) => {
  res.send({ status: 'working' });
});

connect(MONGODB_URI, (error) => {
  if (error) throw new Error(error);

  mount([PlayerRouter, GuardianRouter, CoachRouter, AcademyRouter]);

  start(PORT, (err) => {
    if (err) {
      throw new Error(err);
    }

    // eslint-disable-next-line no-console
    console.log(`visit http://0.0.0.0:${PORT}/v1/`);
  });
});
