import { describe, expect, it } from 'vitest';
import { Script } from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { Surface } from '@goltou/surface';
import { bandSnapshot, domSummary, listBands, loginState, snapshot } from '../src';

describe('site read-only expressions and fixtures', () => {
  it('produces valid JavaScript for every reader, including escaped CSS and URL patterns', async () => {
    const expressions: string[] = [];
    const surface = { session: 'band', evaluateReadOnly: async (expression: string) => {
      expressions.push(expression); new Script(expression);
      if (expression.includes("return 'expired'")) return 'confirmed';
      if (expression.includes("return 'legacy'")) return 'legacy';
      return expression.includes('const seen=new Set') ? [{ key: '123', name: '연습' }] : null;
    } } as unknown as Surface;
    await loginState(surface); await listBands(surface); await bandSnapshot(surface, '연습 글'); await snapshot(surface); await domSummary(surface);
    expect(expressions).toHaveLength(6);
    expect(expressions.join('\n')).not.toMatch(/document\.cookie|localStorage|sessionStorage|dispatchEvent|execCommand|\.click\(/);
  });
  it('ships five distinct PNGs rather than external photo references', async () => {
    const hashes: string[] = [];
    for (let i = 1; i <= 5; i++) {
      const bytes = await readFile(new URL(`../fixtures/sample-${i}.png`, import.meta.url));
      expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      expect(bytes.readUInt32BE(16)).toBe(320); expect(bytes.readUInt32BE(20)).toBe(180);
      hashes.push(createHash('sha256').update(bytes).digest('hex'));
    }
    expect(new Set(hashes).size).toBe(5);
  });
});
