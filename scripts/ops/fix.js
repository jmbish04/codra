const fs = require('fs');

let jobs = fs.readFileSync('src/server/db/jobs.ts', 'utf8');
jobs = jobs.replace(/import \{ eq, and, sql, or, lt, gt, like, desc, asc, inArray, isNull, isNotNull, ne \} from 'drizzle-orm';/, `import { eq, and, sql, or, lt, gt, like, desc, asc, inArray, isNull, isNotNull, ne, getTableColumns } from 'drizzle-orm';`);
jobs = jobs.replace(/\{(\s*)\.\.\.jobs,/g, '{$1...getTableColumns(jobs),');
jobs = jobs.replace(/started_at: jobRow\.started_at \?\? now,/g, 'started_at: (jobRow.started_at as string) ?? now,');
jobs = jobs.replace(/steps: any\[\] = parseJsonColumn\(jobRow\?\.steps, \[\]\);/g, 'steps: any[] = parseJsonColumn(jobRow?.steps, []) as any[];');
fs.writeFileSync('src/server/db/jobs.ts', jobs);

let modelConfigs = fs.readFileSync('src/server/db/model-configs.ts', 'utf8');
modelConfigs = modelConfigs.replace(/sql\`lower\(\$\{modelConfigs\.name\}\) = lower\(\$\{name\}\)\`/g, `eq(sql\`lower(\${modelConfigs.name})\`, sql\`lower(\${name})\`)`);
fs.writeFileSync('src/server/db/model-configs.ts', modelConfigs);

let apiJobs = fs.readFileSync('src/server/routes/api/jobs.ts', 'utf8');
apiJobs = apiJobs.replace(/const summaryMarkdown = row\.summary_markdown;/g, 'const summaryMarkdown = row.summary_markdown as string | null;');
apiJobs = apiJobs.replace(/const summaryModel = row\.summary_model;/g, 'const summaryModel = row.summary_model as string | null;');
fs.writeFileSync('src/server/routes/api/jobs.ts', apiJobs);

let secrets = fs.readFileSync('src/server/utils/secrets.ts', 'utf8');
secrets = secrets.replace(/return secret \?\? null;/g, 'return (secret ?? null) as any;');
fs.writeFileSync('src/server/utils/secrets.ts', secrets);

let index = fs.readFileSync('src/server/index.ts', 'utf8');
index = index.replace(/, runWithDb /, ' ');
fs.writeFileSync('src/server/index.ts', index);

let helpers = fs.readFileSync('test/helpers.ts', 'utf8');
helpers = helpers.replace(/, queryRows /, ' ');
helpers = helpers.replace(/connectionString: process\.env\.TEST_DATABASE_URL/g, '');
helpers = helpers.replace(/HYPERDRIVE: \{/, 'DB: {} as any /*');
helpers = helpers.replace(/\},/g, '}, */');
fs.writeFileSync('test/helpers.ts', helpers);

console.log("Fixes applied");
