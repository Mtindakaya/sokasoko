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
const ReportRequestRouter = require('./ReportRequest/report_request.http.router');
const NotificationRouter = require('./Notification/notification.http.router');
const AiAdvisorRouter = require('./AiAdvisor/ai_advisor.http.router');
const TrialRouter = require('./Trial/trial.http.router');
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

// Public profile page for PDF hyperlinks
app.get('/profile/:userId', async (req, res) => {
  try {
    const User = require('./User/user.model');
    const user = await User.findById(req.params.userId)
      .select('firstName lastName accountNumber type region district position nationality phone profileImage foot height weight dob gender')
      .lean();
    if (!user) return res.status(404).send('<h2>Profile not found</h2>');

    const img = user.profileImage
      ? `<img src="${user.profileImage}" alt="Profile" style="width:80px;height:80px;border-radius:50%;object-fit:cover;border:3px solid #1B5E20;">`
      : `<div style="width:80px;height:80px;border-radius:50%;background:#1B5E20;display:flex;align-items:center;justify-content:center;color:#fff;font-size:32px;">${(user.firstName||'?')[0]}</div>`;

    const row = (label, val) => val ? `<tr><td style="color:#666;padding:4px 12px 4px 0;font-size:13px;">${label}</td><td style="font-size:13px;font-weight:600;">${val}</td></tr>` : '';

    let dob = '';
    if (user.dob) {
      const b = new Date(user.dob);
      const age = Math.floor((Date.now() - b.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
      dob = `${b.toLocaleDateString('en-GB')} (age ${age})`;
    }

    res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${user.firstName} ${user.lastName} – SokaSoko</title>
<style>body{margin:0;font-family:sans-serif;background:#f5f5f5;}
.card{max-width:480px;margin:32px auto;background:#fff;border-radius:16px;box-shadow:0 2px 12px rgba(0,0,0,.1);overflow:hidden;}
.header{background:#1B5E20;color:#fff;padding:24px;display:flex;align-items:center;gap:16px;}
.name{font-size:20px;font-weight:700;} .sub{font-size:13px;opacity:.85;}
.body{padding:24px;} table{border-collapse:collapse;width:100%;}
.badge{display:inline-block;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;background:#E8F5E9;color:#1B5E20;}
</style></head><body>
<div class="card">
  <div class="header">${img}<div><div class="name">${user.firstName} ${user.lastName}</div>
  <div class="sub">${user.accountNumber || ''}</div></div></div>
  <div class="body">
    <table>
      ${row('Type', user.type ? `<span class="badge">${user.type}</span>` : '')}
      ${row('Position', user.position)}
      ${row('Gender', user.gender)}
      ${row('Date of Birth', dob)}
      ${row('Nationality', user.nationality)}
      ${row('Region', user.region)}
      ${row('District', user.district)}
      ${row('Height', user.height ? user.height + ' cm' : '')}
      ${row('Weight', user.weight ? user.weight + ' kg' : '')}
      ${row('Preferred Foot', user.foot)}
    </table>
  </div>
</div></body></html>`);
  } catch (err) {
    res.status(500).send('<h2>Error loading profile</h2>');
  }
});

connect(MONGODB_URI, (error) => {
  if (error) throw new Error(error);

  // 1. Create HTTP server and Socket.io first so the chat router can use io.
  const httpServer = http.createServer(app);
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  const io = new SocketServer(httpServer, {
    cors: {
      origin: (origin, callback) => {
        // Allow mobile app clients (no Origin header) and explicitly listed origins
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error(`CORS: origin '${origin}' not allowed`));
        }
      },
      methods: ['GET', 'POST'],
    },
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
  app.use(ReportRequestRouter);
  app.use(NotificationRouter);
  app.use(AiAdvisorRouter);
  app.use(TrialRouter);
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
