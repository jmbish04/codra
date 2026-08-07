/** Section/boundary tags the prompt assembler uses as structural delimiters.
 *  Attacker-controlled PR text is scrubbed of these so it cannot forge
 *  structure (mirrors Cloudflare's ai-code-review injection defense). */
export const BOUNDARY_TAGS = [
  'mr_input', 'mr_body', 'mr_comments', 'mr_details', 'changed_files',
  'existing_inline_findings', 'previous_review', 'custom_review_instructions',
  'project_context', 'shared_context',
] as const;

const TAG_RE = new RegExp(`</?(?:${BOUNDARY_TAGS.join('|')})\\s*>`, 'gi');

/** Escape the angle brackets of any reserved boundary tag, leaving the
 *  readable text intact. Non-tag angle brackets (generics, comparisons) are
 *  untouched. */
export function sanitizeForPrompt(text: string | null | undefined): string {
  if (!text) return '';
  return text.replace(TAG_RE, (m) => m.replace('<', '&lt;').replace('>', '&gt;'));
}
