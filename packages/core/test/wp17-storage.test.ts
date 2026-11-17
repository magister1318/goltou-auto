import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileBandPostAllowance } from '../src/band-allowance';
import { filePostMetadata } from '../src/post-metadata';
describe('app-private noncredential state', () => {
  it('keeps the real post gate closed by default and atomically consumes exactly one allowance', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'band-gate-'));
    try {
      const file = path.join(dir, 'allow'),
        gate = fileBandPostAllowance(file);
      expect(await gate.available()).toBe(false);
      expect(await gate.consume()).toBe(false);
      await writeFile(file, '');
      expect(await gate.available()).toBe(true);
      const results = await Promise.all([gate.consume(), gate.consume()]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await gate.available()).toBe(false);
      expect(await gate.consume()).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it('preserves visibility across a store restart and leaves older record visibility unknown', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'post-meta-'));
    try {
      const file = path.join(dir, 'records');
      await filePostMetadata(file).set(91, 'private');
      expect(await filePostMetadata(file).get(91)).toBe('private');
      expect(await filePostMetadata(file).get(92)).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it('keeps a table fallback notice independently of retained logs and migrates legacy visibility without losing either flag',async()=>{
    const dir=await mkdtemp(path.join(os.tmpdir(),'table-meta-'));
    try{
      const file=path.join(dir,'records');await writeFile(file,JSON.stringify({'91':'private'}));
      expect(await filePostMetadata(file).getTableFallback(91)).toBe(false);
      await filePostMetadata(file).setTableFallback(91);
      expect(await filePostMetadata(file).get(91)).toBe('private');
      expect(await filePostMetadata(file).getTableFallback(91)).toBe(true);
      await filePostMetadata(file).set(91,'public');
      expect(await filePostMetadata(file).getTableFallback(91)).toBe(true);
      expect(await filePostMetadata(file).get(91)).toBe('public');
      expect(await filePostMetadata(file).getTableFallback(92)).toBe(false);
      await writeFile(file,JSON.stringify({'91':{tableFallback:'private cell text'}}));
      await expect(filePostMetadata(file).getTableFallback(91)).rejects.toThrow('INVALID_POST_METADATA');
    }finally{await rm(dir,{recursive:true,force:true});}
  });

});
