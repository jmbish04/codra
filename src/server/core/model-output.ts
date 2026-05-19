import { fileReviewModelOutputSchema, parsedReviewCommentSchema, summaryModelOutputSchema, type ParsedReviewComment, reviewSeverities } from '@shared/schema';
import { z } from 'zod';
import { logger } from './logger';
import { findClosestValidLine, findPositionForLine, getValidNewLines, getValidPositions } from './diff';
import type { FileDiff } from './diff';
import { jsonrepair } from 'jsonrepair';

const MAX_LOGGED_MODEL_OUTPUT_CHARS = 2_000;

function truncateForLog(value: string) {
  if (value.length <= MAX_LOGGED_MODEL_OUTPUT_CHARS) return value;
  return `${value.slice(0, MAX_LOGGED_MODEL_OUTPUT_CHARS)}... [truncated ${value.length - MAX_LOGGED_MODEL_OUTPUT_CHARS} chars]`;
}

function hasReviewKeys(input: string) {
  return /"(findings|overall_explanation|overall_correctness|overall_confidence_score|summary)"\s*:/.test(input);
}

function extractJson(raw: string) {
  // 1. Try to find explicit JSON blocks first (most reliable)
  const jsonBlocks = Array.from(raw.matchAll(/```json\s*([\s\S]*?)```/gi));
  if (jsonBlocks.length > 0) {
    return jsonBlocks[jsonBlocks.length - 1][1].trim();
  }

  // 2. Fallback to generic code blocks - must contain a JSON-like structure
  const genericBlocks = Array.from(raw.matchAll(/```(?:[\w+-]+)?\s*([\s\S]*?)```/gi));
  if (genericBlocks.length > 0) {
    const candidates = genericBlocks.filter(b => b[1].includes('{') && b[1].includes('}') && hasReviewKeys(b[1]));
    if (candidates.length > 0) {
      const content = candidates[candidates.length - 1][1].trim();
      // Try to find the actual object inside the code block
      const start = content.indexOf('{');
      const end = content.lastIndexOf('}');
      if (start !== -1 && end !== -1 && end > start) {
        return content.slice(start, end + 1);
      }
      return content;
    }
  }

  // 3. Robust "Outer Brace" extraction
  // Find the first '{' and then match braces to find the corresponding '}'
  // We prioritize blocks that look like our expected JSON
  const findingsIdx = raw.indexOf('"findings"');
  const summaryIdx = raw.indexOf('"summary"');
  const targetIdx = findingsIdx !== -1 ? findingsIdx : (summaryIdx !== -1 ? summaryIdx : -1);

  let firstBrace = -1;
  if (targetIdx !== -1) {
    // Try to find the brace that opens the object containing the keyword
    firstBrace = raw.lastIndexOf('{', targetIdx);
  }

  // If no keyword found, search for generic brace blocks and score them
  if (firstBrace === -1) {
    const allBraces = Array.from(raw.matchAll(/\{/g));
    let bestIdx = -1;
    let bestScore = -1;

    for (const match of allBraces) {
      const idx = match.index!;
      const excerpt = raw.slice(idx, idx + 200);
      let score = 0;

      // Keywords are strong indicators
      if (excerpt.includes('"findings"')) score += 100;
      if (excerpt.includes('"summary"')) score += 50;
      if (excerpt.includes('"overall_explanation"')) score += 50;

      // JSON structure indicators
      if (excerpt.includes('" : ') || excerpt.includes('":')) score += 10;
      if (excerpt.includes('"[')) score += 5;

      // Anti-indicators (looks like code, not our JSON)
      if (excerpt.includes(': number;') || excerpt.includes(': string;')) score -= 80;
      if (excerpt.includes('export ') || excerpt.includes('function ')) score -= 80;
      if (excerpt.includes('interface ') || excerpt.includes('type ')) score -= 80;
      if (excerpt.includes(' + ')) score -= 20; // Looks like a diff hunk

      if (score > bestScore) {
        bestScore = score;
        bestIdx = idx;
      }
    }

    if (bestIdx !== -1 && bestScore > 0) {
      firstBrace = bestIdx;
    }
  }

  // Final fallback to the very first brace if we're desperate and it looks like JSON
  if (firstBrace === -1) {
    const start = raw.indexOf('{');
    if (start !== -1) {
      const excerpt = raw.slice(start, start + 50);
      if (excerpt.includes('"') && excerpt.includes(':')) {
        firstBrace = start;
      }
    }
  }

  if (firstBrace !== -1) {
    let stack = 0;
    let inString = false;
    let escape = false;

    for (let i = firstBrace; i < raw.length; i++) {
      const char = raw[i];

      if (escape) {
        escape = false;
        continue;
      }

      if (char === '\\') {
        escape = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (char === '{') stack++;
        else if (char === '}') {
          stack--;
          if (stack === 0) {
            return raw.slice(firstBrace, i + 1);
          }
        }
      }
    }

    // Truncated - return everything from first brace
    return raw.slice(firstBrace).trim();
  }

  return raw.trim();
}

function isPlaceholderString(value: unknown) {
  return typeof value === 'string' && /^<[^>]+>$/.test(value.trim());
}

function coerceReviewNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && !isPlaceholderString(value)) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function normalizeFinding(finding: any) {
  if (!finding || typeof finding !== 'object') return null;
  if (isPlaceholderString(finding.title) || isPlaceholderString(finding.body)) return null;

  const location = finding.code_location && typeof finding.code_location === 'object' ? finding.code_location : {};
  const line = coerceReviewNumber(location.line);
  const start = coerceReviewNumber(location.line_range?.start);
  const end = coerceReviewNumber(location.line_range?.end);
  const priority = coerceReviewNumber(finding.priority);

  const codeLocation: Record<string, unknown> = {
    absolute_file_path: location.absolute_file_path || finding.path || '',
  };
  if (line !== undefined) {
    codeLocation.line = Math.trunc(line);
  }
  if (start !== undefined || end !== undefined) {
    codeLocation.line_range = {
      start: Math.trunc(start ?? end!),
      end: Math.trunc(end ?? start!),
    };
  }

  return {
    ...finding,
    title: finding.title || 'Code finding',
    priority: priority === undefined ? undefined : Math.max(0, Math.min(3, Math.trunc(priority))),
    code_location: codeLocation,
    confidence_score: typeof finding.confidence_score === 'number'
      ? Math.max(0, Math.min(1, finding.confidence_score > 1 ? finding.confidence_score / 10 : finding.confidence_score))
      : undefined,
  };
}

/**
 * Pre-processes JSON string to handle common LLM defects before passing to jsonrepair.
 * Optimized for CPU performance (avoids backtracking regexes).
 */
function preprocessJson(json: string): string {
  let result = '';
  let inString = false;
  let escape = false;

  for (let i = 0; i < json.length; i++) {
    const char = json[i];

    if (escape) {
      result += char;
      escape = false;
      continue;
    }

    if (char === '\\') {
      result += char;
      escape = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      result += char;
      continue;
    }

    if (inString) {
      if (char === '\n') {
        result += '\\n';
      } else if (char === '\r') {
        result += '\\r';
      } else {
        result += char;
      }
    } else {
      result += char;
    }
  }

  return result;
}

function withSuggestion(body: string, codeSuggestion?: string) {
  if (!codeSuggestion) return body;

  // Clean suggestion: remove existing fences if model added them, and trim
  const cleanSuggestion = codeSuggestion.replace(/```suggestion\n?|```/g, '').trim();

  // Clean body: remove any trailing redundant suggestion blocks if the model double-outputted
  const cleanBody = body.split('```suggestion')[0].trim();

  return `${cleanBody}\n\n\`\`\`suggestion\n${cleanSuggestion}\n\`\`\``;
}

export function parseFileReviewResponse(raw: string, file: FileDiff): {
  comments: ParsedReviewComment[];
  verdict: 'approve' | 'comment';
  fileSummary: string;
  overallCorrectness?: string;
  confidenceScore?: number;
} {
  let extracted = '';
  try {
    extracted = extractJson(raw);
    if (!hasReviewKeys(extracted)) {
      throw new Error('Model response did not contain review JSON keys.');
    }
  } catch (e) {
    logger.error('Failed to extract JSON from model response', { raw: truncateForLog(raw), error: e });
    throw new Error('Could not find JSON root in model response.');
  }

  let preprocessed = '';
  try {
    preprocessed = preprocessJson(extracted);
  } catch (e) {
    logger.warn('JSON preprocessing partially failed, continuing...', { extracted, error: e });
    preprocessed = extracted;
  }

  let repaired = preprocessed;
  try {
    repaired = jsonrepair(preprocessed);
  } catch (e) {
    logger.warn('jsonrepair failed to fix model output, using preprocessed text', { preprocessed: truncateForLog(preprocessed), error: e });
  }

  let parsedJson: any;
  try {
    parsedJson = JSON.parse(repaired);
  } catch (e) {
    logger.error('Critical JSON parse error after extraction and repair', { repaired: truncateForLog(repaired), error: e });
    throw new Error(`Invalid JSON format: ${e instanceof Error ? e.message : 'Unknown error'}`);
  }

  let parsed: z.infer<typeof fileReviewModelOutputSchema>;
  try {
    const findReviewObject = (arr: any[]): any | null => {
      // Priority 1: Has findings array and summary
      const best = arr.find(i => i && typeof i === 'object' && Array.isArray(i.findings) && typeof i.summary === 'string');
      if (best) return best;

      // Priority 2: Has findings array
      const good = arr.find(i => i && typeof i === 'object' && Array.isArray(i.findings));
      if (good) return good;

      // Priority 3: Has review-like keys
      return arr.find(i =>
        i && typeof i === 'object' &&
        ('findings' in i || 'overall_explanation' in i || 'summary' in i || 'overall_correctness' in i)
      );
    };

    const data = Array.isArray(parsedJson) ? (findReviewObject(parsedJson) || parsedJson[0] || {}) : parsedJson;

    // Ensure essential keys exist to avoid schema validation errors
    if (data && typeof data === 'object') {
      if (!data.findings) data.findings = [];
      if (!data.overall_explanation) data.overall_explanation = 'No explanation provided.';
      if (!data.overall_correctness) data.overall_correctness = 'Uncertain';

      // Handle confidence score hallucinations (0-1 range expected)
      if (typeof data.overall_confidence_score === 'number') {
        if (data.overall_confidence_score > 1) {
          // If they gave 1-10 scale, normalize it
          data.overall_confidence_score = Math.min(data.overall_confidence_score / 10, 1);
        } else if (data.overall_confidence_score < 0) {
          data.overall_confidence_score = 0;
        }
      } else {
        data.overall_confidence_score = 0.5;
      }

      if (Array.isArray(data.findings)) {
        data.findings = data.findings.map(normalizeFinding).filter(Boolean);
      }
    }

    parsed = fileReviewModelOutputSchema.parse(data);
  } catch (e) {
    logger.error('Model response failed schema validation', { parsedJson, error: e });
    throw new Error(`Response schema mismatch: ${e instanceof Error ? e.message : 'Check logs'}`);
  }

  const validLines = getValidNewLines(file);
  const validPositions = getValidPositions(file);

  const orphanedComments: string[] = [];
  const comments = (parsed.findings || [])
    .map((finding) => {
      // Codex style findings use start/end or line
      let line = finding.code_location.line || finding.code_location.line_range?.start;
      let position: number | undefined;

      // Try to find position for the line
      if (line !== undefined) {
        // Find if the line exists in the diff
        if (!validLines.has(line)) {
          const closest = findClosestValidLine(file, line);
          if (closest !== undefined) {
            line = closest;
          } else {
            line = undefined;
          }
        }

        if (line !== undefined) {
          position = findPositionForLine(file, line);
        }
      }

      // Final validation
      if (position === undefined || !validPositions.has(position)) {
        orphanedComments.push(`- **${finding.title}:** ${finding.body}`);
        return null;
      }

      // Map priority to severity
      const priorityMap: Record<number, typeof reviewSeverities[number]> = {
        0: 'P0',
        1: 'P1',
        2: 'P2',
        3: 'P3'
      };
      const severity = finding.priority !== undefined ? priorityMap[finding.priority] || 'P2' : 'P2';

      const cleanText = (text: string) => {
        let current = text.trim();
        let prev = '';
        while (current !== prev) {
          prev = current;
          current = current
            .replace(/^([\u{1F300}-\u{1F9FF}]|\[QUALITY\]|\[SECURITY\]|\[BUG\]|\[PERFORMANCE\]|\[CORRECTNESS\]|\[P[0-3]\]|\[NIT\]|QUALITY|SECURITY|BUG|P[0-3]|NIT|[:\-\s\uFE0F]|[^\w\s])+/giu, '')
            .replace(/\n\s*/g, ' ') // Flatten newlines in titles/snippets
            .trim();
        }
        return current;
      };

      const title = cleanText(finding.title);
      let body = cleanText(finding.body);

      // If the body starts with the title or a similar variant, strip it
      const bodyPrefix = cleanText(body.split('\n')[0]);
      if (bodyPrefix.toLowerCase().startsWith(title.toLowerCase()) || title.toLowerCase().startsWith(bodyPrefix.toLowerCase())) {
        body = cleanText(body.slice(body.split('\n')[0].length));
      }

      return parsedReviewCommentSchema.parse({
        path: file.path,
        line: line,
        position,
        severity,
        category: 'quality', // Default for now
        title,
        body: withSuggestion(body, finding.code_suggestion),
        codeSuggestion: finding.code_suggestion,
      });
    })
    .filter((comment): comment is ParsedReviewComment => Boolean(comment));

  const verdict = parsed.overall_correctness.toLowerCase().includes('patch is correct') ? 'approve' : 'comment';
  let fileSummary = parsed.overall_explanation;

  if (orphanedComments.length > 0) {
    fileSummary += `\n\n### Additional Comments (Off-diff)\n${orphanedComments.join('\n')}`;
  }

  return {
    comments,
    verdict: comments.length > 0 ? 'comment' : verdict,
    fileSummary: fileSummary,
    overallCorrectness: parsed.overall_correctness,
    confidenceScore: parsed.overall_confidence_score,
  };
}

export function parseSummaryResponse(raw: string): string {
  const extracted = extractJson(raw);
  const preprocessed = preprocessJson(extracted);

  let repaired = preprocessed;
  try {
    repaired = jsonrepair(preprocessed);
  } catch (e) {
    // Fall back to original preprocessed text if repair fails
  }

  try {
    const parsedJson = JSON.parse(repaired);
    const validated = summaryModelOutputSchema.parse(parsedJson);
    return Array.isArray(validated) ? validated[0]?.summary : validated.summary;
  } catch (error) {
    // If it's not valid JSON or doesn't match the schema, return the raw text as a fallback
    // This handles cases where the model might still ignore the JSON constraint
    return raw.trim() || 'Review completed with no summary provided.';
  }
}
