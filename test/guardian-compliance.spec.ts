import { describe, expect, it } from 'vitest';
import { scanDiffForCompliance, buildComplianceComment } from '@server/core/guardian-compliance';

/** Minimal unified-diff builder for one added-line file. */
function diff(path: string, addedLines: string[]): string {
  const body = addedLines.map((l) => `+${l}`).join('\n');
  return `diff --git a/${path} b/${path}
--- a/${path}
+++ b/${path}
@@ -0,0 +1,${addedLines.length} @@
${body}
`;
}

describe('scanDiffForCompliance', () => {
  it('flags a direct OpenAI call not routed through guardian', () => {
    const scan = scanDiffForCompliance(diff('src/ai.ts', [
      `import OpenAI from 'openai';`,
      `const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });`,
      `await client.chat.completions.create({ model: 'gpt-4o' });`,
    ]));
    expect(scan.findings).toHaveLength(1);
    expect(scan.findings[0].file).toBe('src/ai.ts');
    expect(scan.findings[0].local).toBe(false);
  });

  it('clears a file that actually wires guardian (structural signature)', () => {
    const scan = scanDiffForCompliance(diff('src/ai.ts', [
      `import { GuardianClient } from './lib/guardian/guardian-client';`,
      `const g = GuardianClient.fromEnv(env);`,
      `const r = await g.ai.run({ provider: 'openai', model: 'gpt-4o-mini', input });`,
    ]));
    expect(scan.guardianPresent).toBe(true);
    expect(scan.findings).toHaveLength(0);
  });

  it('is NOT defeated by a bare core-guardian mention next to a real provider call', () => {
    const scan = scanDiffForCompliance(diff('src/ai.ts', [
      `// TODO: route through core-guardian eventually`,
      `const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });`,
    ]));
    expect(scan.findings).toHaveLength(1);
  });

  it('does not let a guardian helper in one file launder a raw provider call in another', () => {
    const raw = diff('src/guardian-setup.ts', [`const g = GuardianClient.fromEnv(env);`])
      + diff('src/bypass.ts', [`const client = new OpenAI(); await client.chat.completions.create({});`]);
    const scan = scanDiffForCompliance(raw);
    expect(scan.findings.map((f) => f.file)).toEqual(['src/bypass.ts']);
  });

  it('marks a local Ollama call and surfaces the local note', () => {
    const scan = scanDiffForCompliance(diff('worker/llm.ts', [
      `const res = await fetch('http://localhost:11434/api/generate', { method: 'POST' });`,
    ]));
    expect(scan.findings).toHaveLength(1);
    expect(scan.findings[0].local).toBe(true);
    expect(scan.anyLocal).toBe(true);
    expect(buildComplianceComment(scan)).toContain("You're calling a local model service");
  });

  it('ignores docs, lockfiles, and vendored paths', () => {
    expect(scanDiffForCompliance(diff('README.md', [`Use \`new OpenAI()\` to start.`])).findings).toHaveLength(0);
    expect(scanDiffForCompliance(diff('pnpm-lock.yaml', [`openai: 4.0.0`])).findings).toHaveLength(0);
    expect(scanDiffForCompliance(diff('node_modules/openai/index.js', [`new OpenAI()`])).findings).toHaveLength(0);
  });

  it('does not flag a diff with no AI inference', () => {
    const scan = scanDiffForCompliance(diff('src/util.ts', [`export const add = (a: number, b: number) => a + b;`]));
    expect(scan.findings).toHaveLength(0);
    expect(scan.guardianPresent).toBe(false);
  });

  it('renders the marker and integration steps in the comment', () => {
    const scan = scanDiffForCompliance(diff('src/ai.ts', [`await anthropic.messages.create({});`, `import Anthropic from '@anthropic-ai/sdk';`]));
    const body = buildComplianceComment(scan);
    expect(body).toContain('<!-- codra:guardian-compliance -->');
    expect(body).toContain('ai-router');
    expect(body).toContain('AGENTS.md');
  });
});
