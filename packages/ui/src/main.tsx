import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/noto-sans-kr/400.css';
import '@fontsource/noto-sans-kr/500.css';
import '@fontsource/noto-sans-kr/700.css';
import '@fontsource/noto-sans-kr/900.css';
import './style.css';

function App() {
  const [connected, setConnected] = useState(false);
  const [url, setUrl] = useState('https://example.com/');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ title: string; url: string }>();
  const [error, setError] = useState('');
  const socket = useRef<WebSocket | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    // HTTP-only launch cookie authenticates assets and the socket. Remove the bootstrap token from history.
    history.replaceState(null, '', location.pathname);
    const ws = new WebSocket(`${location.origin.replace('http:', 'ws:')}/ui-socket`);
    socket.current = ws;
    ws.onmessage = event => {
      const msg = JSON.parse(String(event.data)) as { type: string; id?: number; state?: { title: string; url: string }; message?: string };
      if (msg.type === 'ready') setConnected(true);
      if (msg.id !== requestId.current) return;
      if (msg.type === 'result') { setResult(msg.state); setBusy(false); }
      if (msg.type === 'error') { setError(msg.message ?? '진단에 실패했습니다.'); setBusy(false); }
    };
    ws.onclose = () => { setConnected(false); setBusy(false); setError('코어 연결이 끊겼습니다. 앱을 다시 열어 주세요.'); };
    ws.onerror = () => setError('코어에 연결하지 못했습니다.');
    return () => { ws.onclose = null; ws.close(); };
  }, []);

  return <>
    <header><p>브라우저 진단</p><h1>골투오토</h1></header>
    <main>
      <p className="connection" role="status">{connected ? '코어 연결됨' : '코어 연결 대기'}</p>
      <h2>숨김 브라우저 확인</h2>
      <p>주소를 열고 페이지 제목을 읽습니다.</p>
      <form onSubmit={event => {
        event.preventDefault();
        if (!connected || busy) return;
        setBusy(true); setError(''); setResult(undefined);
        socket.current?.send(JSON.stringify({ id: ++requestId.current, type: 'diagnose', url }));
      }}>
        <label htmlFor="address">예시 주소</label>
        <input id="address" type="url" required value={url} disabled={busy} onChange={event => setUrl(event.target.value)} />
        <button type="submit" disabled={!connected || busy}>{busy ? '제목 읽는 중…' : '진단 시작'}</button>
      </form>
      {result && <section aria-live="polite"><h2>읽은 제목</h2><p data-testid="diagnostic-title" className="result">{result.title || '(제목 없음)'}</p><p className="address">{result.url}</p></section>}
      {error && <p role="alert">진단 실패: {error}</p>}
    </main>
  </>;
}

createRoot(document.getElementById('root')!).render(<App />);
