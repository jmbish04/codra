const fs = require('fs');
let content = fs.readFileSync('test/review-flow.spec.ts', 'utf8');
content = content.replace(/runWithDb\(env, async \(\) => \{/g, '(async () => {');
fs.writeFileSync('test/review-flow.spec.ts', content);
