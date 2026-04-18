import { fileReviewModelOutputSchema, parsedReviewCommentSchema, summaryModelOutputSchema, type ParsedReviewComment, reviewSeverities } from '@shared/schema';
import { z } from 'zod';
import { logger } from './logger';
import { findClosestValidLine, findPositionForLine, getValidNewLines, getValidPositions } from './diff';
import type { FileDiff } from './diff';
import { jsonrepair } from 'jsonrepair';

function extractJson(raw: string) {
  // 1. Try to find the last markdown code block first (often where the "final" answer is)
  const blocks = Array.from(raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi));
  if (blocks.length > 0) {
    return blocks[blocks.length - 1][1].trim();
  }

  // 1b. Handle truncated markdown block (unclosed)
  const openBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*)$/i);
  if (openBlockMatch) {
    return openBlockMatch[1].trim();
  }

  // 2. If no code blocks, look for the block containing "findings" or "summary"
  const findingsIdx = raw.lastIndexOf('"findings"');
  const summaryIdx = raw.lastIndexOf('"summary"');
  const targetIdx = Math.max(findingsIdx, summaryIdx);

  if (targetIdx !== -1) {
    const startIdx = raw.lastIndexOf('{', targetIdx);
    if (startIdx !== -1) {
      const endIdx = raw.lastIndexOf('}');
      if (endIdx > startIdx) {
        return raw.slice(startIdx, endIdx + 1);
      }
      return raw.slice(startIdx); // Pass to jsonrepair to salvage
    }
  }

  // 3. Fallback to basic balanced braces
  const firstBrace = raw.indexOf('{');
  if (firstBrace !== -1) {
    const lastBrace = raw.lastIndexOf('}');
    if (lastBrace > firstBrace) {
      return raw.slice(firstBrace, lastBrace + 1);
    }
    return raw.slice(firstBrace);
  }

  return raw.trim();
}

/**
 * Pre-processes JSON string to handle common LLM defects before passing to jsonrepair.
 */
function preprocessJson(json: string): string {
  // Replace unescaped newlines within string values
  // This looks for content between quotes and escapes literal newlines
  return json.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/g, (match, content) => {
    return `"${content.replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`;
  });
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
  } catch (e) {
    logger.error('Failed to extract JSON from model response', { raw, error: e });
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
    logger.warn('jsonrepair failed to fix model output, using preprocessed text', { preprocessed, error: e });
  }

  let parsedJson: any;
  try {
    parsedJson = JSON.parse(repaired);
  } catch (e) {
    logger.error('Critical JSON parse error after extraction and repair', { repaired, error: e });
    throw new Error(`Invalid JSON format: ${e instanceof Error ? e.message : 'Unknown error'}`);
  }

  let parsed: z.infer<typeof fileReviewModelOutputSchema>;
  try {
    parsed = fileReviewModelOutputSchema.parse(parsedJson);
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
