import { useParams, Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { useJobDetail } from '@client/hooks/use-job-detail';
import { JobDetailSkeleton } from '@client/components/features/job-detail/job-skeleton';
import { Alert } from '@client/components/ui/alert';
import { PageHeader } from '@client/components/layout/page-header';

export function JobLogsPage() {
  const { id = '' } = useParams();
  const { job, error } = useJobDetail(id);

  if (!job) return <JobDetailSkeleton error={error} />;

  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <Link to={`/jobs/${job.id}`} className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm font-semibold transition-colors">
          <ChevronLeft size={16} /> Back to Job Details
        </Link>
      </div>

      <PageHeader 
        category="Logs" 
        title="Review logs"
        description={`${job.owner}/${job.repo} · PR #${job.prNumber} · ${job.commitSha.slice(0, 7)}`}
      />

      {error && <Alert variant="destructive">{error}</Alert>}

      <div className="flex flex-col gap-6">
        {job.files.length === 0 ? (
           <div className="surface p-8 text-center text-muted-foreground">No files processed.</div>
        ) : (
          job.files.map((file) => (
            <div key={file.id} className="surface p-5 overflow-hidden">
              <h3 className="font-mono text-sm font-semibold text-foreground mb-4 truncate">{file.filePath}</h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="min-w-0">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    Prompt / diff
                  </p>
                  <pre className="code-block max-h-[600px] text-[10px] sm:text-xs overflow-auto">{file.diffInput ?? 'No prompt saved.'}</pre>
                </div>
                <div className="min-w-0">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    Raw model output
                  </p>
                  <pre className="code-block max-h-[600px] text-[10px] sm:text-xs overflow-auto">{file.rawAiOutput ?? 'No raw output saved.'}</pre>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
