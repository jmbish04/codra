const fs = require('fs');

function replace(file, search, replacement) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(search, replacement);
  fs.writeFileSync(file, content);
}

replace('src/server/core/job-recovery.ts', /new GitHubService\(env, job\.installation_id\)/g, 'new GitHubService(env, String(job.installation_id))');
replace('src/server/core/review.ts', /diffLineCount: diffOutput\?\.split\('\\n'\)\?\.length \|\| 0,/g, 'diffLineCount: diffOutput?.split("\\n")?.length || 0,');
fs.writeFileSync('src/server/core/review.ts', fs.readFileSync('src/server/core/review.ts', 'utf8').replace(/diffLineCount: diffOutput\?\.split\('\\n'\)\?\.length \?\? null,/g, 'diffLineCount: diffOutput?.split("\\n")?.length || 0,'));

