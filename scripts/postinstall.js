const fs = require('fs');
const path = require('path');

const filePath = path.join(
  __dirname,
  '../node_modules/@lykmapipo/express-request-extra/node_modules/express/lib/response.js'
);

if (!fs.existsSync(filePath)) {
  console.log('Patch target not found at:', filePath);
  process.exit(0);
}

let content = fs.readFileSync(filePath, 'utf8');

if (content.includes('// sokasoko-patched')) {
  console.log('Already patched, skipping.');
  process.exit(0);
}

// Replace the strict integer check — coerce string codes to int instead of throwing
const original = `if (typeof code === 'string' || Math.floor(code) !== code) {`;
const patched = `// sokasoko-patched\n  if (typeof code === 'string') code = parseInt(code, 10);\n  if (Math.floor(code) !== code) {`;

if (content.includes(original)) {
  content = content.replace(original, patched);
  fs.writeFileSync(filePath, content);
  console.log('Successfully patched express response.js');
} else {
  console.log('Pattern not found — dumping first 3000 chars for inspection:');
  console.log(content.substring(0, 3000));
}
