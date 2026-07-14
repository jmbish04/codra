# Monolith / Cloudflare-Jedi Data Override

> **This applies whenever a data skill (`sql`, `data-viz`, `data-analysis`) runs inside a Cloudflare Worker + Astro SSR project. The generic skill guidance is the floor; the rules below are the ceiling.** Apply them automatically — do not ask the user to opt in. Pair with `cloudflare-jedi` for stack conventions and `taste-design` for the Monolith visual profile.

### Stack you write to (non-negotiable)

| Concern | Tool |
|---|---|
| Storage | Cloudflare D1 (SQLite) accessed via **Drizzle ORM only** — never raw SQL in app code |
| API | **Hono** route handlers in `src/api/`, validated with `@hono/zod-openapi` (Zod v4) |
| Charts | **shadcn/ui charts** (`<ChartContainer>`) on top of **Recharts**, themed with the Monolith OKLCH palette in `globals.css` — never raw recharts, never matplotlib/plotly for production output |
| Frontend | Astro SSR + React islands (`client:load` / `client:visible`) — deployed as a single Cloudflare Worker with `[assets]`, not Pages |
| Enrichment | AI: Workers AI / AI Gateway / Agents SDK. Non-AI: deterministic JS transforms in a `src/lib/enrichment/` module — bucketing, geocoding, currency normalization, time-bucket alignment, joins against reference tables |

If the user pastes raw SQL or asks for matplotlib/plotly, gently redirect into the stack above. If they want a one-off HTML dashboard for sharing, fine — but the canonical deliverable is **a route in the Astro app backed by Hono+Drizzle**.

### Autopilot — exploratory by default

When a user invokes a data skill in a Cloudflare-jedi project, do all of this before producing a chart or a query:

1. **Read the schema.** Open every file under `src/db/schema/` (or wherever Drizzle schemas live) and build a mental ERD: tables, FKs, time columns, enum/categorical columns, numeric measures, soft-delete flags, multi-tenant scoping (`workspace_id`, `account_id`, etc.).
2. **Read the routes.** Skim `src/api/` to learn what's already exposed and what isn't — you will reuse existing Hono endpoints, not duplicate them.
3. **Sample the data** when D1 is reachable (`wrangler d1 execute … --remote`) — row counts per table, min/max of time columns, distinct counts for likely dimensions, null rates, recent activity by day. This is the EDA pass.
4. **Infer the user's likely questions** from the schema. A `subscriptions` table with `started_at`, `canceled_at`, `plan` → cohort retention, MRR by plan, churn curve. An `events` table with `event_name`, `user_id`, `properties_json` → funnels, DAU/WAU/MAU, top events. Don't ask the user to spell this out — bring it.
5. **Propose a complete dashboard, not a single chart.** A complete dashboard typically has: ≥1 KPI row (4–6 stat cards with deltas vs prior period), ≥1 time-series (line/area), ≥1 distribution (bar/histogram), ≥1 breakdown (stacked bar or grouped), ≥1 table with conditional formatting, plus filters (date range + 1–2 dimensions). Anything less is a draft, not a dashboard.

### Warm-start prompting (never cold-start)

You are **forbidden** from asking the user "what do you want from your data" or any cold-start variant. If you genuinely need their input, you must:

1. Write a `docs/PLAN.md` (or `docs/data/<feature>-plan.md`) document.
2. Lead with **your best inference** of what they care about ("I read the `orders`, `customers`, and `refund_requests` tables and I think you want to monitor refund-rate drift, identify high-LTV cohorts at risk, and watch for fraud signals — here's how I'd cut it.").
3. List the **charts you intend to build** with one-line justifications, grouped under each inferred question.
4. Surface **decisions only you can't make** (e.g., "Is a refund within 7 days of order considered 'early refund'?" "Should we exclude internal accounts? I see two candidates: `email LIKE '%@yourdomain%'` or the `is_internal` flag — which is canonical?").
5. End with: *"Edit this plan inline — strike anything you don't want, append any goals/thoughts I missed. I'll execute the surviving plan."*

This is the only correct way to ask the user a question from a data skill.

### AI enrichment & non-AI enrichment

Every Cloudflare-jedi data deliverable should consider both:

- **Non-AI enrichment first** (cheap, deterministic, debuggable): time-bucket alignment, currency normalization, country-code → continent, IP → coarse geo, bucketed cohorts (`days_since_signup_bucket`), join keys against reference tables, RFM scoring.
- **AI enrichment second** (expensive, probabilistic, must be cached): sentiment / topic on free-text, summarization of long descriptions, embedding-based clustering, intent classification. Route through **AI Gateway** for caching + cost visibility. Persist enrichments back into D1 (`enrichment_v1` columns or a sibling table) so re-runs are free.

If the data has free-text fields and you do *not* propose at least one AI enrichment, you have under-delivered.

### Visualization stack (use these, not the generic ones)

- Use shadcn's `<ChartContainer>`, `<ChartTooltip>`, `<ChartLegend>` wrappers around Recharts primitives.
- Apply the Monolith OKLCH chart palette (see `shadcn-ui/SKILL.md` § "Monolith chart palette") — never use stock recharts colors.
- Dark theme always. No traditional 1px borders — use rings + dividers per Monolith.
- Build chart variants behind a small typed component layer (`src/components/charts/<chart-name>.tsx`) so they're reusable. One-off inline recharts in a page is a smell.

### When to break out a one-off HTML dashboard

Only when (a) the deliverable is genuinely outside the worker (e.g., a board pack, a one-time analysis to email), and (b) the user explicitly asked for a sharable file. Otherwise: a route on the Astro app is the default.

### Anti-patterns (refuse to ship)

- A "dashboard" page that contains one chart.
- A chart that doesn't show a delta, a comparison, or a target.
- A "select your dimension" empty state with no default — always default to the most informative cut.
- Raw SQL strings in component code — go through Drizzle.
- Bypassing Hono with direct D1 binding usage in a route — go through a Hono handler so the OpenAPI schema stays honest.
- Asking the user "what do you want to see?" — see the warm-start rule above.
