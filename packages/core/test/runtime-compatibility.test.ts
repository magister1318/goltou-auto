import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

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
    for (const packageName of ['core', 'sites', 'surface']) scan(path.resolve('packages', packageName, 'src'));
    expect(failures).toEqual([]);
  });
});
