# Orchestration tax controls

Managing distributed agent processes (Jules sessions, scheduled tasks, sub-agent invocations, MCP tool chains) compounds token cost as each layer re-reads context. These controls enforce budget-safe delegation.

## 1. The 3-minute boundary

If a delegated sub-session (Jules, scheduled remote agent, sub-agent, MCP tool with `run_in_background`) goes silent for more than **3 minutes**, the parent must:

1. **Terminate** the sub-session (`mcp__jules__send_session_message` with stop directive, or kill the background process).
2. **Reclaim** orchestration context — read what was committed, identify what was in flight.
3. **Finish directly** — the parent agent completes the work in its own context.

**Why 3 minutes?** Stalled sub-sessions accumulate hidden token cost (heartbeat replays, retry context). A direct completion in the parent is cheaper than waiting for an indeterminate sub-session to resume.

**Exceptions**:
- A long-running Stitch generation (the MCP call itself blocks until the screen is ready) — wait it out, it's a single tool call.
- A `wrangler deploy` that's actively streaming logs — wait it out, streaming counts as progress.
- A scheduled remote agent that's confirmed running on cron — its silence is expected between fires.

If unsure whether it's truly silent vs streaming, check for last-output timestamp. If the timestamp is >180s old AND no new output is queued, terminate.

## 2. Explicit branch anchoring

Every brief sent to a sub-agent (Jules session prompt, scheduled task payload, sub-agent prompt) must explicitly cite:

- The active git branch (e.g., `feat/v8.1-migration`).
- The parent commit hash (`git rev-parse HEAD`).
- The expected base branch (e.g., `main`).

Why: sub-agents default to `main` when ambiguous. Without explicit anchoring, a Jules session can produce a PR against `main` that ignores your in-progress `feat/v8.1-migration` work, causing noisy diff conflicts.

Anchor pattern in a Jules brief:

```markdown
## Branch anchor
- Branch: `feat/v8.1-migration`
- Parent commit: `e3a4b2c`
- Base: `main`
- Open work-in-progress (do not overwrite): src/pages/dashboard.astro, backend/db/schemas/runs/

DO NOT branch from main. DO NOT rebase. Work on the named branch from the named commit.
```

## 3. Context bleed defense

Before delegating ANY task to a sub-agent, strip the payload to a greenfield boundary:

- Remove repo noise (unrelated changes, large unrelated files, unrelated agent transcripts).
- Isolate the slice the sub-agent needs — usually one feature directory + one schema + relevant docs.
- Pin the inputs explicitly: file paths, line ranges, exact zod schemas, exact API contracts.

Anti-pattern: handing Jules a brief that says "look at the project and do the thing." Jules will read everything, blow context, then make uninformed decisions.

Good pattern: "Work in `src/pages/runs/` and `backend/db/schemas/runs/`. Don't touch anything else. Input contract: zod schema in `backend/db/schemas/runs/index.ts`. Output contract: a `<RunsTable>` React island in `src/pages/_components/runs/RunsTable.tsx`."

## 4. Completeness mandate

Every code output from any agent (Jules, sub-agent, this agent) must be **end-to-end complete**. Banned patterns:

- ❌ `// ... rest of code remains the same`
- ❌ `/* unchanged */`
- ❌ `// existing implementation here`
- ❌ Partial diffs with no fallback to full file
- ❌ "I'll let you fill in the X part" — no, write the X part.

If the output would be too long for a single response, split by FILE (one full file per response), not by section-of-file. The reader must be able to copy each block as a deployment-ready file.

When Jules emits a partial output, the parent must:
1. Catch it in the review pass.
2. Reject the partial PR or send a `send_session_message` directive: "rewrite as complete files, no `// ... rest unchanged` patterns."
3. Re-review.

## 5. Token budget pre-flight

Before kicking off a multi-step delegated workflow:

1. Estimate the parent agent's remaining context. If <30%, reset or finish in-place — don't delegate further.
2. Estimate the sub-agent's brief length. If >50KB, split into two briefs or condense.
3. Confirm there's no recursion (sub-agent → sub-sub-agent → parent → loop).

## 6. Telemetry

Every delegated session is logged to `docs/orchestration-log.md` (project-local) with:

- Session ID / agent type
- Brief sent (or summary if too long)
- Branch anchor
- Start / end timestamps
- Termination reason (success / 3-min boundary / explicit kill / errored)
- What was reclaimed

This log is read during retrospectives and informs future delegation choices.

## Cross-references

- `cloudflare-jedi/references/stitch-jules-orchestration.md` — Jules-specific session mechanics, AGENTS.md template, `send_session_message` patterns.
- `stitch-loop/SKILL.md` — where the 3-min boundary fires most often.
- `stitch-orchestrator/SKILL.md` — the layer that decides whether to delegate at all.
