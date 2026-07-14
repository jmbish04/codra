const fs = require('fs');
let content = fs.readFileSync('wrangler.jsonc', 'utf8');
content = content.replace(/,\s*"remote": true/g, '');
fs.writeFileSync('wrangler.jsonc', content);
