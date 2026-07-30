# Jules integration + operations dashboard pages

## Pages added

- `src/client/pages/jules-integration.tsx` — `/jules`, nav label "Jules". Static reference
  page built from `PageHeader` + bordered card sections (`Section` local helper), matching
  the `actions.tsx`/`setup-guide.tsx` house style. Covers: what the Docs Gap step checks
  (AGENTS.md/CLAUDE.md, README.md, frontend docs/ suite, under-documented functions),
  merge-only launch semantics, prerequisites (Jules GitHub app + JULES_API_KEY secret),
  a link to `/jules/operations`, the `review.jules.enabled` config toggle, and a dedicated
  "GitHub Action secrets" section with `CopyButton` for `CLOUDFLARE_ACCOUNT_ID` /
  `CLOUDFLARE_API_TOKEN`, the auto-set-vs-degrade behavior tied to the `Actions Secrets: write`
  GitHub App permission, manual setup steps, the commented-out auto-deploy trigger, and the
  `review.deployWorkflow.enabled` toggle.

- `src/client/pages/jules-operations.tsx` — `/jules/operations`, nav label "Jules Ops". Data
  page following `actions.tsx`'s loading/error/empty pattern exactly (`PageHeader` + `Alert`
  + `EmptyState` + per-item bordered cards). Fetches `api.getJulesSessions({ limit: 200 })`
  (existing method, untouched). Renders per session: a tone-mapped `Badge` for `state`
  (launched=success, staged=info, skipped=neutral, error=danger), `owner/repo`, triggering PR
  number, `formatDateTime(created_at)`, `gap_summary`, `error_msg` when present, the full
  `prompt` in a collapsible `<details>`/`<pre>`, and — when `session_id` is present — a
  `CopyButton` for the session id plus an "Open in Jules" link to `session_url`
  (`target="_blank" rel="noopener noreferrer"`). Prompt/gap_summary are rendered as plain
  React children (auto-escaped), no `dangerouslySetInnerHTML`.

  Note: `JulesSessionDto` (in `src/shared/api.ts`) only has `created_at`, no `updated_at` —
  the spec asked for "created/updated timestamps" but there is no updated-at field on the
  DTO, so only `created_at` is shown. Flagging in case a future migration adds one.

## Wiring

- `src/client/main.tsx`: added two `safeLazy` imports (`JulesIntegrationPage`,
  `JulesOperationsPage`) next to the other page imports, and two child routes under
  `<AppShell />`: `{ path: 'jules', ... }` and `{ path: 'jules/operations', ... }`.
- `src/client/components/layout/app-shell.tsx`: added `Bot` and `ListChecks` to the
  lucide-react import (both confirmed to exist in the installed lucide-react 1.23.0), and
  two nav entries — `/jules` ("Jules", `end: true`) and `/jules/operations` ("Jules Ops",
  `end: false`) — placed directly after the existing `/actions` ("Codra Actions") entry.

## Verify

`npm run typecheck` — zero output, exit 0 (no type errors).

`npm run build` — Vite client build succeeded ("✓ built in 1.69s", one pre-existing chunk-size
warning unrelated to this change), followed by `wrangler types` regenerating
`worker-configuration.d.ts`. Exit 0.

## Component reuse notes

No new UI primitives were introduced. Reused as-is: `PageHeader`, `Badge` (+ its exported
`BadgeProps` type for the state-tone mapper), `Alert`, `EmptyState`, `CopyButton`,
`formatDateTime`, and the existing lucide-react icon set (added `Bot`, `ListChecks`,
`FileSearch`, `GitMerge`, `ShieldCheck`, `KeyRound`, `Settings` — all already used elsewhere
in the app or standard lucide-react icons). No backend routes, DTOs, or API client methods
were touched.

## Concerns

- `JulesSessionDto` has no `updated_at`; only `created_at` is displayed (see note above).
- The integration page's "GitHub Action secrets" facts (auto-set behavior, manual steps,
  commented-out auto-deploy, `review.deployWorkflow.enabled`) were cross-checked directly
  against `src/server/core/deploy-workflow.ts` and `src/server/core/github-secrets.ts` to
  avoid overstating; wording mirrors what those modules actually do.

## Review-fix pass (2026-07-30)

### FIX 1 — surface no-API-key skip on the PR (Important)

`src/server/core/jules.ts` `launchStagedJulesSessions`: the missing-`JULES_API_KEY` branch
previously only called `markJulesOutcome(..., { state: 'skipped' })`, leaving the original
"once merged, Codra will open a Jules session" PR comment uncorrected. Added a best-effort
`github.updateIssueComment` call per staged row with a `pr_comment_id`, mirroring the
not-connected branch's structure exactly (loop, `.catch(() => {})`, never throws):

> "📚 Codra staged a Jules docs session, but `JULES_API_KEY` is not configured, so no session
> was opened."

The DB `markJulesOutcome` call is unchanged.

`test/jules-launch.spec.ts`: added a new case — staged row with `pr_comment_id: 42`, env's
`JULES_API_KEY.get()` returns `''` — asserting `markJulesOutcome` is called with
`state: 'skipped'` and `github.updateIssueComment('o', 'r', 42, ...)` is called with a message
containing `JULES_API_KEY`. All 3 pre-existing cases untouched and still pass.

### FIX 2 — remove duplicate Jules UI from the Actions page (Important)

`src/client/pages/actions.tsx` had its own "Jules documentation sessions" section (state,
effect, and JSX block) that duplicated `/jules/operations`. Removed:
- the `jules` `useState<JulesSessionDto[]>` and its `useEffect` (`api.getJulesSessions(...)`)
- the entire `{jules.length > 0 && (...)}` JSX block
- the now-unused imports: `JulesSessionDto` (type), `CopyButton` (not used elsewhere on this
  page)

Added a `react-router-dom` import and a one-line note under the page header:

> "Jules documentation sessions have moved to **Jules Ops**." (linking to `/jules/operations`,
> matching the existing nav-item label in `app-shell.tsx`)

The agent-actions list (loading/error/empty states, action cards) is untouched.
`npm run typecheck` confirms no dangling references.

### FIX 3 — integration-page accuracy: auto-set also needs codra's CF bindings (Minor)

`src/client/pages/jules-integration.tsx` "GitHub Action secrets" section: added one sentence
noting that the auto-set path also requires codra's own `CF_ACCOUNT_ID`/`CF_API_TOKEN`
secret-store bindings to be populated (confirmed against `src/server/core/deploy-workflow.ts`
lines 156-159, which fetch both via `getSecretStoreBinding` and fall back to
`{ ok: false, reason: 'CF_ACCOUNT_ID or CF_API_TOKEN secret store binding is empty' }` when
either is empty) — i.e. it's gated on both the GitHub App permission *and* these bindings.

### FIX 4 — align Jules domain (Minor)

`jules-integration.tsx` had two `https://jules.google` references (one link href/label, one
plain-text mention in the page description) while `src/server/core/jules.ts`'s PR-comment
text and `src/server/services/jules.ts`'s session-URL fallback both use
`https://jules.google.com`. Updated both to `jules.google.com` for consistency.

### FIX 5 — defensive href guard (Minor)

`src/client/pages/jules-operations.tsx`: the "Open in Jules" anchor now only renders when
`s.session_url && s.session_url.startsWith('https://')`; otherwise only the `CopyButton` for
the session id is shown.

## Verification tails

```
$ npx vitest run test/jules-launch.spec.ts
 Test Files  1 passed (1)
      Tests  4 passed (4)
   Start at  05:38:54
   Duration  559ms

$ npm run typecheck
> codra@0.9.2 typecheck
> tsc --noEmit
(zero output, exit 0)

$ npm run build
...
[plugin builtin:vite-reporter]
✓ 5018 modules transformed.
✓ built in 913ms
...
✨ Types written to worker-configuration.d.ts
(exit 0)
```

Full-suite `npx vitest run` shows 6 failing test files (`api.spec.ts`, `resumable-queue.spec.ts`,
`webhook-handling.spec.ts`, `model-service.spec.ts`, `review-flow.spec.ts`,
`e2e/dashboard.spec.tsx`) — all pre-existing and unrelated to this change (none reference
`jules.ts`, `actions.tsx`, `jules-integration.tsx`, or `jules-operations.tsx`); matches the
known repo test-harness quirk.
