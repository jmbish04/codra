/** Section/boundary tags the prompt assembler uses as structural delimiters.
 *  Attacker-controlled PR text is scrubbed of these so it cannot forge
 *  structure (mirrors Cloudflare's ai-code-review injection defense). */
export const BOUNDARY_TAGS = [
  'mr_input', 'mr_body', 'mr_comments', 'mr_details', 'changed_files',
  'existing_inline_findings', 'previous_review', 'custom_review_instructions',
  'project_context', 'shared_context',
] as const;

const TAG_RE = new RegExp(`</?\\s*(?:${BOUNDARY_TAGS.join('|')})(?:[^>])*>`, 'gi');

/** Lines that mimic Codra's `=== … ===` section headers or coordinator labels.
 *  Neutralized so attacker-controlled repo/PR text cannot forge structure. */
const SECTION_HEADER_RE = /^=== .+ ===$/gm;
const COORDINATOR_LABEL_RE = /^(FINDINGS:|SOURCE FOR LOW-CONFIDENCE FINDINGS:)$/gm;

/** Escape the angle brackets of any reserved boundary tag, leaving the
 *  readable text intact. Non-tag angle brackets (generics, comparisons) are
 *  untouched. Also neutralizes forged `=== … ===` section markers and
 *  coordinator labels used in prompt assembly. */
export function sanitizeForPrompt(text: string | null | undefined): string {
  if (!text) return '';
  const withoutTags = text.replace(TAG_RE, (m) => m.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
  const withoutSectionHeaders = withoutTags
    .replace(SECTION_HEADER_RE, (line) => line.replace(/=/g, '\uFF1D'))
    .replace(COORDINATOR_LABEL_RE, (line) => line.replace(/:/g, '\uFF1A'));
  return withoutSectionHeaders;
}
