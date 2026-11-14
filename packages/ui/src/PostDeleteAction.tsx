import { useState } from 'react';
import type { Post } from '@goltou/api-client';
import { canDeletePost } from '@goltou/core/post-delete-policy';
import { Sheet } from './Sheet';

export function DeleteConfirmation({ title, busy, cancel, confirm }: { title: string; busy: boolean; cancel(): void; confirm(): void }) {
  return <Sheet title="블로그 글을 삭제할까요?" close={cancel}><p>{title}</p><div className="warnline danger">네이버 블로그에서 글이 지워지며 되돌릴 수 없습니다.</div><div className="acts"><button className="btn quiet" disabled={busy} onClick={cancel}>취소</button><button className="btn destructive" disabled={busy} onClick={confirm}>삭제</button></div></Sheet>;
}
export function PostDeleteAction({ post, scope, busy, prepare, remove }: { post: Post; scope: 'mine' | 'all'; busy: boolean; prepare(postNo: number): Promise<{ confirmation: string; productTitle: string }>; remove(confirmation: string): Promise<void> }) {
  const [pending, setPending] = useState<{ confirmation: string; productTitle: string } | null>(null);
  const [sending, setSending] = useState(false), [error, setError] = useState('');
  if (!canDeletePost(post, scope)) return null;
  const run = async (action: () => Promise<void>) => { setSending(true); setError(''); try { await action(); } catch (e) { setError('글을 삭제했는지 확인하지 못했습니다. 등록 기록을 확인한 뒤 담당자에게 알려 주세요.'); } finally { setSending(false); } };
  return <><button className="small" disabled={busy || sending} onClick={() => void run(async () => { setPending(await prepare(post.postNo)); })}>글 삭제</button>{error && <p role="alert">{error}</p>}{pending && <DeleteConfirmation title={pending.productTitle} busy={busy || sending} cancel={() => setPending(null)} confirm={() => { const key = pending.confirmation; setPending(null); void run(() => remove(key)); }}/>}</>;
}
