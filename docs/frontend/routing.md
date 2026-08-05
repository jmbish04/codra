# Frontend Routing

[Return to Index](../README.md)

Codra uses `react-router-dom` for client-side routing in a React Single Page Application (SPA).

Below is the complete route table outlining the paths and components registered in `src/client/main.tsx`.

| Path | Component | Description |
|------|-----------|-------------|
| `/` | `LandingPage` | The public landing page. Full page suspense. |
| `/login` | `LoginPage` | The login page for GitHub OAuth. Full page suspense. |
| `/test-report/:jobId` | `TestReportPage` | Public test report accessible via PR links. Full page suspense. |

## Authenticated App Shell Routes
These routes are nested under the `<AppShell />` layout.

| Path | Component | Description |
|------|-----------|-------------|
| `/dashboard` | `DashboardPage` | Overview of system stats and recent jobs. |
| `/jobs` | `JobsPage` | List of review jobs. |
| `/jobs/:id` | `JobDetailPage` | Specific review job details. |
| `/jobs/:id/logs` | `JobLogsPage` | Logs for a specific review job. |
| `/webhooks` | `WebhooksPage` | Webhook delivery inspection. |
| `/standardization` | `StandardizationPage` | Custom rules and standards configuration. |
| `/actions` | `ActionsPage` | Automated actions and integrations. |
| `/secrets` | `SecretsPage` | Secrets management dashboard. |
| `/testing` | `TestingPage` | Test runs overview. |
| `/changelog/:slug` | `ChangelogDetailPage` | Platform changelog details. |
| `/repos` | `ReposPage` | Connected GitHub repositories settings. |
| `/stats` | `StatsPage` | System performance and token usage stats. |
| `/settings` | `SettingsPage` | Global application settings. |
| `/prompts` | `PromptsPage` | LLM prompt management. |
| `/best-practices` | `BestPracticesPage` | Guidelines for code quality. |
| `/docs-review` | `DocsReviewPage` | Documentation gap review settings. |
| `/setup` | `SetupGuidePage` | Platform setup and onboarding guide. |
| `/commands` | `CommandsPage` | Slash commands configuration. |
| `/jules` | `JulesIntegrationPage` | Jules agent integration settings. |
| `/jules/operations` | `JulesOperationsPage` | Jules operations overview. |
| `/jules/monitor` | `JulesMonitorPage` | Monitoring page for active Jules sessions. |
| `/jules/monitor/:taskId` | `JulesSessionDetailPage` | Details of a specific Jules session. |
| `/jules/workflow` | `JulesWorkflowPage` | Configuration for Jules workflow rules. |
| `/planning` | `PlanningListPage` | List of planning packages. |
| `/planning/new` | `PlanningNewPage` | Create a new planning package. |
| `/planning/:id` | `PlanningDetailPage` | Details for a planning package. |

## Fallback
| Path | Component | Description |
|------|-----------|-------------|
| `*` (Catch-all) | `NotFoundPage` | 404 Not Found error page. Full page suspense. |