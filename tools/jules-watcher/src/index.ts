import { loadConfig } from './config.js';
import { createUI } from './ui.js';
import { Watcher } from './watcher.js';
import { selfCheck } from './diff.js';

async function main() {
  if (process.argv.includes('--selfcheck')) { selfCheck(); return; }

  const cfg = loadConfig();
  const ui = await createUI();
  const watcher = new Watcher(cfg, ui);
  watcher.start();
  ui.log(`watcher up · agent ${cfg.agentId} · worker ${cfg.workerUrl}`);

  const shutdown = () => { watcher.stop(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
