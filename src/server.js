const { start, app } = require('@lykmapipo/express-common');

app.get('/', (req, res) => {
  res.ok('Working');
});

start((error, env) => {
  if (error) {
    throw error;
  }

  console.log(`visit http://0.0.0.0:${env.PORT}`);
});
