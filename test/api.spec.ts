import { createApp } from '@server/app';
import { createTestEnv } from './helpers';
import { insertJob } from '@server/db/jobs';
import { defaultRepoConfig } from '@shared/schema';
import type { JobDetailResponse, JobsResponse, RepoConfigsResponse, StatsResponse } from '@shared/api';

describe('Dashboard API Suite', () => {
    const env = createTestEnv();
    const app = createApp();

    async function getAuthCookie() {
        const response = await app.request('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ password: 'letmein' }),
            headers: { 'Content-Type': 'application/json' }
        }, env);
        
        const cookieHeader = response.headers.get('set-cookie') || '';
        const match = cookieHeader.match(/codra_session=([^;]+)/);
        return match ? match[1] : '';
    }

    it('denies access to /api/jobs without a session', async () => {
        const response = await app.request('/api/jobs', {}, env);
        expect(response.status).toBe(401);
    });

    it('allows access to /api/jobs with a valid session', async () => {
        const token = await getAuthCookie();
        const response = await app.request('/api/jobs', {
            headers: { 'Cookie': `codra_session=${token}` }
        }, env);
        expect(response.status).toBe(200);
        const data = await response.json() as JobsResponse;
        expect(data).toHaveProperty('jobs');
        expect(Array.isArray(data.jobs)).toBe(true);
    });

    it('returns 404 for non-existent job detail (invalid UUID)', async () => {
        const token = await getAuthCookie();
        const response = await app.request('/api/jobs/non-existent-id', {
            headers: { 'Cookie': `codra_session=${token}` }
        }, env);
        expect(response.status).toBe(404);
    });

    it('fetches job details accurately', async () => {
        const token = await getAuthCookie();
        
        const job = await insertJob(env, {
            installationId: '123',
            owner: 'api-test-owner',
            repo: 'api-test-repo',
            prNumber: 42,
            prTitle: 'API Test PR',
            prAuthor: 'tester',
            commitSha: 'sha123',
            baseSha: 'basesha',
            trigger: 'auto',
            headRef: 'main',
            baseRef: 'main',
            configSnapshot: defaultRepoConfig,
        });

        const response = await app.request(`/api/jobs/${job.id}`, {
            headers: { 'Cookie': `codra_session=${token}` }
        }, env);
        
        expect(response.status).toBe(200);
        const data = await response.json() as JobDetailResponse;
        // The API returns { job: { ... } }
        expect(data.job.id).toBe(job.id);
        expect(data.job.owner).toBe('api-test-owner');
        expect(data.job.prNumber).toBe(42);
        expect(data.job.files).toBeDefined();
    });

    it('returns stats successfully', async () => {
        const token = await getAuthCookie();
        const response = await app.request('/api/stats', {
            headers: { 'Cookie': `codra_session=${token}` }
        }, env);
        expect(response.status).toBe(200);
        const data = await response.json() as StatsResponse;
        // The API returns { stats: { ... } }
        expect(data.stats).toHaveProperty('totals');
        expect(data.stats).toHaveProperty('trend');
        expect(data.stats).toHaveProperty('topRepos');
    });

    it('returns repository list', async () => {
        const token = await getAuthCookie();
        const response = await app.request('/api/repos', {
            headers: { 'Cookie': `codra_session=${token}` }
        }, env);
        expect(response.status).toBe(200);
        const data = await response.json() as RepoConfigsResponse;
        // The API returns { repos: [ ... ] }
        expect(data).toHaveProperty('repos');
        expect(Array.isArray(data.repos)).toBe(true);
    });
});
