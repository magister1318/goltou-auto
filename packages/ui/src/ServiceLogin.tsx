import type { LoginState } from '@goltou/core/protocol';

export const loginServices = ['naver', 'band'] as const;
export type LoginService = typeof loginServices[number];
export const serviceNames = { naver: '네이버', band: '밴드' };
export const loginLabels = { confirmed: '확인됨', expired: '풀림', unknown: '모름' };

export function LoginStatus({ state }: { state: LoginState }) {
  return <span className={`login-state ${state}`}><span className="state-symbol" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{state === 'confirmed' ? <path d="m4 8 3 3 5-6"/> : state === 'expired' ? <path d="M8 3v6m0 3h0"/> : <path d="M5.5 5a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4m0 3h0"/>}</svg></span>{loginLabels[state]}</span>;
}

export function LoginStrip({ services, open }: { services: Record<LoginService, LoginState>; open(service: LoginService): void }) {
  return <div className="login-strip" aria-label="서비스 로그인 상태">{loginServices.map(service => <button key={service} onClick={() => open(service)}><span>{service === 'naver' ? '블로그' : '밴드'}</span><LoginStatus state={services[service]}/><span aria-hidden="true">→</span></button>)}</div>;
}

export function ServiceLoginList({ services, busy, open, clear }: { services: Record<LoginService, LoginState>; busy: boolean; open(service: LoginService): void; clear(service: LoginService): void }) {
  return <section><h2>서비스 로그인</h2><p className="small muted">등록할 서비스의 로그인 상태를 확인해 주세요.</p>{loginServices.map(service => <div className="choice-row service-row" key={service}><button className="service-link" onClick={() => open(service)} disabled={busy}>{serviceNames[service]}<LoginStatus state={services[service]}/><span aria-hidden="true">→</span></button><button className="small muted" aria-label={`${serviceNames[service]} 로그인 지우기`} disabled={busy} onClick={() => clear(service)}>지우기</button></div>)}</section>;
}

export function ServiceGuide({ service, state }: { service: LoginService; state: LoginState }) {
  const name = serviceNames[service];
  return <section className="service-guide" aria-label={`${name} 로그인 안내`}>
    <div className="service-heading"><span className="service-monogram" aria-hidden="true"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="5" y="10" width="14" height="11"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></svg></span><LoginStatus state={state}/></div>
    <p className="service-explanation">{name === '네이버' ? '블로그에 글을 옮기려면 네이버 로그인이 필요하며' : '밴드에 글을 옮기려면 밴드 로그인이 필요하며'}, 비밀번호는 실제 {name} 페이지에만 직접 입력하고 앱은 저장하지 않습니다.</p>
    <ol className="login-instructions"><li><strong>{name} 화면 열기</strong><span>실제 서비스 페이지에서 진행합니다.</span></li><li><strong>직접 로그인하기</strong><span>아이디·비밀번호와 추가 인증을 입력해 주세요.</span></li><li><strong>골투오토로 돌아오기</strong><span>뒤로가기로 돌아와 로그인 상태를 확인해 주세요.</span></li></ol>
    <p className="small muted privacy-note">로그인 정보는 골투 서버로 보내지 않습니다.</p>
  </section>;
}
