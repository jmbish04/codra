# OpenCode + VPC/Tunnel setup runbook

Operator runbook for Codra's Spec 2 source-aware review engines. This is the
"Task 7 runbook" referenced by the comment block in
[`wrangler.jsonc`](../wrangler.jsonc) (near `secrets_store_secrets`) and by
[`src/server/engines/opencode-client.ts`](../src/server/engines/opencode-client.ts).

**This entire document is performed by the operator (you), not by an agent.**
Nothing here is executed automatically — see [Safety note](#safety-note).

Design reference: [`docs/superpowers/specs/2026-08-07-codra-spec2-source-aware-engines-design.md`](superpowers/specs/2026-08-07-codra-spec2-source-aware-engines-design.md).

## Overview

Codra reviews a PR with one of three interchangeable engines, all implementing
the same `ReviewEngine` interface (`src/server/core/review-engine.ts`):

- **`NativeEngine`** — the always-on floor. Diff-only, runs entirely inside
  the Worker, no external infra. Always `isConfigured() === true` and always
  healthy — this is what ships today and what every job falls back to.
- **`ComputerEngine`** — all-Cloudflare. Runs reviewers against a real
  populated filesystem (`@cloudflare/computer` `Workspace` on a Durable
  Object) instead of just the diff hunk. No Mac dependency. Currently
  **experimental / not configured** in this repo — see
  [Section E](#e-computerengine-all-cloudflare-experimental).
- **`OpenCodeEngine`** — runs the review on **your Mac**, via an OpenCode
  server reached over Workers VPC (primary) or a cloudflared Tunnel
  (fallback). This is what Sections A–D below set up.

`resolveEngine` (`src/server/core/engine-selector.ts`) picks which engine
runs a given job:

1. Read `config.review.engine` — one of `auto | opencode | computer | native`
   (`src/shared/schema.ts`), default `auto`.
   - `auto` tries `[opencode, computer, native]` in that order.
   - A pinned value tries `[<pinned>, native]` (native is always the floor,
     unless you pin `native` itself).
2. For each non-native candidate, **before any I/O**: skip it if
   `engine.isConfigured(env)` is `false` — no transport/binding present. This
   is why merging this branch, or leaving `OPENCODE_TUNNEL_URL=""`, changes
   nothing: an unconfigured engine is skipped with zero KV reads.
3. For a configured candidate: skip if its `CircuitBreaker` (KV key
   `breaker:<name>`) is open; otherwise call `healthCheck()` (2.5s hard
   timeout). First healthy candidate wins.
4. A healthCheck failure trips `breaker.recordFailure()` and moves to the
   next candidate. Falling through the whole list always lands on
   `NativeEngine`, which is unconditionally healthy.

Net effect: **provisioning nothing keeps Codra on `NativeEngine`, exactly as
it behaves today.** Section D below is the point where `OpenCodeEngine`
starts actually being selected.

## A. Run OpenCode on the Mac

Install the OpenCode CLI/server per its own docs (not covered here), then run
it as a background service alongside the existing
`~/codra-jules-watcher` launchd daemon (see the `codra-deploy-daemon-ops`
memory note for how that one is installed — this mirrors it).

1. Pick a local port for the OpenCode server (this runbook uses `4096`;
   change it everywhere below if you use a different one).
2. Copy the reviewer config template into place:

   ```bash
   mkdir -p ~/.codra/opencode
   cp scripts/opencode/codra-review.opencode.jsonc ~/.codra/opencode/codra-review.opencode.jsonc
   ```

   This config (documented fully in the template's own comments) defines:
   - one OpenCode session per specialized reviewer — `security`, `bugs`,
     `performance`, `correctness`, `quality`, `docs` (same ids as
     `src/server/prompts/reviewers.ts`'s `REVIEWERS`) — plus a `coordinator`
     session that dedups/ranks their findings, matching Codra's native
     pipeline shape so results plug into the same `parsed_comments`/GitHub
     posting path either way.
   - the HTTP contract the Worker calls:
     - `POST /review` — body `{ job, pr, config, sharedContext, files:
       [{ path, patch }] }` (see `OpenCodeEngine.reviewPullRequest` for the
       exact payload shape it sends). Response body is **JSONL**: one
       `parsedReviewComment`-shaped JSON object per line, plus a terminal
       summary line `{"type":"summary","perReviewer":[...]}` carrying
       per-reviewer token usage (`ReviewerUsage[]`). Any line that isn't
       valid JSON, or doesn't match the comment schema or the summary shape,
       is skipped by `OpenCodeEngine` rather than failing the whole review —
       so a slightly malformed line degrades gracefully, it doesn't need to
       be perfect.
     - `GET /health` — cheap liveness probe, must respond within ~2s (the
       Worker's `healthCheck()` timeout is 2.5s including transport RTT).
3. Install the launchd service:

   ```bash
   cp scripts/opencode/com.codra.opencode.plist ~/Library/LaunchAgents/com.codra.opencode.plist
   # edit the copied plist: fill in the opencode binary path, --port, and
   # --config <path to codra-review.opencode.jsonc> placeholders first
   launchctl load ~/Library/LaunchAgents/com.codra.opencode.plist
   ```

4. Confirm it's up: `curl -s http://localhost:4096/health` should return
   `200`.

`scripts/opencode/install.sh` walks steps 2–3 for you (see its own
`--help`/comments) but never touches your Cloudflare account — it only wires
up the local Mac side and then prints the remaining steps (B–D) to run
yourself.

## B. cloudflared named Tunnel + Access service token

This is the **fallback** transport (primary is Workers VPC, Section C). Set
it up regardless — it's what `OPENCODE_TUNNEL_URL` covers if the VPC path is
ever unavailable.

1. Authenticate cloudflared once (interactive, opens a browser):

   ```bash
   cloudflared tunnel login
   ```

2. Create the named tunnel:

   ```bash
   cloudflared tunnel create codra-opencode
   ```

   Note the tunnel UUID and the credentials file path it prints
   (`~/.cloudflared/<UUID>.json`).

3. Copy the ingress config template and fill in the placeholders:

   ```bash
   cp scripts/opencode/cloudflared-config.template.yml ~/.cloudflared/config.yml
   # edit ~/.cloudflared/config.yml: fill in <FILL_ME_TUNNEL_UUID>,
   # <FILL_ME_CREDENTIALS_FILE_PATH>, <FILL_ME_PUBLIC_HOSTNAME>, and the
   # local port from Section A if you didn't use 4096
   ```

4. Route DNS for the tunnel's public hostname (must be a hostname on a zone
   in your Cloudflare account):

   ```bash
   cloudflared tunnel route dns codra-opencode <FILL_ME_PUBLIC_HOSTNAME>
   ```

5. Run the tunnel (as a service, so it survives reboots — see `cloudflared
   service install` in its own docs, or wrap it in another launchd plist
   alongside `com.codra.opencode.plist`):

   ```bash
   cloudflared tunnel run codra-opencode
   ```

6. In the Cloudflare Zero Trust dashboard, create an **Access application**
   for `https://<FILL_ME_PUBLIC_HOSTNAME>/*`, policy type **Service Auth**,
   and generate a **service token**. This gives you a Client ID and Client
   Secret pair.
   - **Do not commit these anywhere.** They go into Cloudflare Secrets Store
     in Section D, never into `wrangler.jsonc`, `.dev.vars`, or git.
   - The Worker presents them as `CF-Access-Client-Id` /
     `CF-Access-Client-Secret` headers — `OpenCodeClient.viaTunnel()`
     already does this for you; you only need to get the values into Secrets
     Store.

## C. Workers VPC (primary path)

Workers VPC is the **primary** transport — `OpenCodeClient.send()` tries
`env.OPENCODE_VPC` first and only falls back to the Tunnel URL on a
connectivity failure. This section is account-gated (Workers VPC needs to be
enabled on your Cloudflare account) and its exact steps depend on your
network topology (Mac reachable via a private network, VPN, or Cloudflare
Tunnel-as-VPC-origin) — follow the current Cloudflare Workers VPC docs for
provisioning a private-network origin, then:

1. In `wrangler.jsonc`, add a Workers VPC service binding named
   `OPENCODE_VPC` pointing at the origin you provisioned (host/port =
   wherever the OpenCode server from Section A is reachable on your private
   network).
2. Run `npm run types` to regenerate `worker-configuration.d.ts` so
   `env.OPENCODE_VPC` is typed.

If Workers VPC isn't available to you yet, skip this section — the Tunnel
from Section B is a fully functional fallback on its own;
`hasOpenCodeTransport(env)` (and therefore `OpenCodeEngine.isConfigured`)
only needs *either* `OPENCODE_VPC` or `OPENCODE_TUNNEL_URL` to be true.

## D. Wire the Worker

Add these entries to `wrangler.jsonc`, replacing the `<FILL_ME_*>`
placeholders with the real values from Sections B/C. This lands right below
the existing "Spec 2 source-aware engines" comment block (~line 153–163)
which already documents this exact list — don't duplicate the comment,
just add the entries it describes:

```jsonc
// in "vars":
"OPENCODE_TUNNEL_URL": "https://<FILL_ME_PUBLIC_HOSTNAME>",

// in "secrets_store_secrets" (append; store_id/secret_name are yours —
// create these secrets in Cloudflare Secrets Store first, then reference
// the store_id/secret_name you get back):
{
  "binding": "OPENCODE_ACCESS_CLIENT_ID",
  "store_id": "<FILL_ME_SECRETS_STORE_ID>",
  "secret_name": "<FILL_ME_SECRET_NAME_FOR_ACCESS_CLIENT_ID>",
},
{
  "binding": "OPENCODE_ACCESS_CLIENT_SECRET",
  "store_id": "<FILL_ME_SECRETS_STORE_ID>",
  "secret_name": "<FILL_ME_SECRET_NAME_FOR_ACCESS_CLIENT_SECRET>",
},

// top-level, alongside other service bindings — only if Section C's
// Workers VPC path is provisioned:
"vpc_services": [
  {
    "binding": "OPENCODE_VPC",
    "service_id": "<FILL_ME_VPC_SERVICE_ID>",
  },
],
```

Then:

```bash
npm run types      # regenerate worker-configuration.d.ts
npm run deploy      # or your usual deploy path — see docs/deployment.md
```

**Once `OPENCODE_TUNNEL_URL` and/or `OPENCODE_VPC` are set and the Worker is
deployed, `OpenCodeEngine.isConfigured` becomes `true`.** From that point:

- `review.engine: "auto"` (the default) tries `opencode` first for every PR.
- `review.engine: "opencode"` pins it (falls back to `native` only if
  OpenCode is unreachable/unhealthy).
- If OpenCode's `healthCheck()` fails, or `reviewPullRequest()` throws a
  retryable error (connectivity/5xx/timeout), the `CircuitBreaker` records a
  failure and the job **automatically falls back to `ComputerEngine`, then
  `NativeEngine`** — no manual intervention, no failed reviews. A non-retryable
  4xx/auth error also falls through to native but does **not** trip the
  breaker (it's treated as a config problem, not a flaky dependency).

## E. ComputerEngine (all-Cloudflare, experimental)

> **Experimental.** `@cloudflare/computer` ships as preview-only ("NOT
> suitable for production use" per its own README). `ComputerEngine`
> (`src/server/engines/computer-engine.ts`) is fully wired and unit-tested
> against an adapter interface, but the real `@cloudflare/computer` package
> is deliberately **not** a project dependency yet, and its reviewer runner
> defaults to a `notConfiguredRunner` that throws — so even once you enable
> the binding below, findings generation still needs the follow-up task that
> wires the real model+tool orchestration.

To enable the binding side (the part this runbook covers):

1. Add `@cloudflare/computer` to `optionalDependencies` in `package.json` —
   `optionalDependencies`, not `dependencies`, so its native transitive deps
   (e.g. `@mongodb-js/zstd`, `node-liblzma`) can never break `npm
   install`/CI for contributors who don't provision this engine.
2. In `wrangler.jsonc`, add the Durable Object / container binding named
   `COMPUTER_WORKSPACE` that `@cloudflare/computer`'s `Workspace` needs
   (follow its own setup docs for the DO class + container image). Run
   `npm run types` afterward.
3. Implement `RealComputerWorkspaceFactory.create()` in
   `src/server/engines/computer-engine.ts` via a **dynamic**
   `import('@cloudflare/computer')` inside the method (see the `ponytail:`
   comment directly above that class for the exact wiring notes — a DO class
   extending `withWorkspace`, `getWorkspace(stub)`, tarball extraction into
   `ws.fs`). The dynamic import keeps `@cloudflare/computer` out of the
   Worker's cold-start path unless `COMPUTER_WORKSPACE` is actually bound.
4. Supply a real `ComputerReviewerRunner` (replacing `notConfiguredRunner`)
   that drives the specialized reviewers' models with
   `@cloudflare/computer`'s `createAITools` against the populated workspace.

Until all four steps are done, `ComputerEngine.isConfigured()` stays `false`
and `resolveEngine` skips it — same zero-behavior-change guarantee as
OpenCode.

## Verification

- **Health endpoint:** `curl http://localhost:4096/health` on the Mac (or
  `curl https://<FILL_ME_PUBLIC_HOSTNAME>/health` with the Access service
  token headers, through the Tunnel) should return `200` before you expect
  `OpenCodeEngine` to be selected.
- **Analytics datapoint:** every review job emits a `REVIEW_ANALYTICS`
  datapoint (`emitReviewDatapoint`, `src/server/core/review-telemetry.ts`)
  whose `engine` and `breakerState` blobs are set from the same
  `engine_used` value persisted on the review (`src/server/core/review.ts`,
  `runFinalizePhase`). Query recent datapoints and confirm `engine`/
  `breakerState` read `opencode` (or `computer`) instead of `native` once
  provisioned — `native` means every non-native candidate was
  unconfigured/unhealthy/breaker-open and it fell all the way through.
- **Test PR:** open a small PR against a repo Codra reviews, with
  `review.engine` set to `auto` (or pinned to `opencode`) in its Codra
  config, and confirm the resulting review comments show up as usual. If
  they don't, check the Worker's logs for `Engine 'opencode' ...` lines
  (`resolveEngine` logs every skip/demotion decision) before assuming the
  infra is broken.

## Safety note

Every step in Sections A–E requires **your** Cloudflare account credentials
and **your** Mac (installing a launchd service, authenticating `cloudflared`,
creating an Access application/service token, provisioning Workers VPC,
editing `wrangler.jsonc` and deploying). None of it is run by an agent —
`scripts/opencode/install.sh` is explicitly marked "run by the operator, not
by CI/agents" and only performs local, idempotent, secret-free setup before
printing the remaining manual steps.
