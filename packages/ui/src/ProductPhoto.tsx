import { useEffect, useRef, useState } from 'react';
import { goltouPhotoUrl } from '@goltou/core/photo-url';

export function photoSource(value?: string): string | undefined {
  try { const url = new URL(value ?? ''); return goltouPhotoUrl(url) ? url.href : undefined; }
  catch { return undefined; }
}

export function PhotoPlaceholder({ preview = false }: { preview?: boolean }) {
  return <span className="photo-placeholder" role="img" aria-label={preview ? '이미지를 표시할 수 없습니다' : '이미지 없음'}>
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="3" y="4" width="18" height="16"/><circle cx="8" cy="9" r="1.5"/><path d="m3 17 5-5 4 4 3-3 6 6"/></svg>
    {preview && <span>이미지를 표시할 수 없습니다</span>}
  </span>;
}

function Photo({ src, preview }: { src: string | undefined; preview: boolean }) {
  const frame = useRef<HTMLSpanElement>(null);
  const [nearby, setNearby] = useState(!preview);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!preview || !src || !frame.current) return;
    // Native lazy loading can fetch several screens ahead. Keep long original-photo
    // runs to the viewport and a small margin, without changing the posting plan.
    if (typeof IntersectionObserver === 'undefined') { setNearby(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setNearby(true); observer.disconnect(); }
    }, { rootMargin: '240px' });
    observer.observe(frame.current);
    return () => observer.disconnect();
  }, [preview, src]);
  const unavailable = !src || failed;
  return <span ref={frame} className={`${preview ? 'preview-photo' : 'thumbnail'}${loaded && !failed ? ' photo-loaded' : ''}`}>
    {unavailable ? <PhotoPlaceholder preview={preview}/> : nearby ? <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onLoad={() => setLoaded(true)} onError={() => setFailed(true)}/> : <span className="photo-wait" aria-label="이미지 불러오기 대기"/>}
  </span>;
}

export function ProductPhoto({ url, preview = false }: { url?: string; preview?: boolean }) {
  const src = photoSource(url);
  // Reset load/error state when an API URL changes, even in the same list row.
  return <Photo key={`${preview}:${src ?? ''}`} src={src} preview={preview}/>;
}
