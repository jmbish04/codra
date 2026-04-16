import { useParams } from 'react-router-dom';
import { useJobDetail } from '@client/hooks/use-job-detail';
import { JobHeader } from '@client/components/job-detail/job-header';
import { JobProgress } from '@client/components/job-detail/job-progress';
import { JobMetaCards } from '@client/components/job-detail/job-meta-cards';
import { JobReviewOverview } from '@client/components/job-detail/job-review-overview';
import { JobFindingsList } from '@client/components/job-detail/job-findings-list';
import { JobDetailSkeleton } from '@client/components/job-detail/job-skeleton';

export function JobDetailPage() {
  const { id = '' } = useParams();
  const { job, error, isRetrying, handleRetry } = useJobDetail(id);

  if (!job) {
    return <JobDetailSkeleton error={error} />;
  }

  return (
    <section className="flex flex-col gap-6">
      <JobHeader 
        job={job} 
        isRetrying={isRetrying} 
        onRetry={handleRetry} 
      />

      {error && (
        <div
          className="rounded-lg border px-4 py-3 text-sm"
          style={{ background: 'var(--danger-bg)', borderColor: 'var(--danger-border)', color: 'var(--danger)' }}
        >
          {error}
        </div>
      )}

      <JobProgress job={job} />

      <JobMetaCards job={job} />

      <JobReviewOverview job={job} />

      <JobFindingsList job={job} />
    </section>
  );
}
