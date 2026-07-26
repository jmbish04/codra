import { PageHeader } from '@client/components/layout/page-header';
import { DocsReviewManager } from '@client/components/features/docs-review/manager';

export function DocsReviewPage() {
  return (
    <section className="page-enter flex flex-col gap-5 pb-20">
      <PageHeader
        category="Repository Governance"
        title="Cloudflare Docs Review"
        description="Define what triggers a mandatory Cloudflare-docs review during PRs and what it checks for. Gotchas become pending best practices."
      />
      <DocsReviewManager />
    </section>
  );
}
