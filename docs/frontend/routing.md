# Frontend Routing

[Return to Index](../README.md)

Codra uses `react-router-dom` for client-side routing. The application uses a single `createBrowserRouter` setup located in `src/client/main.tsx`. Code-splitting is implemented for all page components via a custom `safeLazy` wrapper around `React.lazy` combined with `Suspense`.

## Route Table

Below is the complete route tree of the application:

### Public / Unauthenticated Routes
These routes render without the main application layout (`AppShell`).

- **`/`** - `LandingPage`
- **`/login`** - `LoginPage`
- **`/test-report/:jobId`** - `TestReportPage` (Public test report)

### Authenticated / Dashboard Routes
These routes are rendered inside the `<AppShell />` layout wrapper.

- **`/dashboard`** - `DashboardPage`
- **`/jobs`** - `JobsPage`
- **`/queue`** - `QueuePage`
- **`/webhooks`** - `WebhooksPage`
- **`/standardization`** - `StandardizationPage`
- **`/actions`** - `ActionsPage`
- **`/secrets`** - `SecretsPage`
- **`/testing`** - `TestingPage`
- **`/jobs/:id`** - `JobDetailPage`
- **`/jobs/:id/logs`** - `JobLogsPage`
- **`/changelog/:slug`** - `ChangelogDetailPage`
- **`/repos`** - `ReposPage`
- **`/stats`** - `StatsPage`
- **`/settings`** - `SettingsPage`
- **`/prompts`** - `PromptsPage`
- **`/best-practices`** - `BestPracticesPage`
- **`/docs-review`** - `DocsReviewPage`
- **`/setup`** - `SetupGuidePage`
- **`/commands`** - `CommandsPage`
- **`/jules`** - `JulesIntegrationPage`
- **`/jules/operations`** - `JulesOperationsPage`
- **`/jules/monitor`** - `JulesMonitorPage`
- **`/jules/workflow`** - `JulesWorkflowPage`
- **`/planning`** - `PlanningListPage`
- **`/planning/new`** - `PlanningNewPage`
- **`/planning/:id`** - `PlanningDetailPage`
- **`/jules/monitor/:taskId`** - `JulesSessionDetailPage`

### Catch-all Route
- **`*`** - `NotFoundPage` (Renders without `AppShell`)

## Error Handling & Loading States

Every route is wrapped in an `ErrorBoundary` that catches rendering errors and displays a fallback UI. While lazy-loaded chunks are being fetched, a `Suspense` fallback with a loading spinner (`div[role="status"]`) is rendered.
