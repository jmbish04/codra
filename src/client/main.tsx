import React, { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AppShell } from './components/layout/app-shell';

/**
 * safeLazy
 */
function safeLazy<T extends React.ComponentType<any>>(
  importFn: () => Promise<{ default: T }>
): React.LazyExoticComponent<T> {
  return React.lazy(() =>
    importFn().catch((err) => {
      console.error('Failed to fetch dynamically imported module:', err);
      const isChunkError =
        err instanceof TypeError ||
        /failed to fetch|dynamically imported|loading chunk/i.test(err.message || '');
      if (isChunkError) {
        window.location.reload();
      }
      throw err;
    })
  );
}

const LandingPage = safeLazy(() => import('./pages/landing').then(m => ({ default: m.LandingPage })));
const DashboardPage = safeLazy(() => import('./pages/dashboard').then(m => ({ default: m.DashboardPage })));
const LoginPage = safeLazy(() => import('./pages/login').then(m => ({ default: m.LoginPage })));
const JobsPage = safeLazy(() => import('./pages/jobs').then(m => ({ default: m.JobsPage })));
const QueuePage = safeLazy(() => import('./pages/queue').then(m => ({ default: m.QueuePage })));
const WebhooksPage = safeLazy(() => import('./pages/webhooks').then(m => ({ default: m.WebhooksPage })));
const StandardizationPage = safeLazy(() => import('./pages/standardization').then(m => ({ default: m.StandardizationPage })));
const ActionsPage = safeLazy(() => import('./pages/actions').then(m => ({ default: m.ActionsPage })));
const SecretsPage = safeLazy(() => import('./pages/secrets').then(m => ({ default: m.SecretsPage })));
const TestingPage = safeLazy(() => import('./pages/testing').then(m => ({ default: m.TestingPage })));
const TestReportPage = safeLazy(() => import('./pages/test-report').then(m => ({ default: m.TestReportPage })));
const JobDetailPage = safeLazy(() => import('./pages/job-detail').then(m => ({ default: m.JobDetailPage })));
const JobLogsPage = safeLazy(() => import('./pages/job-logs').then(m => ({ default: m.JobLogsPage })));
const ChangelogDetailPage = safeLazy(() => import('./pages/changelog-detail').then(m => ({ default: m.ChangelogDetailPage })));
const ReposPage = safeLazy(() => import('./pages/repos').then(m => ({ default: m.ReposPage })));
const StatsPage = safeLazy(() => import('./pages/stats').then(m => ({ default: m.StatsPage })));
const SettingsPage = safeLazy(() => import('./pages/settings').then(m => ({ default: m.SettingsPage })));
const PromptsPage = safeLazy(() => import('./pages/prompts').then(m => ({ default: m.PromptsPage })));
const BestPracticesPage = safeLazy(() => import('./pages/best-practices').then(m => ({ default: m.BestPracticesPage })));
const DocsReviewPage = safeLazy(() => import('./pages/docs-review').then(m => ({ default: m.DocsReviewPage })));
const SetupGuidePage = safeLazy(() => import('./pages/setup-guide').then(m => ({ default: m.SetupGuidePage })));
const CommandsPage = safeLazy(() => import('./pages/commands').then(m => ({ default: m.CommandsPage })));
const JulesIntegrationPage = safeLazy(() => import('./pages/jules-integration').then(m => ({ default: m.JulesIntegrationPage })));
const JulesOperationsPage = safeLazy(() => import('./pages/jules-operations').then(m => ({ default: m.JulesOperationsPage })));
const JulesMonitorPage = safeLazy(() => import('./pages/jules-monitor').then(m => ({ default: m.JulesMonitorPage })));
const JulesWorkflowPage = safeLazy(() => import('./pages/jules-workflow').then(m => ({ default: m.JulesWorkflowPage })));
const PlanningListPage = safeLazy(() => import('./pages/planning-list').then(m => ({ default: m.PlanningListPage })));
const PlanningNewPage = safeLazy(() => import('./pages/planning-new').then(m => ({ default: m.PlanningNewPage })));
const PlanningDetailPage = safeLazy(() => import('./pages/planning-detail').then(m => ({ default: m.PlanningDetailPage })));
const JulesSessionDetailPage = safeLazy(() => import('./pages/jules-session-detail').then(m => ({ default: m.JulesSessionDetailPage })));
const NotFoundPage = safeLazy(() => import('./pages/not-found').then(m => ({ default: m.NotFoundPage })));

import './app.css';

import { ThemeProvider } from './lib/theme';
import { useIsDarkMode } from './hooks/use-is-dark-mode';

/**
 * ToasterWrapper
 */
function ToasterWrapper() {
  const isDark = useIsDarkMode();
  return (
    <Toaster
      theme={isDark ? 'dark' : 'light'}
      position="bottom-right"
      richColors
      closeButton
      gap={8}
      toastOptions={{
        duration: 4000,
        classNames: {
          toast: 'codra-toast',
          title: 'codra-toast-title',
          description: 'codra-toast-description',
          actionButton: 'codra-toast-action',
          cancelButton: 'codra-toast-cancel',
          closeButton: 'codra-toast-close',
          icon: 'codra-toast-icon',
          loader: 'codra-toast-loader',
          success: 'codra-toast-success',
          error: 'codra-toast-error',
          warning: 'codra-toast-warning',
          info: 'codra-toast-info',
          loading: 'codra-toast-loading',
        },
      }}
    />
  );
}

class ErrorBoundary extends React.Component<{ fallback?: React.ReactNode, children: React.ReactNode }, { error: Error | null }> {
  constructor(props: { fallback?: React.ReactNode, children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }
  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex flex-col items-center justify-center p-8 text-destructive">
          <p className="font-bold">An error occurred rendering this component:</p>
          <pre className="mt-2 rounded bg-muted p-4 text-xs font-mono">{this.state.error.toString()}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * withSuspense
 */
const withSuspense = (Component: React.ComponentType, isFullPage = false) => (
  <ErrorBoundary>
    <Suspense fallback={<div role="status" aria-busy="true" className={`flex items-center justify-center ${isFullPage ? 'h-screen' : 'h-full w-full'}`} />}>
      <Component />
    </Suspense>
  </ErrorBoundary>
);

const router = createBrowserRouter([
  {
    path: '/',
    element: withSuspense(LandingPage, true),
  },
  {
    path: '/login',
    element: withSuspense(LoginPage, true),
  },
  {
    // Public test report — reachable via the link codra drops on the PR.
    path: '/test-report/:jobId',
    element: withSuspense(TestReportPage, true),
  },
  {
    element: <AppShell />,
    children: [
      { path: 'dashboard', element: withSuspense(DashboardPage) },
      { path: 'jobs', element: withSuspense(JobsPage) },
      { path: 'queue', element: withSuspense(QueuePage) },
      { path: 'webhooks', element: withSuspense(WebhooksPage) },
      { path: 'standardization', element: withSuspense(StandardizationPage) },
      { path: 'actions', element: withSuspense(ActionsPage) },
      { path: 'secrets', element: withSuspense(SecretsPage) },
      { path: 'testing', element: withSuspense(TestingPage) },
      { path: 'jobs/:id', element: withSuspense(JobDetailPage) },
      { path: 'jobs/:id/logs', element: withSuspense(JobLogsPage) },
      { path: 'changelog/:slug', element: withSuspense(ChangelogDetailPage) },
      { path: 'repos', element: withSuspense(ReposPage) },
      { path: 'stats', element: withSuspense(StatsPage) },
      { path: 'settings', element: withSuspense(SettingsPage) },
      { path: 'prompts', element: withSuspense(PromptsPage) },
      { path: 'best-practices', element: withSuspense(BestPracticesPage) },
      { path: 'docs-review', element: withSuspense(DocsReviewPage) },
      { path: 'setup', element: withSuspense(SetupGuidePage) },
      { path: 'commands', element: withSuspense(CommandsPage) },
      { path: 'jules', element: withSuspense(JulesIntegrationPage) },
      { path: 'jules/operations', element: withSuspense(JulesOperationsPage) },
      { path: 'jules/monitor', element: withSuspense(JulesMonitorPage) },
      { path: 'jules/workflow', element: withSuspense(JulesWorkflowPage) },
      { path: 'planning', element: withSuspense(PlanningListPage) },
      { path: 'planning/new', element: withSuspense(PlanningNewPage) },
      { path: 'planning/:id', element: withSuspense(PlanningDetailPage) },
      { path: 'jules/monitor/:taskId', element: withSuspense(JulesSessionDetailPage) },
    ],
  },
  {
    path: '*',
    element: withSuspense(NotFoundPage, true),
  },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <RouterProvider router={router} />
      <ToasterWrapper />
    </ThemeProvider>
  </React.StrictMode>,
);
