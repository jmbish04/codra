# codra jules-watcher

A tiny always-on daemon for your Mac. It holds Jules `activities.updates()` streams
open (free, on your hardware) and pokes the codra worker the moment Jules emits an
activity — so the worker only ever runs short, event-triggered steps instead of an
always-awake Durable Object (which is what caused a large active-duration bill).

It also heartbeats the worker on a cadence, recorded in D1, so the dashboard knows
the Mac is alive. **The worker's cron poller is the fallback whenever this daemon is
offline** — nothing breaks if the Mac sleeps; real-time just pauses.

## Requirements

- [Bun](https://bun.sh) (native OpenTUI renderer). `which bun` to find its path.
- The `tokens` CLI, configured with `WORKER_API_KEY` and `JULES_API_KEY`
  (tied to the Cloudflare secret store). Verify: `tokens show WORKER_API_KEY --value-only`.

## Install & run manually

```bash
cd tools/jules-watcher
bun install
export WORKER_URL=https://codra.hacolby.workers.dev   # your worker origin
bun run src/index.ts
```

An interactive terminal shows the OpenTUI dashboard (watched sessions, heartbeat,
last event). Under launchd (no TTY) it logs plain lines to the log files instead.

Sanity check the reconcile logic without any network/secrets:

```bash
bun run src/index.ts --selfcheck   # prints "selfcheck OK"
```

## Run at login (launchd)

1. Edit `launchd/com.codra.jules-watcher.plist` — replace `__BUN_PATH__` (from
   `which bun`) and both `__REPO__` occurrences with this repo's absolute path.
2. Install:
   ```bash
   cp launchd/com.codra.jules-watcher.plist ~/Library/LaunchAgents/
   launchctl load ~/Library/LaunchAgents/com.codra.jules-watcher.plist
   ```
3. Confirm it registered a heartbeat: the codra dashboard's watcher card should flip
   to **online** within ~30s, or check `watcher.out.log`.

Stop / restart:

```bash
launchctl unload ~/Library/LaunchAgents/com.codra.jules-watcher.plist
launchctl load   ~/Library/LaunchAgents/com.codra.jules-watcher.plist
```

## Fleet / merge runner

The daemon also runs `jules-fleet` / `jules-merge` CLIs, which **cannot** run on the
Worker (both import `node:child_process` + `fs`). It polls codra for queued jobs
(`GET /api/agent/fleet-jobs`), claims one, runs the real CLI, and reports back:

- `init` / `analyze` / `dispatch` → `npx @google/jules-fleet <kind> --repo <owner/repo>`
- `merge` → `jules-merge scan` → **codra reviews & approves** (`POST /api/agent/merge-review`,
  Kimi 2.7, circuit-broken) → `jules-merge merge` only if approved.

Queue a job from the dashboard/API (`POST /api/planning-packages/orchestration/fleet/jobs`)
or the `request_fleet_run` MCP tool. Conflict reconciliation authoring
(`get-contents`/`stage-resolution`) is a later iteration; clean batches merge today.

## Notes

- Secrets are pulled at runtime via `tokens show <NAME> --value-only` (see
  `src/secrets.ts`) — no plaintext creds in env files or on disk.
- The Mac must be awake for real-time watching; on a laptop, `caffeinate` or run it
  on an always-on Mac. The cron fallback covers downtime.
- Only outbound HTTPS from the Mac to the worker — nothing is exposed inbound, so no
  tunnel or VPC is required.
