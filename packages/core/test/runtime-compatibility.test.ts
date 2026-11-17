import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { incompatiblePatterns } from '../../../scripts/check-embedded-compat.mjs';

describe('embedded Node without ICU', () => {
  it('contains no Unicode property regex literals in the shared engine sources', () => {
    const failures: string[] = [];
    function scan(directory: string) {
      for (const item of readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, item.name);
        if (item.isDirectory()) scan(file);
        else if (file.endsWith('.ts')) {
          const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
          function visit(node: ts.Node) { if (ts.isRegularExpressionLiteral(node) && /\\[pP]\{/.test(node.text)) failures.push(file); ts.forEachChild(node, visit); }
          visit(source);
        }
      }
    }
    for (const packageName of ['core', 'sites', 'surface', 'api-client']) scan(path.resolve('packages', packageName, 'src'));
    scan(path.resolve('apps/android/bridge'));
    expect(failures).toEqual([]);
  });

  it('rejects the exact WP27 pattern in its original scanned path and in the built engine', () => {
    const oldCode = String.raw`const expectedTags = (planned.match(/(?:^|\s)#[\p{L}\p{N}_]+/gu) ?? []).length;`;
    const originalPath = path.resolve('packages/sites/src/band/posted.ts');
    expect(readFileSync(originalPath, 'utf8')).toContain('settleFullBandPost');
    // This is the original scanner predicate, proving it covered the bad file.
    const source = ts.createSourceFile(originalPath, oldCode, ts.ScriptTarget.Latest, true);
    const found: string[] = [];
    function visit(node: ts.Node) {
      if (ts.isRegularExpressionLiteral(node) && /\\[pP]\{/.test(node.text)) found.push(originalPath);
      ts.forEachChild(node, visit);
    }
    visit(source);
    expect(found).toEqual([originalPath]);
    expect(incompatiblePatterns(oldCode, originalPath)).toEqual([1]);
    expect(incompatiblePatterns(oldCode, 'engine.cjs')).toEqual([1]);
  });

  it.each([
    String.raw`new RegExp('\\p{L}+', 'gu')`,
    String.raw`RegExp("\\P{N}", 'u')`,
    'new RegExp(`\\\\p{L}${suffix}`, "u")',
  ])('rejects decoded constructor and template patterns: %s', source => {
    expect(incompatiblePatterns(source)).toEqual([1]);
  });

  it('accepts explicit character ranges on the ICU-less runtime', () => {
    expect(incompatiblePatterns(String.raw`const tags = /[가-힣A-Za-z0-9_]+/gu;`)).toEqual([]);
  });
});
