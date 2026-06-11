const fs = require('fs');
const path = require('path');

const filePath = path.join(
  __dirname,
  '../node_modules/@lykmapipo/express-request-extra/node_modules/express/lib/response.js'
);

if (!fs.existsSync(filePath)) {
  console.log('Patch target not found, skipping.');
  process.exit(0);
}

let content = fs.readFileSync(filePath, 'utf8');

if (content.includes('// patched: coerce string status codes')) {
  console.log('Already patched, skipping.');
  process.exit(0);
}

content = content.replace(
  'res.status = function status(code) {',
  "res.status = function status(code) {\n  // patched: coerce string status codes\n  if (typeof code === 'string') code = parseInt(code, 10);"
);

fs.writeFileSync(filePath, content);
console.log('Patched express-request-extra response.js successfully.');
