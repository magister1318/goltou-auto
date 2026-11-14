import type { BlogVisibility } from '@goltou/core/protocol';
export function BlogVisibilityChoice({ value, change }: { value: BlogVisibility; change(value: BlogVisibility): void }) {
  return <div className="choice-row" role="radiogroup" aria-label="블로그 공개 범위"><span>블로그 공개 범위</span>{(['public', 'private'] as const).map(mode =>
    <button key={mode} role="radio" aria-checked={value === mode} className={value === mode ? 'chosen' : ''} onClick={() => change(mode)}>{mode === 'public' ? '전체공개' : '비공개'}</button>)}</div>;
}
export function PublishConfirmation({ visibility, count, busy, back, start }: { visibility: BlogVisibility; count: number; busy: boolean; back(): void; start(): void }) {
  return <section className="publish-confirm" role="alertdialog" aria-labelledby="publish-title"><h2 id="publish-title">{visibility === 'private' ? '비공개로 발행합니다' : '전체공개로 발행합니다'}</h2><p>선택한 {count}곳에 이 상품을 발행할까요?</p><button onClick={back}>돌아가기</button><button className="chosen" disabled={busy} onClick={start}>확인하고 발행 시작</button></section>;
}
