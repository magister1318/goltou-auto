import { useState } from 'react';
import type { Post } from '@goltou/api-client';
import { canDeletePost } from '@goltou/core/post-delete-policy';
import { Sheet } from './Sheet';
export type DeleteOutcome = 'deleted' | 'not_started' | 'uncertain';
export function deleteFeedback(outcome: 'not_started' | 'uncertain') {
  return outcome === 'not_started'
    ? '삭제를 시작하지 못했습니다. 글은 그대로 있습니다.'
    : '삭제를 눌렀지만 지워졌는지 확인하지 못했습니다.';
}
export function DeleteConfirmation({
  title,
  busy,
  cancel,
  confirm,
  channel = 'blog',
  bandName = '',
}: {
  title: string;
  busy: boolean;
  cancel(): void;
  confirm(): void;
  channel?: 'blog' | 'band';
  bandName?: string;
}) {
  return (
    <Sheet
      title={
        channel === 'band' ? '밴드 글을 삭제할까요?' : '블로그 글을 삭제할까요?'
      }
      close={cancel}
      dismissible={!busy}
    >
      <p>
        {title}
        {channel === 'band' && (
          <>
            <br />
            {bandName}
          </>
        )}
      </p>
      <div className="warnline danger">
        {channel === 'band'
          ? '밴드에서 글이 지워지며 되돌릴 수 없습니다. 글에 달린 댓글도 함께 사라집니다.'
          : '네이버 블로그에서 글이 지워지며 되돌릴 수 없습니다.'}
      </div>
      <div className="acts">
        <button className="btn quiet" disabled={busy} onClick={cancel}>
          취소
        </button>
        <button className="btn destructive" disabled={busy} onClick={confirm}>
          삭제
        </button>
      </div>
    </Sheet>
  );
}
export function PostDeleteAction({
  post,
  scope,
  busy,
  prepare,
  remove,
}: {
  post: Post;
  scope: 'mine' | 'all';
  busy: boolean;
  prepare(
    postNo: number,
  ): Promise<{ confirmation: string; productTitle: string }>;
  remove(confirmation: string): Promise<DeleteOutcome | void>;
}) {
  const [pending, setPending] = useState<{
    confirmation: string;
    productTitle: string;
  } | null>(null);
  const [sending, setSending] = useState(false),
    [outcome, setOutcome] = useState<'not_started' | 'uncertain' | null>(null);
  if (!canDeletePost(post, scope)) return null;
  const begin = async () => {
    setSending(true);
    setOutcome(null);
    try {
      setPending(await prepare(post.postNo));
    } catch {
      setOutcome('not_started');
    } finally {
      setSending(false);
    }
  };
  const confirm = async () => {
    if (!pending || sending) return;
    setSending(true);
    setOutcome(null);
    try {
      const result = await remove(pending.confirmation);
      setPending(null);
      if (result === 'not_started' || result === 'uncertain')
        setOutcome(result);
    } catch (e) {
      setPending(null);
      setOutcome(
        e instanceof Error && /삭제하지 않고|시작하지/.test(e.message)
          ? 'not_started'
          : 'uncertain',
      );
    } finally {
      setSending(false);
    }
  };
  return (
    <>
      <button
        className="small danger"
        disabled={busy || sending}
        onClick={() => void begin()}
      >
        글 삭제
      </button>
      {outcome && (
        <div
          className={`row-error ${outcome === 'uncertain' ? 'uncertain' : ''}`}
          role="alert"
        >
          {deleteFeedback(outcome)}
          <button
            className="green"
            disabled={busy || sending}
            onClick={() => void begin()}
          >
            {outcome === 'not_started' ? '다시 시도' : '글 존재 여부 다시 확인'}
          </button>
        </div>
      )}
      {pending && (
        <DeleteConfirmation
          title={pending.productTitle}
          channel={post.channel}
          bandName={post.targetName}
          busy={busy || sending}
          cancel={() => setPending(null)}
          confirm={() => void confirm()}
        />
      )}
    </>
  );
}
