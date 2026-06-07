import React, { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AppShell } from './components/layout/app-shell';

const LandingPage = React.lazy(() => import('./pages/landing').then(m => ({ default: m.LandingPage })));
const DashboardPage = React.lazy(() => import('./pages/dashboard').then(m => ({ default: m.DashboardPage })));
const LoginPage = React.lazy(() => import('./pages/login').then(m => ({ default: m.LoginPage })));
const JobsPage = React.lazy(() => import('./pages/jobs').then(m => ({ default: m.JobsPage })));
const JobDetailPage = React.lazy(() => import('./pages/job-detail').then(m => ({ default: m.JobDetailPage })));
const JobLogsPage = React.lazy(() => import('./pages/job-logs').then(m => ({ default: m.JobLogsPage })));
const ReposPage = React.lazy(() => import('./pages/repos').then(m => ({ default: m.ReposPage })));
const StatsPage = React.lazy(() => import('./pages/stats').then(m => ({ default: m.StatsPage })));
const SettingsPage = React.lazy(() => import('./pages/settings').then(m => ({ default: m.SettingsPage })));
const NotFoundPage = React.lazy(() => import('./pages/not-found').then(m => ({ default: m.NotFoundPage })));

import './app.css';

import { ThemeProvider } from './lib/theme';
import { useIsDarkMode } from './hooks/use-is-dark-mode';

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

const withSuspense = (Component: React.ComponentType, isFullPage = false) => (
  <Suspense fallback={<div className={`flex items-center justify-center ${isFullPage ? 'h-screen' : 'h-full w-full'}`} />}>
    <Component />
  </Suspense>
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
    element: <AppShell />,
    children: [
      { path: 'dashboard', element: withSuspense(DashboardPage) },
      { path: 'jobs', element: withSuspense(JobsPage) },
      { path: 'jobs/:id', element: withSuspense(JobDetailPage) },
      { path: 'jobs/:id/logs', element: withSuspense(JobLogsPage) },
      { path: 'repos', element: withSuspense(ReposPage) },
      { path: 'stats', element: withSuspense(StatsPage) },
      { path: 'settings', element: withSuspense(SettingsPage) },
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
