import { describe, expect, it, vi } from 'vitest';
import type { Surface, SurfaceDialog } from '@goltou/surface';
import { openPostDeletionRead } from '../src/naver-blog/delete';
const url = 'https://blog.naver.com/synthetic/9001';
describe('missing-post native alert during pending navigation', () => {
  function fixture(change: Partial<SurfaceDialog> = {}) {
    let dialog: SurfaceDialog | null = null;
    let finish!: () => void;
    const answer = vi.fn(async () => { dialog = null; finish(); });
    const surface = { readDialog: async () => dialog, readAppFocus: async () => true, respondDialog: answer,
      open: async () => { dialog = { id: 'new', kind: 'alert', url, message: '게시물이 삭제되었거나 다른 페이지로 변경되었습니다.', ...change }; await new Promise<void>(resolve => { finish = resolve; }); },
    } as unknown as Surface;
    return { surface, answer, finish: () => finish() };
  }
  it('reads a fixed absence alert at the recorded URL and rejects it without accepting another confirm', async () => {
    const f = fixture(); expect(await openPostDeletionRead(f.surface, url)).toBe(true);
    expect(f.answer).toHaveBeenCalledExactlyOnceWith('new', false);
  });
  it.each([{ kind: 'confirm' as const }, { message: '다른 확인 안내' }, { url: url.replace('9001', '9002') }, { url: url.replace('synthetic', 'other') }])('leaves an unrelated or changed native dialog unanswered (%#)', async change => {
    const f = fixture(change); await expect(openPostDeletionRead(f.surface, url)).rejects.toThrow('BLOG_POST_DELETE_READ_ALERT_UNCONFIRMED');
    expect(f.answer).not.toHaveBeenCalled(); f.finish();
  });
  it('refuses a pre-existing dialog without navigating', async () => {
    const open = vi.fn(); const surface = { open, readDialog: async () => ({ kind: 'alert' }) } as unknown as Surface;
    await expect(openPostDeletionRead(surface, url)).rejects.toThrow('BLOG_POST_DELETE_EXISTING_DIALOG'); expect(open).not.toHaveBeenCalled();
  });
});
