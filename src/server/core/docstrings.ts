export interface DocstringAnalysisResult {
  fileName: string;
  totalFunctions: number;
  functionsWithDocstrings: number;
  functionsMissingDocstrings: string[];
  /** Same set as functionsMissingDocstrings, with the 1-based declaration line
   *  (for inline PR review comments). */
  missingDocstrings: { name: string; line: number }[];
  requiresJulesTask: boolean;
}

/** 1-based line number of a regex match's start offset. */
function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) if (content[i] === '\n') line++;
  return line;
}

// ponytail: regex heuristic, some false positives; upgrade to an AST parser only if noise warrants.
export function analyzePrFileDocstrings(fileName: string, fileContent: string): DocstringAnalysisResult {
  const result: DocstringAnalysisResult = {
    fileName, totalFunctions: 0, functionsWithDocstrings: 0, functionsMissingDocstrings: [], missingDocstrings: [], requiresJulesTask: false,
  };
  const extension = fileName.split('.').pop()?.toLowerCase() || '';

  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(extension)) {
    const tsRegex = /(?:(\/\*\*[\s\S]*?\*\/)\s*)?(?:(?:export\s+|default\s+|async\s+)*function\s+([a-zA-Z0-9_$]+)|(?:export\s+)?(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)\s*=>|[a-zA-Z0-9_$]+\s*=>|function\s*\())/g;
    let match: RegExpExecArray | null;
    while ((match = tsRegex.exec(fileContent)) !== null) {
      const hasDocstring = !!match[1];
      const funcName = match[2] || match[3];
      if (!funcName) continue;
      result.totalFunctions++;
      if (hasDocstring) result.functionsWithDocstrings++;
      else {
        result.functionsMissingDocstrings.push(funcName);
        result.missingDocstrings.push({ name: funcName, line: lineOf(fileContent, match.index) });
      }
    }
  } else if (extension === 'py') {
    const pyRegex = /^[ \t]*(?:async\s+)?def\s+([a-zA-Z0-9_]+)\s*\([^)]*\)\s*(?:->[^:]+)?:[ \t]*(?:\r?\n[ \t]*(?:("""[\s\S]*?""")|('''[\s\S]*?''')))?/gm;
    let match: RegExpExecArray | null;
    while ((match = pyRegex.exec(fileContent)) !== null) {
      const funcName = match[1];
      const hasDocstring = !!match[2] || !!match[3];
      result.totalFunctions++;
      if (hasDocstring) result.functionsWithDocstrings++;
      else {
        result.functionsMissingDocstrings.push(funcName);
        result.missingDocstrings.push({ name: funcName, line: lineOf(fileContent, match.index) });
      }
    }
  } else if (extension === 'sql') {
    const sqlRegex = /(?:(\/\*[\s\S]*?\*\/|(?:--[^\n]*\n\s*)+)\s*)?CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+([a-zA-Z0-9_.]+)/gi;
    let match: RegExpExecArray | null;
    while ((match = sqlRegex.exec(fileContent)) !== null) {
      const hasDocstring = !!match[1];
      const funcName = match[2];
      result.totalFunctions++;
      if (hasDocstring) result.functionsWithDocstrings++;
      else {
        result.functionsMissingDocstrings.push(funcName);
        result.missingDocstrings.push({ name: funcName, line: lineOf(fileContent, match.index) });
      }
    }
  }

  result.requiresJulesTask = result.functionsMissingDocstrings.length > result.functionsWithDocstrings;
  return result;
}

/** Analyze a set of changed files; returns only those with at least one missing docstring. */
export function analyzeChangedFiles(files: { path: string; content: string }[]): DocstringAnalysisResult[] {
  return files
    .map((f) => analyzePrFileDocstrings(f.path, f.content))
    .filter((r) => r.functionsMissingDocstrings.length > 0);
}
