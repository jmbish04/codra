/**
 * @vitest-environment jsdom
 */
import { expect, it, describe, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LoginPage } from '@client/pages/Login';
import { DashboardPage } from '@client/pages/Dashboard';
import { MemoryRouter } from 'react-router-dom';
import { api } from '@client/lib/api';
import React from 'react';

// Mock the API client
vi.mock('@client/lib/api', () => ({
  api: {
    login: vi.fn(),
    getStats: vi.fn(),
    getJobs: vi.fn(),
  }
}));

describe('Frontend UI Flows (JSDOM)', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('completes the login flow', async () => {
    vi.mocked(api.login).mockResolvedValue({ ok: true });
    
    // We mock location change
    const originalLocation = window.location;
    delete (window as any).location;
    window.location = { ...originalLocation, href: '' } as any;

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    );

    const passwordInput = screen.getByPlaceholderText('Dashboard password');
    const submitBtn = screen.getByText('Sign in');

    fireEvent.change(passwordInput, { target: { value: 'correct-password' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
        expect(api.login).toHaveBeenCalledWith({ password: 'correct-password' });
    });
    
    expect(window.location.href).toBe('/dashboard');
  });

  it('displays the dashboard with stats and activity', async () => {
    vi.mocked(api.getStats).mockResolvedValue({
      stats: {
        totals: { jobs: 10, inputTokens: 500, outputTokens: 250, comments: 5 },
        trend: [],
        verdicts: [],
        models: [],
        topRepos: []
      }
    });

    vi.mocked(api.getJobs).mockResolvedValue({
      jobs: [
        {
          id: '1',
          owner: 'test-owner',
          repo: 'test-repo',
          prNumber: 101,
          prTitle: 'Fixing bug',
          status: 'done',
          trigger: 'auto',
          createdAt: new Date().toISOString(),
          commentCount: 2,
        }
      ] as any,
      total: 1
    });

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );

    // Check for dashboard title (from PageHeader)
    expect(await screen.findByText('Dashboard')).toBeDefined();
    
    // Check for stats totals (using data from getStats mock)
    // Note: fmtNumber might format 500 as "500" or similar
    expect(screen.getByText('10')).toBeDefined();
    expect(screen.getByText('500')).toBeDefined();

    // Check for activity stream item
    expect(screen.getByText('test-owner/test-repo')).toBeDefined();
    expect(screen.getByText('Fixing bug')).toBeDefined();
  });
});
