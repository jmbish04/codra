# Stitch + Jules Orchestration

**Why this matters**: Claude's context window is a scarce resource. Stitch and Jules are force multipliers — Stitch generates visual mockups in seconds that would take Claude many turns to spec out, and Jules can execute entire coding tasks in parallel on its own 1M context window. Every hour spent on something Jules could do is an hour Claude's context is burning.

---

## Stitch: Frontend Mockup Workflow

### When to Invoke Stitch
Use Stitch **before writing any frontend code** when:
- Building a new page or view
- Adding a significant new UI section to an existing page
- The feature has non-obvious layout decisions (dashboards, forms, data tables, agent chat, etc.)

Do not use Stitch for purely structural/code changes with no visual component.

### Step 1 — Generate Mockups for the Full Feature Surface

Before prompting Stitch, map the complete page inventory for the feature:
- All primary views (list, detail, create, edit)
- All meaningful states (empty, loading, error, data-present)
- Mobile + desktop where layout differs significantly

Generate all of them — don't wait for the user to ask. A missed page that should obviously exist is a failure mode.

**Stitch prompt pattern** (always include dark theme + design system):
```
Dark theme, Cloudflare/shadcn aesthetic, Inter font, zinc base colors.
High-contrast text. Use shadcn-style components: Card, Badge, Table, 
Button variants (default/outline/ghost/destructive).

Page: Items Dashboard
- Sticky top navbar (links: Home, Docs, API (Scalar), API (Swagger))
- Collapsible left sidebar (hidden on mobile, sheet on mobile)
- Main content: 
  - Page title + "New Item" primary button (top right)
  - Filter bar: text search input + status dropdown (active/archived)
  - Data table: Name | Status | Created | Actions (sort on all columns)
  - Pagination controls (page size selector + prev/next)
  - Empty state: icon + "No items yet" + CTA button
  - Loading state: skeleton rows matching table layout
- All errors shown as shadcn AlertDialog (never browser alert)
- Mobile: table scrolls horizontally, sidebar becomes bottom-right FAB
```

### Step 2 — Claude Reviews the Stitch Output

After Stitch generates each screen, Claude must review it against the full project context before presenting anything to the user. Check for:

| Gap Type | Example | Action |
|---|---|---|
| Missing page | Items list exists but no detail/edit view | Generate the missing screen |
| Missing state | Table page has no empty or loading state | Generate those variants |
| Missing mobile | Only desktop generated for complex layout | Generate mobile variant |
| Logical next step | Create form exists but no success/confirmation state | Generate it |
| Implied feature | Items have status field but no bulk-action controls | Generate variant with bulk select |

Use judgment — generate the gaps, don't ask for permission on obvious ones.

### Step 3 — Present to User for Review

Present a structured summary, not just a pile of screenshots:
```
I've generated mockups for the Items feature. Here's what Stitch produced:

✅ Items Dashboard — desktop (list + filter + table + pagination)
✅ Items Dashboard — mobile (collapsible sidebar, horizontal scroll table)  
✅ Item Detail — desktop
✅ New Item Form — desktop + mobile
✅ Empty state + Loading skeleton variants

I also added these that seemed obviously needed:
+ Bulk selection toolbar (Delete selected, Export) — let me know if you'd prefer to skip this
+ Success toast confirmation after create/edit

Please review the mockups. If anything feels incomplete or off-brand, tell me and I'll have Stitch revise before we start building.
```

Only begin code generation after user acknowledges the mockups look right.

---

## Jules: Coding Task Delegation

### The Core Principle

Jules is a capable coding agent but it:
- Has no access to the Cloudflare skill or Cloudflare docs MCP
- Does not know your specific Env bindings or project conventions
- Can be inconsistent on Cloudflare-specific patterns without detailed instructions
- Does best work when tasks are self-contained and fully specified

**Compensate with detail**: Jules has a 1M context window — use it. A 5,000-word Jules prompt is not excessive if it prevents a deviation that would cost 2 Claude turns to diagnose and fix.

### What to Trust Jules With

| ✅ Safe for Jules | ❌ Keep in Claude |
|---|---|
| React/TSX components (given exact interface + styling spec) | wrangler.toml changes |
| Astro page structure (given the layout template) | D1 migrations |
| Hono route handlers (given exact drizzle-zod schemas) | worker-configuration.d.ts |
| drizzle-zod schema additions (given the table definition) | AI Gateway / Agents SDK setup |
| Utility functions and helpers | wrangler types regeneration |
| Test files (unit + integration) | Deployment config |
| Documentation pages (`.tsx` doc components) | Complex Drizzle query optimization |
| AGENTS.md updates | CI/CD pipeline changes |
| Refactoring within a single file | Any binding-related code |

### AGENTS.md — The Jules Briefing File

Always maintain `/AGENTS.md` in the project root. This file is the persistent context Jules reads at the start of every session. Keep it accurate and complete.

```markdown
# AGENTS.md — Project: [App Name]

## Purpose
[1-2 sentences on what this app does]

## Stack
- Backend: Hono + @hono/zod-openapi, running on Cloudflare Workers
- Database: Cloudflare D1 (SQLite) with Drizzle ORM and drizzle-zod
- Frontend: Astro SSR with @astrojs/cloudflare adapter, React islands, shadcn/ui
- AI: Cloudflare Agents SDK + AI Gateway (Workers AI default)
- Package manager: pnpm

## Project Structure
[paste from SKILL.md project structure section, updated for this repo]

## Absolute Rules (Never Break These)
- NEVER manually edit `worker-configuration.d.ts` — it is auto-generated by `wrangler types`
- NEVER import or redefine the `Env` interface — it is globally declared
- NEVER use `window.alert()`, `window.confirm()` — use shadcn AlertDialog
- NEVER use mock/hardcoded data — all data from real API calls
- NEVER use `wrangler deploy` directly — use `pnpm run deploy`
- ALL errors must dispatch to `window.dispatchEvent(new CustomEvent('app:error', {...}))`
- ALL data tables must include sort + filter + pagination
- shadcn dark theme is always the default

## Existing Bindings (from wrangler.toml)
- `env.DB` — D1 database (type: D1Database)
- `env.AI` — Workers AI binding (type: Ai)
- `env.CACHE` — KV namespace
[...update for actual project]

## Key Files
- `src/db/schema.ts` — all Drizzle table definitions and drizzle-zod exports
- `src/hono/index.ts` — Hono app instance, OpenAPI docs routes
- `src/middleware.ts` — routes /api/* to Hono, rest to Astro
- `src/lib/ai-gateway.ts` — universal model provider factory
- `src/pages/_components/ErrorLogger.tsx` — global error handler

## Coding Style
- TypeScript strict mode throughout
- Named exports for components, default exports for Astro pages
- Drizzle-zod schemas from `src/db/schema.ts` are the source of truth for all types
- Component files: PascalCase.tsx; utility files: camelCase.ts
- All async operations wrapped in try/catch with error dispatch
- Tailwind for styling — no inline CSS, no CSS modules

## Running the Project
pnpm install && pnpm run types && pnpm run migrate:local && pnpm run dev
```

### Writing a Jules Prompt

**Format**: Pass as the initial session message. Be maximally specific. Jules has 1M context — there is no such thing as too much detail in a Jules prompt.

**Template**:
```
## Task
[1-sentence summary]

## Context
This is a Cloudflare Workers app using Hono + Astro SSR + Drizzle D1 + shadcn/ui.
Read AGENTS.md before doing anything. It has the absolute rules you must follow.

## Existing Code You'll Need
[paste relevant schema types, existing component interfaces, relevant file contents]

## Files to Create/Modify
### CREATE: src/pages/items.astro
Purpose: Items list page
- Uses AppLayout from ../../layouts/AppLayout.astro
- Fetches items from `/api/items?limit=25&offset=0` on the server side via Astro.locals.runtime.env
- Passes fetched data as props to the ItemsTable React island
- Sets page title to "Items"

### CREATE: src/pages/_components/ItemsTable.tsx
Purpose: React island for items data table
Interface:
  props: {
    initialData: { data: Item[], pagination: Pagination }
  }
Requirements:
- Use @tanstack/react-table for table logic
- Columns: Name (sortable), Status (sortable + filterable), Created (sortable), Actions
- Text search input (debounced 300ms) filters Name column client-side
- Status filter dropdown: All / Active / Archived
- Pagination: 25 per page default, show total count
- Loading state: 5 skeleton rows (use shadcn Skeleton)
- Empty state: centered icon + "No items yet" + "Create Item" Button (variant="outline")
- Row actions: Edit (pencil icon), Archive/Restore (toggle based on status)
- All errors dispatched via: window.dispatchEvent(new CustomEvent('app:error', { detail: { message, context: 'ItemsTable', serverError } }))
- NEVER use window.alert() or window.confirm()

## What NOT to Do
- Do not touch wrangler.toml or worker-configuration.d.ts
- Do not add any new npm packages without noting them in your PR description
- Do not create mock data — use only what's passed via props
- Do not write CSS files — tailwind classes only

## PR Instructions
- Branch: feat/items-frontend
- Commit: "feat: add items list page with sortable/filterable table"
- PR title: "Items Frontend — Table + Astro Page"
- PR description: list each file created and what it does
```

### Spawning and Monitoring a Jules Session

```typescript
// Pattern: Claude spawns Jules, then checks in periodically
// 1. Create session
const session = await jules.create_session({
  source: 'github:owner/repo',
  prompt: julesPrompt,  // the detailed prompt above
})

// 2. Monitor — check every few minutes
const state = await jules.get_session_state({ sessionId: session.id })
// state.status: 'pending' | 'running' | 'waiting_for_approval' | 'done' | 'failed'

// 3. Course-correct if needed
if (state.status === 'waiting_for_approval') {
  // Jules has a plan ready — review it
  await jules.approve_session_plan({ sessionId: session.id })
}

// 4. If Jules goes off-track, send a correction message
await jules.send_session_message({
  sessionId: session.id,
  message: 'You are using window.alert() in ItemsTable.tsx. Remove it and use the window.dispatchEvent(app:error) pattern instead as specified in AGENTS.md.'
})
```

### Parallel Work Pattern

The most efficient use of context: Claude handles Cloudflare-specific backend work while Jules builds the frontend.

```
Claude does:                          Jules does (in parallel):
─────────────────────────────────     ───────────────────────────────────
• Update wrangler.toml bindings       • Build React component islands
• Run wrangler types                  • Build Astro page structure
• Write Drizzle schema + migration    • Build data table with sort/filter
• Write Hono route with zod-openapi   • Build form with validation UI
• Set up AI Gateway model config      • Write unit tests for components
• Deploy + validate API is working    • Open PR for frontend changes
```

When using this pattern:
1. Define the Drizzle schema and run `db:generate` first (Jules needs the types)
2. Provide Jules with the exact TypeScript types it needs (export from schema.ts)
3. Tell Jules the exact API endpoint shape (copy the zod-openapi route definition)
4. Review Jules' PR before merging — verify it followed AGENTS.md conventions

### Course Correction Checklist

When reviewing a Jules session or PR, check for these common deviations:

- [ ] Is `Env` imported anywhere? → Should not be — it's global
- [ ] Any `window.alert()` calls? → Must dispatch to `app:error`
- [ ] Any hardcoded/mock data? → Remove, wire to real API
- [ ] Tables missing sort/filter? → Add per UX standards
- [ ] Using `wrangler deploy` or modifying `wrangler.toml`? → Reject
- [ ] Components in correct directory? → `src/pages/_components/`
- [ ] Dark theme applied? → Check for `class="dark"` or Tailwind dark: classes
- [ ] Error boundaries in place? → try/catch with `app:error` dispatch
- [ ] New packages added without noting them? → Flag in PR review

If Jules makes a mistake, send a precise correction via `send_session_message` with:
1. The exact file and line
2. What it did wrong
3. The exact pattern to use instead (quote from AGENTS.md or this skill)

### Context Efficiency Rule

When a task is appropriate for Jules:
1. Write the Jules prompt (detailed, as above)
2. Spawn the session
3. Switch to Claude-only backend tasks while Jules runs
4. Check in on Jules when your current task is complete
5. Do NOT use Claude turns to do things Jules can handle

Burning Claude context on boilerplate UI that Jules could build is wasteful. Every Claude turn should be on something that genuinely requires Cloudflare expertise or high-level orchestration decisions.
