export interface WatcherState {
  agentId: string;
  workerUrl: string;
  watching: Array<{ sessionId: string; taskId: string; status: string }>;
  lastHeartbeat: string;
  lastEvent: string;
}

export interface WatcherUI {
  setState(s: WatcherState): void;
  log(line: string): void;
  destroy(): void;
}

function render(s: WatcherState): string {
  const rows = s.watching.length
    ? s.watching.map((w) => `  • ${w.sessionId}  [${w.status}]  → task ${w.taskId.slice(0, 8)}`).join('\n')
    : '  (no active Jules sessions — idle)';
  return [
    `codra jules-watcher  ·  ${s.agentId}`,
    `worker: ${s.workerUrl}`,
    `heartbeat: ${s.lastHeartbeat || '—'}`,
    '',
    `watching ${s.watching.length} session(s):`,
    rows,
    '',
    `last: ${s.lastEvent || '—'}`,
  ].join('\n');
}

/** Plain-stdout UI for launchd / non-TTY (logs go to the launchd log file). */
class HeadlessUI implements WatcherUI {
  setState(s: WatcherState) { console.log(`[watcher] watching=${s.watching.length} hb=${s.lastHeartbeat} ${s.lastEvent}`); }
  log(line: string) { console.log(`[watcher] ${line}`); }
  destroy() {}
}

/** OpenTUI dashboard for an interactive terminal. Falls back to headless on any error. */
export async function createUI(): Promise<WatcherUI> {
  if (!process.stdout.isTTY) return new HeadlessUI();
  try {
    const { createCliRenderer, Box, Text } = await import('@opentui/core');
    const renderer = await createCliRenderer({ exitOnCtrlC: true, targetFps: 10 });
    const body = Text({ content: 'starting…', fg: '#8BD5CA' });
    renderer.root.add(Box({ borderStyle: 'rounded', padding: 1, flexDirection: 'column' }, body));
    return {
      setState(s) { (body as any).content = render(s); },
      log(line) { (body as any).content = `${(body as any).content ?? ''}\n${line}`; },
      destroy() { try { renderer.destroy(); } catch { /* ignore */ } },
    };
  } catch (err) {
    console.error('OpenTUI renderer unavailable, falling back to headless:', err instanceof Error ? err.message : err);
    return new HeadlessUI();
  }
}
