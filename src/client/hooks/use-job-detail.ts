import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@client/lib/api';
import type { JobDetail } from '@shared/schema';

export function useJobDetail(id: string) {
  const navigate = useNavigate();
  const [job, setJob] = useState<JobDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isForceRestarting, setIsForceRestarting] = useState(false);
  const pollTimeout = useRef<number | null>(null);
  const etag = useRef<string | null>(null);
  const latestJob = useRef<JobDetail | null>(null);

  const isTerminal = (candidate: JobDetail | null) => candidate?.status === 'done' || candidate?.status === 'failed' || candidate?.status === 'superseded';

  const getPollDelay = (candidate: JobDetail | null) => {
    if (!candidate || isTerminal(candidate)) return null;

    const nextRetryAt = candidate.nextRetryAt ? new Date(candidate.nextRetryAt).getTime() : null;
    const waitingForRetry = nextRetryAt !== null && Number.isFinite(nextRetryAt) && nextRetryAt > Date.now();
    const baseDelay = waitingForRetry ? Math.min(Math.max(nextRetryAt - Date.now(), 10_000), 15_000) : 3_000;

    return document.visibilityState === 'hidden' ? Math.max(baseDelay, 45_000) : baseDelay;
  };

  const fetchJob = async (silent = false) => {
    try {
      const response = await api.getJob(id, { etag: etag.current });
      if (response.etag) etag.current = response.etag;
      if (!response.notModified && response.data) {
        latestJob.current = response.data.job;
        setJob(response.data.job);
      }
      setError(null);
      schedulePolling();
    } catch (loadError) {
      if (!silent) setError(loadError instanceof Error ? loadError.message : 'Failed to load job.');
      schedulePolling();
    }
  };

  const stopPolling = () => {
    if (pollTimeout.current) {
      window.clearTimeout(pollTimeout.current);
      pollTimeout.current = null;
    }
  };

  const schedulePolling = () => {
    stopPolling();
    const delay = getPollDelay(latestJob.current);
    if (delay === null) return;
    pollTimeout.current = window.setTimeout(() => fetchJob(true), delay);
  };

  useEffect(() => {
    if (id) {
      etag.current = null;
      latestJob.current = null;
      fetchJob();
    }
    return () => stopPolling();
  }, [id]);

  useEffect(() => {
    latestJob.current = job;
    schedulePolling();
  }, [job?.status, job?.nextRetryAt]);

  useEffect(() => {
    const reschedule = () => schedulePolling();
    document.addEventListener('visibilitychange', reschedule);
    return () => document.removeEventListener('visibilitychange', reschedule);
  }, [id, job?.status, job?.nextRetryAt]);

  const handleRetry = async () => {
    if (!job) return;
    setIsRetrying(true);
    try {
      const response = await api.retryJob(job.id);
      navigate(`/jobs/${response.job.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to retry job.');
    } finally {
      setIsRetrying(false);
    }
  };

  const handleForceRestart = async () => {
    if (!job) return;
    setIsForceRestarting(true);
    try {
      const response = await api.forceRestartJob(job.id);
      setJob(response.job);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to force restart job.');
    } finally {
      setIsForceRestarting(false);
    }
  };

  return {
    job,
    error,
    isRetrying,
    isForceRestarting,
    handleRetry,
    handleForceRestart,
    fetchJob
  };
}
