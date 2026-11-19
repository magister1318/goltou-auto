import type { UpdateSnapshot } from '@goltou/core/app-update';
import { updateFailureMessage } from '@goltou/core/app-update';
import { Sheet } from './Sheet';
import { request } from './store';

export const updateMB = (bytes: number) => (bytes / 1000000).toFixed(1);
function action(action: 'open' | 'later' | 'download' | 'cancel' | 'settings' | 'close') {
  void request('update.action', { action }).catch(() => {});
}
export function UpdateNotice({ value }: { value?: UpdateSnapshot | undefined }) {
  return value?.notice && value.release ? <div className="update-notice">
    <span>새 버전 {value.release.version}가 있습니다</span>
    <button className="green" onClick={() => action('open')}>업데이트</button>
  </div> : null;
}
export function UpdateSettings({ value, current, disabled }: { value?: UpdateSnapshot | undefined; current: string; disabled: boolean }) {
  const checking = value?.phase === 'checking';
  return <>
    <h3>앱</h3>
    <div className="choice-row">
      <span>앱 버전 {value?.current || current}<small role={checking ? 'status' : undefined}>
        {checking ? '확인 중입니다' : value?.release ? `새 버전 ${value.release.version} 있음` : '최신입니다'}
      </small></span>
      <button className="green" disabled={disabled || checking || value?.phase === 'downloading'} onClick={() => {
        if (value?.release) action('open');
        else void request('update.check', {}).catch(() => {});
      }}>{checking ? '확인 중' : value?.release ? '업데이트' : '업데이트 확인'}</button>
    </div>
  </>;
}
export function UpdateSheet({ value }: { value?: UpdateSnapshot | undefined }) {
  if (!value?.sheet) return null;
  if (value.phase === 'error') return <Sheet title="업데이트 확인" close={() => action('close')}>
    <p role="alert">{updateFailureMessage}</p><div className="acts"><button className="btn primary" onClick={() => action('close')}>확인</button></div>
  </Sheet>;
  if (value.phase === 'permission') return <Sheet title="설치 허용이 한 번 필요합니다" close={() => action('later')}>
    <p>안드로이드는 플레이스토어 밖에서 받은 앱을 설치하려면 허용을 한 번 켜야 합니다. 설정에서 "이 출처 허용"을 켜고 돌아오면 바로 이어서 설치합니다.</p>
    <div className="acts"><button className="btn quiet" onClick={() => action('later')}>나중에</button><button className="btn primary" onClick={() => action('settings')}>설정 열기</button></div>
  </Sheet>;
  if (!value.release) return null;
  const downloading = value.phase === 'downloading';
  return <Sheet title={`새 버전 ${value.release.version}`} close={() => action('later')} dismissible={!downloading}>
    {downloading ? <div className="update-progress" aria-live="polite">
      <progress max={100} value={value.percent} aria-label="업데이트 다운로드" />
      <p>받는 중 {updateMB(value.bytes)}MB <span>{value.percent}%</span></p>
    </div> : <dl className="update-details">
      <div><dt>지금</dt><dd>{value.current}</dd></div>
      <div><dt>올린 날</dt><dd>{value.release.date}</dd></div>
      <div><dt>크기</dt><dd>{updateMB(value.release.size)}MB</dd></div>
    </dl>}
    <p>다 받으면 안드로이드 설치 화면이 뜹니다. 거기서 업데이트를 누르면 끝납니다. 로그인은 그대로 남습니다.</p>
    <div className="acts">{downloading ? <button className="btn quiet" onClick={() => action('cancel')}>취소</button> : <>
      <button className="btn quiet" onClick={() => action('later')}>나중에</button><button className="btn primary" onClick={() => action('download')}>업데이트</button>
    </>}</div>
  </Sheet>;
}
