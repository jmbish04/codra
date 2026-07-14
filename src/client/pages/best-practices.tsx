import { PageHeader } from '@client/components/layout/page-header';
import { BestPracticesManager } from '@client/components/features/best-practices/manager';

export function BestPracticesPage() {
  return (
    <section className="page-enter flex flex-col gap-5 pb-20">
      <PageHeader
        category="Repository Governance"
        title="Best Practices"
        description="Configure infrastructure rules and custom code guidelines to enforce during PR reviews."
      />
      <BestPracticesManager />
    </section>
  );
}
