const { start, app, mount } = require('@lykmapipo/express-common');
const { connect } = require('@lykmapipo/mongoose-common');
const { getNumber, getString } = require('@lykmapipo/env');

const StatsRouter = require('./Match/match.stats.router');
const AcademyLinksRouter = require('./User/academy_links.router');
const ProfileViewRouter = require('./User/profile_view.router');
const VenueImportRouter = require('./Venue/venue.import.router');
const ReservationRouter = require('./Reservation/reservation.http.router');
const SubscriptionRouter = require('./Subscription/subscription.http.router');
const MatchRouter = require('./Match/match.http.router');
const TournamentRouter = require('./Tournament/tournament.http.router');
const VenueRouter = require('./Venue/venue.http.router');
const AcademyRouter = require('./Academy/academy.http.router');
const UserRouter = require('./User/user.http.router');
const AdvertRouter = require('./Advert/advert.http.router');
const CvRouter = require('./Cv/cv.http.router');
const MediaRouter = require('./Media/media.http.router');
const AgentRouter = require('./Agent/agent.http.router');
const PlaylistRouter = require('./Playlist/playlist.http.router');
const VideoRouter = require('./YoutubeVideo/video.http.router');
const ScoutCvRouter = require('./ScoutCv/scout_cv.http.router');
require('./scheduler');

const PORT = getNumber('PORT', 5000);
const MONGODB_URI = getString('MONGODB_URI');

app.get('/', (request, response) => {
  return response.ok({ status: 'working' });
});

app.use('/uploads', require('express').static('public/uploads'));

connect(MONGODB_URI, (error) => {
  if (error) throw new Error(error);
  app.use(StatsRouter);
  app.use(AcademyLinksRouter); 
  app.use(ProfileViewRouter);
  app.use(VenueImportRouter);
  app.use(ReservationRouter);
  app.use(VenueRouter);
  app.use(TournamentRouter);
  app.use(SubscriptionRouter);
  app.use(MatchRouter);
  app.use(ScoutCvRouter);

  mount([
    AcademyRouter,
    CvRouter,
    MediaRouter,
    UserRouter,
    AdvertRouter,
    AgentRouter,
    PlaylistRouter,
    VideoRouter,
  ]);

  start(PORT, (err) => {
    if (err) {
      throw new Error(err);
    }

    console.log(`visit http://0.0.0.0:${PORT}/v1/`);
  });
});
