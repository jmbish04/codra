# Frontend Routing

[Return to Parent Directory](../frontend.md)

Codra uses `react-router-dom` for client-side routing within a React Single Page Application (SPA).

The routing table is registered in `src/client/main.tsx` utilizing `createBrowserRouter` and `RouterProvider`.

## Loading Guards and Boundaries

Most components are wrapped in a `withSuspense` HOC.
This acts as a loader guard:
- It wraps the component in an `<ErrorBoundary>` to catch rendering errors.
- It provides a React `<Suspense>` boundary with a fallback loader (`<div role="status" aria-busy="true"... />`) while the lazy-loaded page component fetches.

## Explicit Route Tree

Below is the complete route tree explicitly extracted from the application logic.

| Path | Component Rendered | Description / Guard |
|------|-----------|-------------|
| `/` | `LandingPage` | The public landing page. Wrapped in `withSuspense(..., true)` for a full-page loader. |
| `/login` | `LoginPage` | The login page for GitHub OAuth. Wrapped in `withSuspense(..., true)`. |
| `/test-report/:jobId` | `TestReportPage` | Public test report accessible via PR links. Wrapped in `withSuspense(..., true)`. |
| `*` (Catch-all) | `NotFoundPage` | 404 Not Found error page. Wrapped in `withSuspense(..., true)`. |

### Authenticated App Shell Routes
These routes are nested as children under the `<AppShell />` layout element. They rely on `withSuspense` for inline component loading boundaries.

| Path | Component Rendered |
|------|-----------|
| `dashboard` | `DashboardPage` |
| `jobs` | `JobsPage` |
| `webhooks` | `WebhooksPage` |
| `standardization` | `StandardizationPage` |
| `actions` | `ActionsPage` |
| `secrets` | `SecretsPage` |
| `testing` | `TestingPage` |
| `jobs/:id` | `JobDetailPage` |
| `jobs/:id/logs` | `JobLogsPage` |
| `changelog/:slug` | `ChangelogDetailPage` |
| `repos` | `ReposPage` |
| `stats` | `StatsPage` |
| `settings` | `SettingsPage` |
| `prompts` | `PromptsPage` |
| `best-practices` | `BestPracticesPage` |
| `docs-review` | `DocsReviewPage` |
| `setup` | `SetupGuidePage` |
| `commands` | `CommandsPage` |
| `jules` | `JulesIntegrationPage` |
| `jules/operations` | `JulesOperationsPage` |
| `jules/monitor` | `JulesMonitorPage` |
| `jules/workflow` | `JulesWorkflowPage` |
| `planning` | `PlanningListPage` |
| `planning/new` | `PlanningNewPage` |
| `planning/:id` | `PlanningDetailPage` |
| `jules/monitor/:taskId` | `JulesSessionDetailPage` |
