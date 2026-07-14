const fs = require('fs');

function replace(file, search, replacement) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(search, replacement);
  fs.writeFileSync(file, content);
}

replace('src/server/core/review.ts', /diffLineCount: diffOutput\?\.split\('\\n'\)\.length \?\? null,/g, 'diffLineCount: diffOutput?.split("\\n").length ?? 0,');
replace('src/server/core/review.ts', /verdict: r\.verdict,/g, 'verdict: (r.verdict as "approve" | "comment" | null),');
replace('src/server/db/model-configs.ts', /updated_at: sql\`CURRENT_TIMESTAMP\`/g, 'updated_at: new Date().toISOString()');
replace('src/server/index.ts', /import \{ DbClient \} from '@server\/db\/client';/g, "import type { DbClient } from '@server/db/client';");
replace('src/server/index.ts', /import \{ getDb, DbClient \} from '@server\/db\/client';/g, "import { getDb, type DbClient } from '@server/db/client';");
replace('src/server/services/gmail/auth.ts', /env\.GOOGLE_CREDS/g, '(env as any).GOOGLE_CREDS');
replace('src/server/utils/secrets.ts', /return secret \?\? null;/g, 'return (secret ?? null) as any;');

let resumable = fs.readFileSync('test/resumable-queue.spec.ts', 'utf8');
resumable = resumable.replace(/await getDb\(env\)\.query\(\s*`UPDATE jobs SET lease_expires_at = now\(\) - interval '1 minute' WHERE id = \$1`,\s*\[job\.id\]\s*\);/g, "await getDb(env).run(require('drizzle-orm').sql`UPDATE jobs SET lease_expires_at = datetime('now', '-1 minute') WHERE id = ${job.id}`);");
resumable = resumable.replace(/await getDb\(env\)\.query\(\s*`UPDATE jobs SET lease_expires_at = now\(\) - interval '1 minute', recovery_count = 3 WHERE id = \$1`,\s*\[job\.id\],\s*\);/g, "await getDb(env).run(require('drizzle-orm').sql`UPDATE jobs SET lease_expires_at = datetime('now', '-1 minute'), recovery_count = 3 WHERE id = ${job.id}`);");
resumable = resumable.replace(/await getDb\(env\)\.query\(\s*`UPDATE jobs SET status = 'running', lease_owner = NULL, heartbeat_at = now\(\) - interval '10 minutes', last_queue_message_at = now\(\) - interval '10 minutes' WHERE id = \$1`,\s*\[job\.id\],\s*\);/g, "await getDb(env).run(require('drizzle-orm').sql`UPDATE jobs SET status = 'running', lease_owner = NULL, heartbeat_at = datetime('now', '-10 minutes'), last_queue_message_at = datetime('now', '-10 minutes') WHERE id = ${job.id}`);");
resumable = resumable.replace(/await getDb\(env\)\.query\(\s*`UPDATE jobs SET started_at = now\(\) - interval '30 minutes' WHERE id = \$1`,\s*\[job\.id\],\s*\);/g, "await getDb(env).run(require('drizzle-orm').sql`UPDATE jobs SET started_at = datetime('now', '-30 minutes') WHERE id = ${job.id}`);");
fs.writeFileSync('test/resumable-queue.spec.ts', resumable);

let reviewFlow = fs.readFileSync('test/review-flow.spec.ts', 'utf8');
reviewFlow = reviewFlow.replace(/const sql = getDb\(env\);\n\s*await sql\.query\([\s\S]*?\);/g, "await require('@server/db/jobs').supersedeOlderJobs(env, { installationId: 'mock-installation-id', owner: 'owner', repo: 'repo', prNumber: 42, newJobId: 'dummy' });");
fs.writeFileSync('test/review-flow.spec.ts', reviewFlow);

let jobRec = fs.readFileSync('src/server/core/job-recovery.ts', 'utf8');
jobRec = jobRec.replace(/await recoverExpiredJobLeases\(env, 3, '300'\);/g, "await recoverExpiredJobLeases(env, 3, 300);");
fs.writeFileSync('src/server/core/job-recovery.ts', jobRec);
