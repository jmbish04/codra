import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { AppShell } from './components/app-shell';
import { LandingPage } from './pages/Landing';
import { DashboardPage } from './pages/Dashboard';
import { LoginPage } from './pages/Login';
import { JobsPage } from './pages/Jobs';
import { JobDetailPage } from './pages/job-detail';
import { ReposPage } from './pages/repos';
import { StatsPage } from './pages/Stats';
import { HealthPage } from './pages/health';
import { SettingsPage } from './pages/Settings';
import { NotFoundPage } from './pages/NotFound';
import './app.css';

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
      { path: 'jobs',      element: <JobsPage /> },
      { path: 'jobs/:id',  element: <JobDetailPage /> },
      { path: 'repos',     element: <ReposPage /> },
      { path: 'stats',     element: <StatsPage /> },
      { path: 'health',    element: <HealthPage /> },
      { path: 'settings',  element: <SettingsPage /> },
    ],
  },
  {
    path: '*',
    element: <NotFoundPage />,
  },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
