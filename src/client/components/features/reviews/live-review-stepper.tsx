import type { JobSummary } from '@shared/schema';

interface LiveReviewStepperProps {
  job: JobSummary;
  compact?: boolean;
}

export function LiveReviewStepper({ job, compact = true }: LiveReviewStepperProps) {
  const { status, steps = [] } = job;

  // Define our 4 target steps
  const stepperLabels = ['Queued', 'Scanning', 'Analyzing', 'Done'];
  
  // Determine state for each of our 4 steps: 'pending' | 'running' | 'done' | 'failed'
  let stepStates: Array<'pending' | 'running' | 'done' | 'failed'> = ['pending', 'pending', 'pending', 'pending'];
  let activeLabel = '';

  if (status === 'queued') {
    stepStates = ['running', 'pending', 'pending', 'pending'];
    activeLabel = 'Queued';
  } else if (status === 'done') {
    stepStates = ['done', 'done', 'done', 'done'];
    activeLabel = 'Done';
  } else if (status === 'failed') {
    // Basic mapping for failure
    const failedStep = steps.find(s => s.status === 'failed');
    if (failedStep) {
      if (['Initializing', 'Fetching Diff'].includes(failedStep.name)) {
        stepStates = ['done', 'failed', 'pending', 'pending'];
        activeLabel = 'Scanning Failed';
      } else if (['Reviewing Files', 'Generating Summary'].includes(failedStep.name)) {
        stepStates = ['done', 'done', 'failed', 'pending'];
        activeLabel = 'Analysis Failed';
      } else {
        stepStates = ['done', 'done', 'done', 'failed'];
        activeLabel = 'Finalizing Failed';
      }
    } else {
      stepStates = ['done', 'done', 'done', 'failed'];
      activeLabel = 'Failed';
    }
  } else if (status === 'running') {
    const runningStep = steps.find(s => s.status === 'running');
    
    if (!runningStep || ['Initializing', 'Fetching Diff'].includes(runningStep.name)) {
      stepStates = ['done', 'running', 'pending', 'pending'];
      activeLabel = 'Scanning';
    } else if (['Reviewing Files', 'Generating Summary'].includes(runningStep.name)) {
      stepStates = ['done', 'done', 'running', 'pending'];
      activeLabel = 'Analyzing';
    } else if (runningStep.name === 'Completing') {
      stepStates = ['done', 'done', 'done', 'running'];
      activeLabel = 'Finalizing';
    } else {
      stepStates = ['done', 'done', 'running', 'pending'];
      activeLabel = 'Analyzing';
    }
  } else if (status === 'superseded') {
    stepStates = ['done', 'done', 'done', 'done']; // Treat as finished but maybe different color?
    activeLabel = 'Superseded';
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1">
        {stepStates.map((state, i) => (
          <div 
            key={i} 
            className={`step-dot ${state}`} 
            title={stepperLabels[i]}
          />
        ))}
      </div>
      {!compact && (
        <span className={`text-[10px] font-bold uppercase tracking-wider ${status === 'failed' ? 'text-danger' : 'text-info'}`}>
          {activeLabel}
        </span>
      )}
      {compact && status === 'running' && (
        <span className="text-[10px] font-bold uppercase tracking-wider text-info ml-0.5 animate-pulse">
          {activeLabel}…
        </span>
      )}
      {compact && status === 'queued' && (
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground ml-0.5">
          Queued
        </span>
      )}
    </div>
  );
}
