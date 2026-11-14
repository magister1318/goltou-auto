import { useEffect, useState } from 'react';
import type { ExperimentState } from '@goltou/core/experiments';
import { experiment } from './store';

export function ExperimentsScreen({ back }: { back(): void }) {
  const [state, setState] = useState<ExperimentState | null>(null);
  const [error, setError] = useState('');
  const [channel, setChannel] = useState<'naver' | 'band'>('naver');
  const [bandKey, setBandKey] = useState('');
  const [ua, setUa] = useState('desktop');
  const [sending, setSending] = useState(false);
  const [declineAutoRecover, setDeclineAutoRecover] = useState(false);
  const labels = { confirmed: '로그인됨', expired: '풀림', unknown: '모름' };
  useEffect(() => {
    let active = true;
    const refresh = () => { void experiment('state').then(v => { if (active) setState(v); }).catch(() => {}); };
    refresh(); const timer = setInterval(refresh, 1000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  async function run(command: string, input: Record<string, unknown> = {}) {
    if (command === 'blog.run') setDeclineAutoRecover(false);
    setSending(true); setError('');
    try { setState(await experiment(command, input)); } catch (e) { setError(e instanceof Error ? e.message : '실험 요청 실패'); }
    finally { setSending(false); }
  }
  const busy = sending || state?.running;
  return <><div className="plain-top"><button onClick={back}>← 설정</button></div><main className="settings-content experiments-content"><h1>실험</h1>
    <p>디버그 전용 · 한 번에 한 실험. 로그인은 사용자가 직접 합니다.</p>
    <p className="warn">예시 블로그는 임시저장까지만, 밴드는 게시 직전까지 확인합니다. 발행 차단 프로브도 실제 발행 요청을 항상 막습니다.</p>
    {error && <p role="alert">{error}</p>}
    <section><h2>이번 비공개 실험 글</h2><p>복구 문맥과 제목·비공개·사진 13장이 모두 일치하는 WP14 글 한 건만 삭제합니다.</p><button disabled={busy} onClick={() => void run('blog.deleteTestPost')}>이번 비공개 실험 글 삭제</button><button disabled={busy} onClick={() => void run('blog.checkTestPostDeleted')}>삭제 결과만 확인</button></section>
    <section><h2>발행 차단 프로브</h2><p>설정 뒤 실제 상품을 블로그만·발행 방식·같은 공개 범위로 시작합니다. 최종 요청은 무조건 차단하고 구조만 앱 안에 기록합니다.</p><div className="experiment-actions">
      <button disabled={busy} onClick={() => void run('blog.publishProbe', { visibility: 'private' })}>비공개 차단 프로브 설정</button>
      <button disabled={busy} onClick={() => void run('blog.publishProbe', { visibility: 'public' })}>전체공개 차단 프로브 설정</button>
      <button disabled={busy} onClick={() => void run('blog.publishProbe', { visibility: 'off' })}>발행 차단 프로브 해제</button>
    </div></section>
    <section><h2>실제 상품 변환</h2><p>골투 로그인 후 최신 상품 최대 60개를 읽습니다. 요청 사이는 1초 이상이며 등록과 사이트 열기는 하지 않습니다. 수치만 앱 내부 files/wp7/conversion.json에 남깁니다. 밴드 한도는 관측값이 없으면 미확인으로 남깁니다.</p><button disabled={busy} onClick={() => void run('conversion.check')}>변환 점검</button></section>
    <section><h2>로그인 없이 진단</h2><div className="experiment-actions">
      <button disabled={busy} onClick={() => void run('info')}>기기·Node·프로필 확인</button>
      <button disabled={busy} onClick={() => void run('example')}>example.com 제목 읽기</button>
      <button disabled={busy} onClick={() => void run('show')}>숨김 Surface 보이기</button>
      <button disabled={busy} onClick={() => void run('hide')}>Surface 숨기기</button>
      <button disabled={busy} onClick={() => void run('evidence')}>캡처·DOM 기록 확인</button>
      <button disabled={busy} onClick={() => void run('lifecycle', { mode: 'background' })}>앱 뒤로 보내기 · 30초 안에 직접 복귀</button>
      <button disabled={busy} onClick={() => void run('lifecycle', { mode: 'rotate' })}>앱 화면 회전</button>
      <button disabled={busy} onClick={() => void run('lifecycle', { mode: 'recreate' })}>Activity 재생성</button>
    </div>{state?.info && <dl className="experiment-info">{Object.entries(state.info).filter(([, v]) => v !== undefined).map(([key, v]) => <div key={key}><dt>{key}</dt><dd>{Array.isArray(v) ? v.join(' · ') : String(v)}</dd></div>)}</dl>}</section>
    <section><h2>AI 다듬기</h2><p>예시 문단 3개로 한 번 실행합니다. Google 로그인이 필요하면 입력 없이 멈추고 원문을 유지합니다.</p><button disabled={busy} onClick={() => void run('ai.polish')}>AI 다듬기 실험</button></section>
    <section><h2>서비스 로그인</h2><p>네이버: {labels[state?.login.naver ?? 'unknown']} · 밴드: {labels[state?.login.band ?? 'unknown']}</p>
      <label>서비스<select value={channel} onChange={e => setChannel(e.target.value as 'naver' | 'band')}><option value="naver">네이버</option><option value="band">밴드</option></select></label>
      <div className="experiment-actions"><button disabled={busy} onClick={() => void run('login.open', { channel })}>로그인 화면 열기</button>
      <button disabled={busy} onClick={() => void run('login.check', { channel: 'naver' })}>네이버 상태 확인</button>
      <button disabled={busy} onClick={() => void run('login.check', { channel: 'band' })}>밴드 상태 확인</button></div></section>
    <section><h2>사용자가 로그인한 뒤에만 실행</h2><p>예시 글 16문단·3,000자 이상, 예시 PNG 5장. 문자 입력은 글자당 60ms로 진행합니다.</p>
      <div className="option-row"><span>작성 중인 글 복구 안내가 나오면 복구하지 않고 새로 시작하는 데 동의합니다.<small className="muted"> 저장된 임시글은 삭제하지 않습니다.</small></span>
        <button className="switch" role="switch" aria-label="자동복구 거절에 동의" aria-checked={declineAutoRecover} disabled={busy} onClick={() => setDeclineAutoRecover(!declineAutoRecover)}><span/></button></div>
      <button disabled={busy || state?.login.naver !== 'confirmed'} onClick={() => void run('blog.run', { declineAutoRecover })}>블로그 입력·임시저장·다시 읽기</button>
      <div className="experiment-actions"><button disabled={busy || state?.login.band !== 'confirmed'} onClick={() => void run('band.list')}>내 밴드 목록 읽기</button></div>
      <label>실험할 밴드<select value={bandKey} onChange={e => setBandKey(e.target.value)}><option value="">선택해 주세요</option>{state?.bands.map(b => <option key={b.key} value={b.key}>{b.name} · {b.key}</option>)}</select></label>
      <label>밴드 UA<select value={ua} onChange={e => setUa(e.target.value)}><option value="desktop">데스크톱</option><option value="mobile">모바일</option></select></label>
      <button disabled={busy || !bandKey || state?.login.band !== 'confirmed'} onClick={() => void run('band.run', { bandKey, ua })}>밴드 입력·게시 전 멈춤</button>
      <p className="small muted">사진은 파일 입력으로 첨부합니다. 붙여넣기·임시저장 UI·길이 한도는 실험 결과에 확인 여부를 남깁니다. 모호한 확인창은 사용자가 확인합니다.</p>
    </section><section><h2>단계별 기록</h2><p role="status" data-testid="experiment-result">{state?.running ? `${state.action} 진행 중` : state?.lastResult || '아직 실행하지 않았습니다.'}</p>
      <p className="small muted">앱 전용 files/wp0 · PC에서 pnpm device:pull · 실패 화면은 개인정보 영역을 가립니다.</p>
      <ol className="experiment-steps">{state?.steps.map((step, i) => <li key={i}><strong>{step.action}</strong><span>{step.result} · {step.elapsedMs}ms · {step.at.slice(11, 19)} UTC</span>{step.detail && <pre>{JSON.stringify(step.detail, null, 2)}</pre>}</li>)}</ol>
      <button disabled={!state?.running} onClick={() => void run('stop')}>실험 중단</button>
    </section></main></>;
}
