const { start, app, mount } = require('@lykmapipo/express-common');
const { connect } = require('@lykmapipo/mongoose-common');
const { getNumber, getString } = require('@lykmapipo/env');
// const { fileRouter, createModels } = require('@lykmapipo/file');

const AcademyRouter = require('./Academy/academy.http.router');
const UserRouter = require('./User/user.http.router');
const AdvertRouter = require('./Advert/advert.http.router');
const CvRouter = require('./Cv/cv.http.router');
const MediaRouter = require('./Media/media.http.router');
const AgentRouter = require('./Agent/agent.http.router');
const PlaylistRouter = require('./Playlist/playlist.http.router');
const VideoRouter = require('./YoutubeVideo/video.http.router');

const PORT = getNumber('PORT', 5000);
const MONGODB_URI = getString('MONGODB_URI');

app.get('/', (request, response) => {
  return response.ok({ status: 'working' });
});

connect(MONGODB_URI, (error) => {
  if (error) throw new Error(error);

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

    // eslint-disable-next-line no-console
    console.log(`visit http://0.0.0.0:${PORT}/v1/`);
  });
});
