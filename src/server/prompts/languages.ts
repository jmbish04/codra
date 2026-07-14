export type LanguageGuideline = {
  language: string;
  extensions: string[];
  guidelines: string[];
  persona?: string;
};

export const LANGUAGE_GUIDELINES: LanguageGuideline[] = [
  {
    language: 'TypeScript/JavaScript',
    persona: 'an expert TypeScript developer who prioritizes type safety, clean async code, and modern ECMAScript patterns',
    extensions: ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'],
    guidelines: [
      'Check for proper type safety and avoid using "any" where possible (especially in TypeScript).',
      'Look for potential memory leaks, such as uncleared timeouts or event listeners.',
      'Ensure modern ES6+ syntax is used appropriately.',
      'Check for common security pitfalls like "eval()" or insecure regex.',
      'Suggest using optional chaining and nullish coalescing for cleaner code.',
      'Verify that async/await is used correctly and errors are handled.',
      'Flag exported functions and classes missing JSDoc comments. Suggest a /** ... */ docstring with @param and @returns tags.',
      'Flag confusing or non-obvious code blocks that lack inline comments explaining the logic.',
    ],
  },
  {
    language: 'Python',
    persona: 'a Python expert who follows PEP 8 and prefers "Pythonic" solutions',
    extensions: ['py'],
    guidelines: [
      'Ensure adherence to PEP 8 style guidelines.',
      'Check for proper docstrings (PEP 257). Flag any public function, class, or method missing a docstring.',
      'Look for efficient use of list comprehensions and generators.',
      'Verify correct exception handling (avoid bare "except:").',
      'Ensure type hints are used where appropriate.',
      'Check for mutable default arguments in functions.',
      'Flag confusing or non-obvious code blocks that lack inline comments explaining the logic.',
    ],
  },
  {
    language: 'React',
    persona: 'a senior React developer who focuses on component performance, hooks best practices, and accessibility',
    extensions: ['tsx', 'jsx'],
    guidelines: [
      'Check for missing dependency arrays in useEffect/useCallback/useMemo.',
      'Ensure components are reusable and follow the "single responsibility" principle.',
      'Look for unnecessary re-renders or heavy computations in the render path.',
      'Verify proper use of keys in lists.',
      'Check for accessibility (aria-labels, roles, etc.) in JSX.',
    ],
  },
  {
    language: 'CSS/SCSS/Less',
    persona: 'a UI/UX focused frontend engineer who loves clean, maintainable CSS and responsive design',
    extensions: ['css', 'scss', 'sass', 'less'],
    guidelines: [
      'Check for hardcoded magic numbers; suggest using variables/design tokens.',
      'Look for overly specific selectors that might cause specificity issues.',
      'Ensure responsive design practices (media queries, flexbox/grid).',
      'Check for unused or redundant styles.',
    ],
  },
  {
    language: 'SQL',
    persona: 'a database administrator and performance expert who prioritizes query efficiency and data integrity',
    extensions: ['sql'],
    guidelines: [
      'Check for potential SQL injection vulnerabilities.',
      'Look for missing indexes on frequently filtered columns.',
      'Suggest using JOINs instead of subqueries where performance might be better.',
      'Verify that database migrations follow a safe/atomic pattern.',
    ],
  },
  {
    language: 'Markdown',
    persona: 'a technical writer who values clear documentation and consistent formatting',
    extensions: ['md', 'mdx'],
    guidelines: [
      'Check for broken links or missing images.',
      'Ensure consistent heading levels.',
      'Look for spelling or grammatical errors.',
      'Verify that code blocks have language specifiers.',
    ],
  },
  {
    language: 'HTML',
    persona: 'a web standards expert who focuses on semantic HTML and accessibility',
    extensions: ['html', 'htm'],
    guidelines: [
      'Ensure semantic HTML elements are used.',
      'Check for basic SEO (meta tags, title, alt text for images).',
      'Verify accessibility (WCAG compliance).',
    ],
  },
  {
    language: 'JSON/Config',
    persona: 'a DevOps engineer who values clear configuration and schema validity',
    extensions: ['json', 'jsonc', 'yaml', 'yml', 'toml'],
    guidelines: [
      'Check for syntax errors or invalid schemas.',
      'Ensure consistent naming conventions (e.g., camelCase vs snake_case).',
      'Look for hardcoded secrets or sensitive information.',
    ],
  },
];

export function getLanguageForFile(path: string): LanguageGuideline | undefined {
  const ext = path.split('.').pop()?.toLowerCase();
  if (!ext) return undefined;

  const matches = LANGUAGE_GUIDELINES.filter((g) => g.extensions.includes(ext));
  
  if (matches.length === 0) return undefined;

  if (matches.length > 1) {
    return {
      language: matches.map(m => m.language).join(' & '),
      persona: matches.map(m => m.persona).filter(Boolean).join(' and '),
      extensions: Array.from(new Set(matches.flatMap(m => m.extensions))),
      guidelines: Array.from(new Set(matches.flatMap(m => m.guidelines))),
    };
  }

  return matches[0];
}
