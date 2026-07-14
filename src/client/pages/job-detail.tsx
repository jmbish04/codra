import { useParams } from 'react-router-dom';
import { useJobDetail } from '@client/hooks/use-job-detail';
import { JobHeader } from '@client/components/features/job-detail/job-header';
import { JobProgress } from '@client/components/features/job-detail/job-progress';
import { JobMetaCards } from '@client/components/features/job-detail/job-meta-cards';
import { JobReviewOverview } from '@client/components/features/job-detail/job-review-overview';
import { JobFindingsList } from '@client/components/features/job-detail/job-findings-list';
import { JobDetailSkeleton } from '@client/components/features/job-detail/job-skeleton';
import { Alert } from '@client/components/ui/alert';

export function JobDetailPage() {
  const { id = '' } = useParams();
  const { job, error, isRetrying, isForceRestarting, handleRetry, handleForceRestart } = useJobDetail(id);

  if (!job) {
    return <JobDetailSkeleton error={error} />;
  }

  return (
    <section className="flex flex-col gap-6">
      <JobHeader 
        job={job} 
        isRetrying={isRetrying} 
        onRetry={handleRetry} 
        isForceRestarting={isForceRestarting}
        onForceRestart={handleForceRestart}
      />

      {error && (
        <Alert variant="destructive">{error}</Alert>
      )}

      <JobProgress job={job} />

      <JobMetaCards job={job} />

      <JobReviewOverview job={job} />

      <JobFindingsList job={job} />
    </section>
  );
}
