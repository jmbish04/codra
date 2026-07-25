import type { StandardizationStrategy } from '@server/db/standardization';

export type StandardizationChange = {
  path: string;
  content: string;
  message: string;
  /** SHA of the existing file (for updates); undefined for new files. */
  existingSha?: string;
};

type ExistingFile = { content: string; sha?: string } | null;

/**
 * Convert a GitHub blob URL to its raw.githubusercontent.com form so the
 * content can be fetched directly. Passes through raw URLs and anything else
 * unchanged.
 *
 * https://github.com/o/r/blob/<ref>/path -> https://raw.githubusercontent.com/o/r/<ref>/path
 */
export function normalizeSourceUrl(url: string): string {
  const m = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
  if (m) {
    return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`;
  }
  return url;
}

export async function fetchSourceContent(url: string): Promise<string> {
  const res = await fetch(normalizeSourceUrl(url), {
    headers: { 'User-Agent': 'codra-standardization' },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch standardization source ${url}: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

function stripJsonc(content: string): string {
  return content
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/,(\s*[\]}])/g, '$1')
    .trim();
}

/** Deep-merge the source's top-level keys into the existing JSON object. */
function mergeJson(existing: string, source: string): { content: string; changed: boolean } {
  try {
    const existingObj = JSON.parse(stripJsonc(existing));
    const sourceObj = JSON.parse(stripJsonc(source));
    let changed = false;
    const merged = { ...existingObj };
    for (const [key, value] of Object.entries(sourceObj)) {
      if (JSON.stringify(existingObj[key]) !== JSON.stringify(value)) {
        merged[key] = value;
        changed = true;
      }
    }
    return { content: JSON.stringify(merged, null, 2), changed };
  } catch {
    // Existing file is unparseable JSON — replace with the standard.
    return { content: source, changed: true };
  }
}

/**
 * Ensure every MCP server in the source is present in the target. Supports both
 * the object-map shape ({ "mcpServers": { name: {...} } }) and the array shape
 * ({ "servers": [{ name/url }] }). Appends missing servers only.
 */
function mergeMcpServers(existing: string, source: string): { content: string; changed: boolean } {
  try {
    const target = JSON.parse(stripJsonc(existing));
    const src = JSON.parse(stripJsonc(source));
    let changed = false;

    for (const key of ['mcpServers', 'servers'] as const) {
      const srcVal = src[key];
      if (!srcVal) continue;

      if (Array.isArray(srcVal)) {
        const targetArr: any[] = Array.isArray(target[key]) ? target[key] : [];
        const idOf = (s: any) => s?.name ?? s?.url ?? JSON.stringify(s);
        const seen = new Set(targetArr.map(idOf));
        for (const server of srcVal) {
          if (!seen.has(idOf(server))) {
            targetArr.push(server);
            changed = true;
          }
        }
        target[key] = targetArr;
      } else if (typeof srcVal === 'object') {
        const targetMap: Record<string, any> = (target[key] && typeof target[key] === 'object') ? target[key] : {};
        for (const [name, cfg] of Object.entries(srcVal)) {
          if (!(name in targetMap)) {
            targetMap[name] = cfg;
            changed = true;
          }
        }
        target[key] = targetMap;
      }
    }

    return { content: JSON.stringify(target, null, 2), changed };
  } catch {
    return { content: source, changed: true };
  }
}

/**
 * Apply a rule's strategy to a target file. Returns the change to make, or null
 * if the target already satisfies the rule.
 */
export function applyStrategy(
  strategy: StandardizationStrategy,
  targetPath: string,
  existing: ExistingFile,
  source: string,
): StandardizationChange | null {
  const isEmpty = !existing || existing.content.trim() === '';

  switch (strategy) {
    case 'create_if_missing':
      // Only act when the file is absent or empty; never touch a populated file.
      if (isEmpty) {
        return { path: targetPath, content: source, message: `chore: add standardized ${targetPath}` };
      }
      return null;

    case 'overwrite':
      if (isEmpty) {
        return { path: targetPath, content: source, message: `chore: add standardized ${targetPath}` };
      }
      if (existing!.content.trim() !== source.trim()) {
        return { path: targetPath, content: source, message: `chore: standardize ${targetPath}`, existingSha: existing!.sha };
      }
      return null;

    case 'merge_json': {
      if (isEmpty) {
        return { path: targetPath, content: source, message: `chore: add standardized ${targetPath}` };
      }
      const { content, changed } = mergeJson(existing!.content, source);
      return changed
        ? { path: targetPath, content, message: `chore: update ${targetPath} with standardized keys`, existingSha: existing!.sha }
        : null;
    }

    case 'merge_mcp_servers': {
      if (isEmpty) {
        return { path: targetPath, content: source, message: `chore: add standardized ${targetPath}` };
      }
      const { content, changed } = mergeMcpServers(existing!.content, source);
      return changed
        ? { path: targetPath, content, message: `chore: add missing MCP servers to ${targetPath}`, existingSha: existing!.sha }
        : null;
    }

    default:
      return null;
  }
}
