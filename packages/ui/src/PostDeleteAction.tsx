import { useState } from 'react';
import type { Post } from '@goltou/api-client';
import { canDeletePost } from '@goltou/core/post-delete-policy';

export function DeleteConfirmation({ title, busy, cancel, confirm }: { title: string; busy: boolean; cancel(): void; confirm(): void }) {
  return <section className="publish-confirm" role="alertdialog" aria-label="블로그 글 삭제 확인"><h2>블로그 글을 삭제할까요?</h2><p>{title}</p><p>이 블로그 글을 네이버에서 삭제합니다. 삭제한 글은 복구할 수 없습니다.</p><button disabled={busy} onClick={cancel}>취소</button><button className="chosen" disabled={busy} onClick={confirm}>확인하고 글 삭제</button></section>;
}
export function PostDeleteAction({ post, scope, busy, prepare, remove }: { post: Post; scope: 'mine' | 'all'; busy: boolean; prepare(postNo: number): Promise<{ confirmation: string; productTitle: string }>; remove(confirmation: string): Promise<void> }) {
  const [pending, setPending] = useState<{ confirmation: string; productTitle: string } | null>(null);
  const [sending, setSending] = useState(false), [error, setError] = useState('');
  if (!canDeletePost(post, scope)) return null;
  const run = async (action: () => Promise<void>) => { setSending(true); setError(''); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : '글 삭제를 확인하지 못했습니다.'); } finally { setSending(false); } };
  return <><button className="small" disabled={busy || sending} onClick={() => void run(async () => { setPending(await prepare(post.postNo)); })}>글 삭제</button>{error && <p role="alert">{error}</p>}{pending && <DeleteConfirmation title={pending.productTitle} busy={busy || sending} cancel={() => setPending(null)} confirm={() => { const key = pending.confirmation; setPending(null); void run(() => remove(key)); }}/>}</>;
}
