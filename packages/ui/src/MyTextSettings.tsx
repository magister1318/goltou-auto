import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_CLOSING, defaultMyText, type MyText, type User } from '@goltou/api-client';
import { fillMyText } from '@goltou/core/post-extras';

export function UnbrokenPhone({ text, phone }: { text: string; phone?: string | undefined }) {
  const parts = phone ? text.split(phone).flatMap((part, index) => index ? [phone, part] : [part])
    : text.split(/(\d{2,4}-\d{3,4}-\d{4})/g);
  return <>{parts.map((part, index) =>
    index % 2 ? <span className="phone-number" key={index}>{part}</span> : part,
  )}</>;
}

export function TextSwitch({ label, detail, checked, disabled, change }: {
  label: string; detail?: ReactNode; checked: boolean; disabled?: boolean; change(value: boolean): void;
}) {
  return <button className="text-switch" type="button" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} onClick={() => change(!checked)}>
    <span>{label}{detail && <small>{detail}</small>}</span>
    <i aria-hidden="true" />
  </button>;
}

export function MyTextSettings({ user, saved, editing, save, disabled }: {
  user: User; saved?: MyText | undefined; editing: boolean; save(value: MyText): Promise<void>; disabled: boolean;
}) {
  const [value, setValue] = useState(() => saved ?? defaultMyText());
  const [feedback, setFeedback] = useState<'saving' | 'saved' | 'failed'>();
  const id = useId();
  const previewLayer = useRef<HTMLDivElement>(null);
  useEffect(() => { setValue(saved ?? defaultMyText()); }, [user.userNo, saved?.prefix, saved?.closing, saved?.closingOn]);
  const change = (patch: Partial<MyText>) => {
    setValue(previous => ({ ...previous, ...patch }));
    setFeedback(undefined);
  };
  const filled = fillMyText(value.closing, user);
  return <form className={`my-text-settings${editing ? ' editing-text' : ''}`} onSubmit={async event => {
    event.preventDefault();
    if (feedback === 'saving' || disabled) return;
    setFeedback('saving');
    try { await save(value); setFeedback('saved'); }
    catch { setFeedback('failed'); }
  }}>
    <h2 className="section-label">내 글 문구 <span>· 나에게만 적용</span></h2>
    <label htmlFor={`${id}-prefix`}>글 앞 문구</label>
    <textarea id={`${id}-prefix`} rows={2} placeholder="비어 있으면 넣지 않습니다" maxLength={500}
      value={value.prefix} disabled={feedback === 'saving'} onChange={event => change({ prefix: event.target.value })} />
    <p className="text-help">상품 내용 바로 위에 들어갑니다.</p>
    <label htmlFor={`${id}-closing`}>글 끝 문구</label>
    <div className="token-editor">
      <div ref={previewLayer} className="token-layer" aria-hidden="true">{value.closing.split(/(\{닉네임\}|\{휴대폰\})/g).map((part, index) =>
        index % 2 ? <mark key={index}>{part}</mark> : part,
      )}{'\n'}</div>
      <textarea className="token-input" id={`${id}-closing`} rows={3} maxLength={1000}
        value={value.closing} disabled={feedback === 'saving'}
        onScroll={event => { if (previewLayer.current) previewLayer.current.scrollTop = event.currentTarget.scrollTop; }}
        onChange={event => change({ closing: event.target.value })} />
    </div>
    <p className="text-help filled-text">올라갈 모습: <UnbrokenPhone text={filled} phone={user.phone} /></p>
    <div className="text-help reset-text">
      <span>닉네임·휴대폰은 골투 회원 정보에서 가져옵니다.</span>
      <button className="green" type="button" disabled={feedback === 'saving'} onClick={() => change({ closing: DEFAULT_CLOSING })}>기본값으로</button>
    </div>
    {!user.phone && <p className="text-help warn">골투 회원 정보에 휴대폰 번호가 없습니다. 번호 없이 닉네임만 들어갑니다.</p>}
    <TextSwitch label="발행할 때 글 끝 문구 기본으로 넣기" detail="발행 창에서 이번만 끌 수 있습니다"
      checked={value.closingOn} disabled={feedback === 'saving'} change={closingOn => change({ closingOn })} />
    <div className="my-text-actions">
      <span role={feedback === 'failed' ? 'alert' : 'status'} className={feedback === 'failed' ? 'danger' : 'green'}>
        {feedback === 'saved' ? '내 글 문구를 저장했습니다.' : feedback === 'failed' ? '저장하지 못했습니다. 다시 시도해 주세요.' : ''}
      </span>
      <button className="btn primary" type="submit" disabled={disabled || feedback === 'saving'}
        onPointerDown={event => { if (editing) event.preventDefault(); }}>
        {feedback === 'saving' ? '저장 중' : '내 글 문구 저장'}
      </button>
    </div>
  </form>;
}
