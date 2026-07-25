import { describe, it, expect } from 'vitest';
import { applyStrategy, normalizeSourceUrl } from '@server/core/standardization';

describe('standardization strategy engine', () => {
  it('normalizes GitHub blob URLs to raw', () => {
    expect(normalizeSourceUrl('https://github.com/o/r/blob/abc123/.gitignore'))
      .toBe('https://raw.githubusercontent.com/o/r/abc123/.gitignore');
    // raw + other URLs pass through
    expect(normalizeSourceUrl('https://raw.githubusercontent.com/o/r/abc/.gitignore'))
      .toBe('https://raw.githubusercontent.com/o/r/abc/.gitignore');
  });

  describe('create_if_missing', () => {
    it('adds when target is absent', () => {
      const c = applyStrategy('create_if_missing', '.gitignore', null, 'node_modules\n');
      expect(c).toMatchObject({ path: '.gitignore', content: 'node_modules\n' });
      expect(c?.existingSha).toBeUndefined();
    });
    it('adds when target is empty', () => {
      const c = applyStrategy('create_if_missing', '.gitignore', { content: '   ', sha: 's' }, 'node_modules\n');
      expect(c?.content).toBe('node_modules\n');
    });
    it('leaves a populated target untouched', () => {
      expect(applyStrategy('create_if_missing', '.gitignore', { content: 'dist\n', sha: 's' }, 'node_modules\n')).toBeNull();
    });
  });

  describe('merge_json', () => {
    it('adds missing keys and keeps existing ones', () => {
      const existing = JSON.stringify({ 'editor.tabSize': 2 });
      const source = JSON.stringify({ 'editor.formatOnSave': true });
      const c = applyStrategy('merge_json', '.vscode/settings.json', { content: existing, sha: 's' }, source);
      expect(c).not.toBeNull();
      const merged = JSON.parse(c!.content);
      expect(merged['editor.tabSize']).toBe(2);
      expect(merged['editor.formatOnSave']).toBe(true);
      expect(c!.existingSha).toBe('s');
    });
    it('no change when all source keys already match', () => {
      const obj = JSON.stringify({ a: 1, b: 2 });
      expect(applyStrategy('merge_json', 'x.json', { content: obj, sha: 's' }, JSON.stringify({ a: 1 }))).toBeNull();
    });
  });

  describe('merge_mcp_servers', () => {
    it('appends missing servers (object map) and keeps existing config', () => {
      const existing = JSON.stringify({ mcpServers: { github: { url: 'g' } } });
      const source = JSON.stringify({ mcpServers: { github: { url: 'DIFFERENT' }, cloudflare: { url: 'cf' } } });
      const c = applyStrategy('merge_mcp_servers', 'mcp.json', { content: existing, sha: 's' }, source);
      expect(c).not.toBeNull();
      const merged = JSON.parse(c!.content);
      expect(merged.mcpServers.github.url).toBe('g');      // existing not overwritten
      expect(merged.mcpServers.cloudflare.url).toBe('cf'); // missing one appended
    });
    it('no change when all servers already present', () => {
      const obj = JSON.stringify({ mcpServers: { a: {}, b: {} } });
      expect(applyStrategy('merge_mcp_servers', 'mcp.json', { content: obj, sha: 's' }, JSON.stringify({ mcpServers: { a: {} } }))).toBeNull();
    });
  });

  describe('overwrite', () => {
    it('replaces a drifted file', () => {
      const c = applyStrategy('overwrite', 'utils/secrets.ts', { content: 'old', sha: 's' }, 'new');
      expect(c?.content).toBe('new');
      expect(c?.existingSha).toBe('s');
    });
    it('no change when identical', () => {
      expect(applyStrategy('overwrite', 'x', { content: 'same\n', sha: 's' }, 'same')).toBeNull();
    });
  });
});
