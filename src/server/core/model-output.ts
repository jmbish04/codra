import { fileReviewModelOutputSchema, parsedReviewCommentSchema, summaryModelOutputSchema, type ParsedReviewComment } from '@shared/schema';
import { findClosestValidLine, findPositionForLine, getValidNewLines, getValidPositions } from './diff';
import type { FileDiff } from './diff';
import { jsonrepair } from 'jsonrepair';

function extractJson(raw: string) {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    return fenced[1].trim();
  }

  // Support both array ([...]) and object ({...}) roots
  const firstBracket = raw.indexOf('[');
  const firstBrace = raw.indexOf('{');

  // Pick whichever root token appears first (ignoring absent ones)
  const useArray =
    firstBracket !== -1 &&
    (firstBrace === -1 || firstBracket < firstBrace);

  if (useArray) {
    const lastBracket = raw.lastIndexOf(']');
    if (lastBracket > firstBracket) {
      return raw.slice(firstBracket, lastBracket + 1);
    }
    return raw.slice(firstBracket).trim();
  }

  if (firstBrace === -1) {
    return raw.trim();
  }

  const lastBrace = raw.lastIndexOf('}');
  if (lastBrace > firstBrace) {
    return raw.slice(firstBrace, lastBrace + 1);
  }

  return raw.slice(firstBrace).trim();
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
  if (!codeSuggestion) {
    return body;
  }

  return `${body}\n\n\`\`\`suggestion\n${codeSuggestion}\n\`\`\``;
}

export function parseFileReviewResponse(raw: string, file: FileDiff): {
  comments: ParsedReviewComment[];
  verdict: 'approve' | 'comment';
  fileSummary: string;
} {
  const extracted = extractJson(raw);
  const preprocessed = preprocessJson(extracted);
  
  let repaired = preprocessed;
  try {
    repaired = jsonrepair(preprocessed);
  } catch (e) {
    // If repair fails, we'll still try JSON.parse on preprocessed
  }

  const parsedJson = JSON.parse(repaired);
  const parsed = fileReviewModelOutputSchema.parse(parsedJson);
  const validLines = getValidNewLines(file);
  const validPositions = getValidPositions(file);

  const orphanedComments: string[] = [];
  const comments = parsed.comments
    .map((comment) => {
      let line = comment.line;
      let position = comment.position;

      // Try to validate line and find position
      if (line !== undefined && !validLines.has(line)) {
        // Line is invalid, try to find the closest valid one
        const closest = findClosestValidLine(file, line);
        if (closest !== undefined) {
          line = closest;
          position = findPositionForLine(file, line);
        } else {
          // Still could not find a good line
          line = undefined;
        }
      }

      if (position === undefined && line !== undefined) {
        position = findPositionForLine(file, line);
      }

      // Final validation
      if ((line !== undefined && !validLines.has(line)) || (position !== undefined && !validPositions.has(position)) || (line === undefined && position === undefined)) {
        orphanedComments.push(`- **Line ${comment.line || '?'}:** ${comment.title} - ${comment.body}`);
        return null;
      }

      return parsedReviewCommentSchema.parse({
        path: file.path,
        line: line,
        position,
        severity: comment.severity,
        category: comment.category,
        title: comment.title,
        body: withSuggestion(comment.body, comment.code_suggestion),
        codeSuggestion: comment.code_suggestion,
      });
    })
    .filter((comment): comment is ParsedReviewComment => Boolean(comment));

  let fileSummary = parsed.file_summary;
  if (orphanedComments.length > 0) {
    fileSummary += `\n\n### Additional Feedback\n${orphanedComments.join('\n')}`;
  }

  return {
    comments,
    verdict: parsed.file_verdict,
    fileSummary: fileSummary,
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
    return validated[0]?.summary || 'Review completed with no summary provided.';
  } catch (error) {
    // If it's not valid JSON or doesn't match the schema, return the raw text as a fallback
    // This handles cases where the model might still ignore the JSON constraint
    return raw.trim() || 'Review completed with no summary provided.';
  }
}
