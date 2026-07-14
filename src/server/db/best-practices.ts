import { getDb } from './client';
import { bestPractices, infrastructures } from './schemas';
import { eq } from 'drizzle-orm';

export interface BestPracticeInput {
  name: string;
  infraId: string;
  infraName?: string; // If provided, creates a new infrastructure option
  criteria: string;
  instructions: string; // PlateJS JSON string
  isActive?: boolean;
}

export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export async function listInfrastructures(env: { DB: D1Database }) {
  const db = getDb(env);
  return db.select().from(infrastructures);
}

export async function listBestPractices(env: { DB: D1Database }) {
  const db = getDb(env);
  return db
    .select({
      id: bestPractices.id,
      name: bestPractices.name,
      infraId: bestPractices.infra_id,
      infraName: infrastructures.name,
      criteria: bestPractices.criteria,
      instructions: bestPractices.instructions,
      isActive: bestPractices.is_active,
      createdAt: bestPractices.created_at,
      updatedAt: bestPractices.updated_at,
    })
    .from(bestPractices)
    .leftJoin(infrastructures, eq(bestPractices.infra_id, infrastructures.id));
}

export async function getBestPractice(env: { DB: D1Database }, id: string) {
  const db = getDb(env);
  const [row] = await db
    .select({
      id: bestPractices.id,
      name: bestPractices.name,
      infraId: bestPractices.infra_id,
      infraName: infrastructures.name,
      criteria: bestPractices.criteria,
      instructions: bestPractices.instructions,
      isActive: bestPractices.is_active,
      createdAt: bestPractices.created_at,
      updatedAt: bestPractices.updated_at,
    })
    .from(bestPractices)
    .leftJoin(infrastructures, eq(bestPractices.infra_id, infrastructures.id))
    .where(eq(bestPractices.id, id));
  return row || null;
}

export async function resolveInfraId(env: { DB: D1Database }, infraId: string, infraName?: string): Promise<string> {
  const db = getDb(env);
  if (infraId === 'other' && infraName) {
    const slug = slugify(infraName);
    if (slug) {
      // Check if it exists or insert
      const [existing] = await db.select().from(infrastructures).where(eq(infrastructures.id, slug));
      if (existing) {
        return existing.id;
      }
      await db.insert(infrastructures).values({
        id: slug,
        name: infraName,
      }).onConflictDoNothing();
      return slug;
    }
  }
  return infraId;
}

export async function createBestPractice(env: { DB: D1Database }, input: BestPracticeInput) {
  const db = getDb(env);
  const id = crypto.randomUUID();
  const finalInfraId = await resolveInfraId(env, input.infraId, input.infraName);

  await db.insert(bestPractices).values({
    id,
    name: input.name,
    infra_id: finalInfraId,
    criteria: input.criteria,
    instructions: input.instructions,
    is_active: input.isActive ?? true,
  });

  return getBestPractice(env, id);
}

export async function updateBestPractice(env: { DB: D1Database }, id: string, input: Partial<BestPracticeInput>) {
  const db = getDb(env);
  const updateData: any = {};
  if (input.name !== undefined) updateData.name = input.name;
  if (input.criteria !== undefined) updateData.criteria = input.criteria;
  if (input.instructions !== undefined) updateData.instructions = input.instructions;
  if (input.isActive !== undefined) updateData.is_active = input.isActive;
  
  if (input.infraId !== undefined) {
    updateData.infra_id = await resolveInfraId(env, input.infraId, input.infraName);
  }

  updateData.updated_at = new Date().toISOString();

  await db.update(bestPractices).set(updateData).where(eq(bestPractices.id, id));
  return getBestPractice(env, id);
}

export async function deleteBestPractice(env: { DB: D1Database }, id: string) {
  const db = getDb(env);
  await db.delete(bestPractices).where(eq(bestPractices.id, id));
  return true;
}

export function matchesCriteria(criteria: string, filePath: string, content: string): boolean {
  const normalizedCriteria = criteria.toLowerCase();
  const normalizedPath = filePath.toLowerCase();
  const normalizedContent = content.toLowerCase();

  const terms = normalizedCriteria.split(/[\n,]+/).map(t => t.trim()).filter(Boolean);
  if (terms.length === 0) return true;

  return terms.some(term => {
    if (term.includes('shadcn')) {
      return normalizedPath.includes('components') || normalizedContent.includes('shadcn') || normalizedContent.includes('@/components/ui');
    }
    if (term.includes('ai gateway') || term.includes('ai-gateway')) {
      return normalizedContent.includes('ai_gateway') || normalizedContent.includes('aigateway') || normalizedContent.includes('gateway');
    }
    if (term.includes('secret store') || term.includes('secret')) {
      return normalizedContent.includes('secret') || normalizedContent.includes('getsecret') || normalizedContent.includes('secretstore');
    }
    if (term.includes('d1')) {
      return normalizedContent.includes('d1') || normalizedContent.includes('db');
    }
    return normalizedPath.includes(term) || normalizedContent.includes(term);
  });
}

export async function getMatchingBestPractices(env: { DB: D1Database }, filePath: string, fileContent: string) {
  const practices = await listBestPractices(env);
  const activePractices = practices.filter(p => p.isActive);

  let fileInfra = 'cloudflare-workers';
  if (filePath.endsWith('.py')) {
    fileInfra = 'python';
  } else if (filePath.includes('appsscript') || filePath.endsWith('.gs')) {
    fileInfra = 'appsscript';
  }

  return activePractices.filter(p => {
    if (p.infraId !== 'other' && p.infraId !== fileInfra) {
      return false;
    }
    return matchesCriteria(p.criteria, filePath, fileContent);
  });
}

export function convertPlateToMarkdown(jsonStr: string): string {
  try {
    const nodes = JSON.parse(jsonStr);
    if (!Array.isArray(nodes)) {
      return jsonStr;
    }

    const parseNode = (node: any): string => {
      if (node.text !== undefined) {
        let text = node.text;
        if (node.bold) text = `**${text}**`;
        if (node.italic) text = `*${text}*`;
        if (node.code) text = `\`${text}\``;
        return text;
      }

      const childrenText = (node.children || []).map(parseNode).join('');

      switch (node.type) {
        case 'h1':
          return `# ${childrenText}\n`;
        case 'h2':
          return `## ${childrenText}\n`;
        case 'h3':
          return `### ${childrenText}\n`;
        case 'p':
          return `${childrenText}\n`;
        case 'li':
          return `- ${childrenText}\n`;
        case 'ul':
          return `${childrenText}`;
        case 'ol':
          return `${childrenText}`;
        case 'code_block':
          return `\`\`\`\n${childrenText}\n\`\`\`\n`;
        default:
          return childrenText;
      }
    };

    return nodes.map(parseNode).join('\n').trim();
  } catch {
    return jsonStr;
  }
}
