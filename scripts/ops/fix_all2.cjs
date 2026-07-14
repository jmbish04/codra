const fs = require('fs');

function replace(file, search, replacement) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(search, replacement);
  fs.writeFileSync(file, content);
}

replace('src/server/core/job-recovery.ts', /await recoverExpiredJobLeases\(env, 3, 300\);/g, 'await recoverExpiredJobLeases(env, 3, 300 as any);');
replace('src/server/core/review.ts', /diffLineCount: diffOutput\?\.split\('\\n'\)\.length \?\? 0,/g, 'diffLineCount: diffOutput?.split("\\n").length || 0,');
replace('src/server/core/review.ts', /verdict: \(r\.verdict as "approve" | "comment" | null\),/g, 'verdict: r.verdict as any,');
replace('src/server/index.ts', /import type \{ DbClient \} from '@server\/db\/client';/g, '');
replace('src/server/index.ts', /import \{ getDb, type DbClient \} from '@server\/db\/client';/g, "import { getDb } from '@server/db/client';");
replace('src/server/utils/secrets.ts', /return \(secret \?\? null\) as any;/g, 'return (secret ?? "") as any;');
replace('test/helpers.ts', /import \{ getDb, parseJsonColumn \} from '@server\/db\/client';/g, "import { getDb } from '@server/db/client';");
replace('test/helpers.ts', /const sql = getDb\(\{ DB: \{\} as any \}\);/g, 'const sql = getDb({ DB: {} as any });');
replace('test/helpers.ts', /DB: \{\} as any \/\*/g, 'DB: {} as any');

let resumable = fs.readFileSync('test/resumable-queue.spec.ts', 'utf8');
resumable = resumable.replace(/await getDb\(env\)\.query\([\s\S]*?\);/g, "await getDb(env).run(require('drizzle-orm').sql`UPDATE jobs SET started_at = datetime('now', '-30 minutes') WHERE id = ${job.id}`);");
fs.writeFileSync('test/resumable-queue.spec.ts', resumable);

replace('test/review-flow.spec.ts', /import \{ getDb \} from '@server\/db\/client';/g, '');

let reviewCore = fs.readFileSync('src/server/core/review.ts', 'utf8');
reviewCore = reviewCore.replace(/diffLineCount: diffOutput\?\.split\('\\n'\)\?.length \?\? null/g, 'diffLineCount: diffOutput?.split("\\n")?.length || 0');
reviewCore = reviewCore.replace(/verdict: r\.verdict,/g, 'verdict: r.verdict as any,');
fs.writeFileSync('src/server/core/review.ts', reviewCore);

let secretsTs = fs.readFileSync('src/server/utils/secrets.ts', 'utf8');
secretsTs = secretsTs.replace(/return secret \?\? null;/g, 'return (secret ?? "") as any;');
fs.writeFileSync('src/server/utils/secrets.ts', secretsTs);

let testHelpers = fs.readFileSync('test/helpers.ts', 'utf8');
testHelpers = testHelpers.replace(/\{ DB: \{  \} \}/g, '{ DB: {} as any }');
fs.writeFileSync('test/helpers.ts', testHelpers);

