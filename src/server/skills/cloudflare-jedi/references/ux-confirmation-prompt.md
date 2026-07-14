# UX-workflow confirmation prompt + queued-backlog format

> Canonical source: `stitch-orchestrator/templates/ux-confirmation-prompt.md`. This file is the cloudflare-jedi-side documentation that ties the orchestrator into the planning matrix and documents the queued-backlog file shape.

## When this prompt fires

The cloudflare-jedi Q1×Q2 planning matrix determines whether a request touches UX (`Q2=YES`). When `Q2=YES`:

- The orchestrator fires the UX-workflow confirmation prompt (`stitch-orchestrator` Step 2).
- The prompt sits AFTER the Q1×Q2 matrix, not before.
- If `Q2=NO`, the prompt never fires.

## The prompt mechanic

`stitch-orchestrator` invokes `AskUserQuestion` with up to 4 options:
- The recommended workflow (first, tagged "Recommended").
- 2 adjacent alternatives.
- `no-ux` (always last, always available).

If the user selects "Other," the orchestrator asks one more clarifying question with the remaining workflows.

Full template in `stitch-orchestrator/templates/ux-confirmation-prompt.md`.

## When the user picks `no-ux`

The orchestrator queues the request to `docs/backlog/queued-ux/${slug}.md`. The file format:

```markdown
---
queued_at: 2026-05-17T14:32:00Z
original_request: "Add a saved-prompts panel to the agent chat"
recommended_workflow: stitch-orchestrate
rationale: "Implies 2+ new pages plus edits to existing chat page; sitemap needed."
status: queued
---

## Original user prompt

> Add a saved-prompts panel to the agent chat with categories, search, and pin-to-top.

## Suggested workflow when revisited

- Start with `stitch-orchestrator` → `stitch-orchestrate` workflow.
- The orchestrator should:
  1. Re-classify intent (heuristics may have changed).
  2. Confirm the recommendation with the user.
  3. Route to `stitch-loop`.

## Auto-detected capabilities involved

- D1 tables: prompts, prompt_categories, agent_sessions
- Hono routes: GET /api/prompts, POST /api/prompts, GET /api/categories
- Existing components touched: src/pages/chat.astro, src/pages/_components/AgentChat.tsx
- Capabilities consumed: listPrompts, createPrompt, listCategories, openAgentChat

## Notes

- Original session: ${SESSION_ID_OR_TIMESTAMP}
- User context at queue time: ${ONE_LINE_USER_STATE}
```

## `${slug}` naming convention

`${slug}` = first 6 significant words of the user's request, kebab-case. Stop words removed: the, a, of, for, to, and, in, on, at, by, with, that, this. Numeric suffix on collision (`-2`, `-3`, ...).

Examples:

| User request | Slug |
|---|---|
| "Add a saved-prompts panel to the agent chat" | `add-saved-prompts-panel-agent-chat.md` |
| "Make the runs page sortable and filterable" | `make-runs-page-sortable-filterable.md` |
| "Show recent activity on the dashboard" | `show-recent-activity-dashboard.md` |
| "Fix the navbar height on mobile" | `fix-navbar-height-mobile.md` |
| "Make the runs page sortable and filterable" (second time) | `make-runs-page-sortable-filterable-2.md` |

## Picking up a queued item later

When the user says "pick up the queued UX work" or "run the queued stitch tasks":

1. List `docs/backlog/queued-ux/*.md` (skip files with `status: completed` or `status: cancelled` in frontmatter).
2. Present a numbered list with the `original_request` of each.
3. User picks one.
4. `stitch-orchestrator` re-runs intent classification on the original request — heuristics may have changed since queueing.
5. If the new recommendation matches the queued `recommended_workflow`, proceed directly. If not, ask the user to confirm.
6. After successful completion, update the queue file's `status: completed` and add `completed_at: ${ISO}` to the frontmatter.

## Anti-patterns

- ❌ Firing the confirmation prompt for backend-only requests (`Q2=NO` should suppress it).
- ❌ Auto-running `stitch-initiate` without the prompt because "it's obviously greenfield."
- ❌ Writing the queued backlog file without a `recommended_workflow` field (future-you needs the breadcrumb).
- ❌ Using a non-kebab-case slug (file system case-sensitivity bites).
- ❌ Forgetting to update `status` to `completed` after running a queued item — orphans the entry.

## Cross-references

- `stitch-orchestrator/SKILL.md` — the skill that runs this prompt.
- `stitch-orchestrator/templates/ux-confirmation-prompt.md` — canonical AskUserQuestion template.
- `stitch-orchestrator/references/workflow-routing.md` — the 6 workflows.
- `stitch-orchestrator/references/intent-classifier.md` — recommendation heuristics.
- `cloudflare-jedi/SKILL.md` — Q1×Q2 matrix that gates this prompt.
