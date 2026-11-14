import { expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileBlogTitleStore } from '../src/blog-title-store';

it('keeps only the last title across store instances, in a private shell-supplied file', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'goltou-title-'));
  try {
    const file = path.join(directory, 'private', 'title.txt'), store = fileBlogTitleStore(file);
    expect(await store.read()).toBeNull();
    await store.write('합성 제목 하나'); await store.write('합성 제목 둘');
    expect(await fileBlogTitleStore(file).read()).toBe('합성 제목 둘');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
