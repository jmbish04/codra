import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AppShell } from './components/layout/app-shell';
import { LandingPage } from './pages/landing';
import { DashboardPage } from './pages/dashboard';
import { LoginPage } from './pages/login';
import { JobsPage } from './pages/jobs';
import { JobDetailPage } from './pages/job-detail';
import { JobLogsPage } from './pages/job-logs';
import { ReposPage } from './pages/repos';
import { StatsPage } from './pages/stats';
import { SettingsPage } from './pages/settings';
import { NotFoundPage } from './pages/not-found';
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
    />
  );
}

const router = createBrowserRouter([
  {
    path: '/',
    element: <LandingPage />,
  },
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    element: <AppShell />,
    children: [
      { path: 'dashboard', element: <DashboardPage /> },
      { path: 'jobs', element: <JobsPage /> },
      { path: 'jobs/:id', element: <JobDetailPage /> },
      { path: 'jobs/:id/logs', element: <JobLogsPage /> },
      { path: 'repos', element: <ReposPage /> },
      { path: 'stats', element: <StatsPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
  {
    path: '*',
    element: <NotFoundPage />,
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
