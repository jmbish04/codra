import { execSync } from 'child_process';

const queues = ['codra-review-jobs', 'codra-review-dlq'];

for (const queue of queues) {
  try {
    console.log(`Creating queue: ${queue}...`);
    execSync(`npx wrangler queues create ${queue}`, { stdio: 'inherit' });
    console.log(`Successfully created queue: ${queue}`);
  } catch (err) {
    console.warn(`Failed to create queue ${queue}. It may already exist.`);
  }
}
