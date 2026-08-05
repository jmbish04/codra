import { loadConfig } from './config.js';
import { createUI } from './ui.js';
import { Watcher } from './watcher.js';
import { selfCheck } from './diff.js';
import { FleetRunner, fleetSelfCheck } from './fleet.js';

/**
 * main
 */
async function main() {
  if (process.argv.includes('--selfcheck')) { selfCheck(); fleetSelfCheck(); return; }

  const cfg = loadConfig();
  const ui = await createUI();
  const watcher = new Watcher(cfg, ui);
  watcher.start();
  const fleet = new FleetRunner(cfg, ui);
  fleet.start();
  ui.log(`watcher + fleet runner up · agent ${cfg.agentId} · worker ${cfg.workerUrl}`);

  /**
   * shutdown
   */
  const shutdown = () => { watcher.stop(); fleet.stop(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
