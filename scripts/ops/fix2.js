const fs = require('fs');

function fix() {
  let resumable = fs.readFileSync('test/resumable-queue.spec.ts', 'utf8');
  resumable = resumable.replace(/await getDb\(env\)\.query\(\s*`UPDATE jobs SET lease_expires_at = now\(\) - interval '1 minute' WHERE id = \$1`,\s*\[job\.id\]\s*\);/g, `await getDb(env).run(require('drizzle-orm').sql\`UPDATE jobs SET lease_expires_at = datetime('now', '-1 minute') WHERE id = \${job.id}\`);`);
  resumable = resumable.replace(/await getDb\(env\)\.query\(\s*`UPDATE jobs SET lease_expires_at = now\(\) - interval '1 minute', recovery_count = 3 WHERE id = \$1`,\s*\[job\.id\],\s*\);/g, `await getDb(env).run(require('drizzle-orm').sql\`UPDATE jobs SET lease_expires_at = datetime('now', '-1 minute'), recovery_count = 3 WHERE id = \${job.id}\`);`);
  resumable = resumable.replace(/await getDb\(env\)\.query\(\s*`UPDATE jobs SET status = 'running', lease_owner = NULL, heartbeat_at = now\(\) - interval '10 minutes', last_queue_message_at = now\(\) - interval '10 minutes' WHERE id = \$1`,\s*\[job\.id\],\s*\);/g, `await getDb(env).run(require('drizzle-orm').sql\`UPDATE jobs SET status = 'running', lease_owner = NULL, heartbeat_at = datetime('now', '-10 minutes'), last_queue_message_at = datetime('now', '-10 minutes') WHERE id = \${job.id}\`);`);
  resumable = resumable.replace(/await getDb\(env\)\.query\(\s*`UPDATE jobs SET started_at = now\(\) - interval '30 minutes' WHERE id = \$1`,\s*\[job\.id\],\s*\);/g, `await getDb(env).run(require('drizzle-orm').sql\`UPDATE jobs SET started_at = datetime('now', '-30 minutes') WHERE id = \${job.id}\`);`);
  fs.writeFileSync('test/resumable-queue.spec.ts', resumable);

  let reviewFlow = fs.readFileSync('test/review-flow.spec.ts', 'utf8');
  reviewFlow = reviewFlow.replace(/await sql\.query\([\s\S]+?\]\s*\);/g, `await sql.run(require('drizzle-orm').sql\`UPDATE jobs SET status = 'superseded' WHERE pr_number = 42\`);`);
  fs.writeFileSync('test/review-flow.spec.ts', reviewFlow);

  let setup = fs.readFileSync('test/setup.ts', 'utf8');
  setup = setup.replace(/const sql = getDb\(\{ DB: \{ connectionString: process\.env\.TEST_DATABASE_URL \} \}\);/, 'const sql = getDb({ DB: {} as any });');
  fs.writeFileSync('test/setup.ts', setup);
}
fix();
