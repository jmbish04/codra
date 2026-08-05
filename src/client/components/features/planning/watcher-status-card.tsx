import { useEffect, useRef, useState } from 'react';
import { api, type WatcherAgentDto } from '@client/lib/api';
import { Badge } from '@client/components/ui/badge';
import { CopyButton } from '@client/components/ui/copy-button';
import { formatDateTime } from '@client/lib/format';
import { RadioTower, WifiOff } from 'lucide-react';

const POLL_MS = 20000;

// Drop-in instruction for a coding agent to bring the Mac watcher back online.
const RECOVERY_PROMPT = `The codra "jules-watcher" daemon on my Mac is offline. Bring it back online:

1. Is the launchd agent loaded?
   launchctl list | grep com.codra.jules-watcher
2. If it IS loaded, reload it:
   launchctl unload ~/Library/LaunchAgents/com.codra.jules-watcher.plist && \\
   launchctl load   ~/Library/LaunchAgents/com.codra.jules-watcher.plist
3. If it is NOT installed, set it up:
   cd tools/jules-watcher
   bun install
   tokens show WORKER_API_KEY --value-only   # must print a value
   tokens show JULES_API_KEY --value-only     # must print a value
   # then follow tools/jules-watcher/README.md to edit and install the launchd plist
4. Check logs for the failure and fix it:
   tail -n 50 tools/jules-watcher/watcher.err.log
5. Confirm success: the codra dashboard's "Mac watcher" card should flip to online within ~30s.

The worker's cron poller is the fallback and keeps Jules moving while the watcher is down, so there is no rush — but real-time triggering resumes only once this is back up.`;

/**
 * WatcherStatusCard
 */
export function WatcherStatusCard() {
  const [agents, setAgents] = useState<WatcherAgentDto[]>([]);
  const [alive, setAlive] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const load = () => api.getWatcherAgents()
      .then((res) => { if (mounted.current) { setAgents(res.agents); setAlive(res.alive); setError(null); } })
      .catch((e) => { if (mounted.current) setError(e instanceof Error ? e.message : 'Failed to load watcher status.'); });
    /**
     * load
     */
    load();
    const id = setInterval(load, POLL_MS);
    return () => { mounted.current = false; clearInterval(id); };
  }, []);

  const online = alive === true;

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {online ? <RadioTower className="h-4 w-4 text-emerald-500" /> : <WifiOff className="h-4 w-4 text-muted-foreground" />}
          <h3 className="text-sm font-semibold">Mac watcher (real-time Jules)</h3>
        </div>
        <Badge variant={alive === null ? 'neutral' : online ? 'success' : 'danger'}>
          {alive === null ? 'checking…' : online ? 'online' : 'offline'}
        </Badge>
      </div>

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      {agents.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
          {agents.map((a) => (
            <li key={a.agent_id} className="flex items-center justify-between gap-2">
              <span className="font-mono">{a.agent_id}{a.hostname ? ` · ${a.hostname}` : ''}</span>
              <span>{a.active_sessions} watching · seen {formatDateTime(a.last_seen_at)}</span>
            </li>
          ))}
        </ul>
      )}

      {alive === false && (
        <div className="mt-3 rounded-md border border-border bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground">
            No watcher has checked in recently. Real-time triggering is paused — the worker cron poller
            is still advancing Jules as the fallback. Bring the Mac watcher back with the prompt below.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <CopyButton value={RECOVERY_PROMPT} label="Copy recovery prompt" copiedLabel="Copied — paste into your coding agent" />
          </div>
        </div>
      )}
    </section>
  );
}
