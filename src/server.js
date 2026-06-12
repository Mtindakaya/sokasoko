// Patch Express 5 response prototype inside express-request-extra to accept string status codes
try {
  const extraExpress = require('@lykmapipo/express-request-extra/node_modules/express');
  const orig = extraExpress.response.status;
  extraExpress.response.status = function(code) {
    return orig.call(this, typeof code === 'string' ? parseInt(code, 10) : code);
  };
} catch(e) {}

const { app, mount, notFound, errorHandler } = require('@lykmapipo/express-common');
const { connect } = require('@lykmapipo/mongoose-common');
const { getNumber, getString } = require('@lykmapipo/env');
const http = require('http');
const { Server: SocketServer } = require('socket.io');

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
const createChatRouter = require('./Chat/chat.http.router');
const attachChat = require('./Chat/chat.socket');
const FeedRouter = require('./Feed/feed.http.router');
const TournamentRegistrationRouter = require('./TournamentRegistration/tournament_registration.http.router');
const OpenTournamentRouter = require('./OpenTournament/open_tournament.http.router');
require('./scheduler');

const PORT = getNumber('PORT', 5000);
const MONGODB_URI = getString('MONGODB_URI');

// Coerce string status codes to integers for Express 4.x strict mode compatibility
app.use((req, res, next) => {
  const _status = res.status.bind(res);
  res.status = (code) => _status(parseInt(code, 10));
  next();
});

app.get('/', (request, response) => {
  return response.ok({ status: 'working' });
});

app.use('/uploads', require('express').static('public/uploads'));

connect(MONGODB_URI, (error) => {
  if (error) throw new Error(error);

  // 1. Create HTTP server and Socket.io first so the chat router can use io.
  const httpServer = http.createServer(app);
  const io = new SocketServer(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    transports: ['websocket', 'polling'],
  });
  attachChat(io);

  // 2. Mount all routes — notFound/errorHandler MUST come after all routes.
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
  app.use(FeedRouter);
  app.use(TournamentRegistrationRouter);
  app.use(OpenTournamentRouter);
  app.use(createChatRouter(io));

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

  // 3. Error handlers go last — anything above this line is a real route.
  app.use(notFound);
  app.use(errorHandler);

  // 4. Start listening.
  httpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use. Run:  lsof -ti :${PORT} | xargs kill -9`);
      process.exit(1);
    } else {
      throw err;
    }
  });
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`visit http://0.0.0.0:${PORT}/v1/`);
  });
});
