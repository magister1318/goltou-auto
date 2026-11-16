import type { GuardedRequest } from '@goltou/surface';
import { jsonNode, requestFields } from '../naver-blog/request-fields';

/** Exact observed envelope: two GETs for one post, with no write operation. */
export function bandReadBatchTarget(request: GuardedRequest): { band: string; post: string } | null {
  try {
    const endpoint = new URL(request.url);
    if (request.method !== 'POST' || !request.postDataComplete || endpoint.origin !== 'https://bapi-kr.band.us' || endpoint.pathname !== '/v2.0.0/batch') return null;
    const parsed = requestFields(request);
    if (parsed.encoding !== 'form' || parsed.fields.length !== 1 || parsed.fields[0]![0] !== 'payload' || typeof parsed.fields[0]![1].value !== 'string') return null;
    const items = jsonNode(parsed.fields[0]![1].value);
    if (!Array.isArray(items.value) || items.entries?.length !== 2) return null;
    const paths = new Set<string>();
    let target: { band: string; post: string } | undefined;
    for (const [, entry] of items.entries) {
      const item = entry.value as { method?: unknown; svc_id?: unknown; path?: unknown };
      if (!item || typeof item !== 'object' || entry.entries?.map(([key]) => key).sort().join(',') !== 'method,path,svc_id' ||
        item.method !== 'GET' || typeof item.svc_id !== 'string' || !/^[a-z0-9_-]{1,100}$/i.test(item.svc_id) ||
        typeof item.path !== 'string' || !item.path.startsWith('/') || item.path.startsWith('//')) return null;
      const u = new URL(item.path, 'https://api-kr.band.us');
      if (u.hash || !['/v2.0.0/get_post', '/v2.0.0/get_emotions'].includes(u.pathname) || paths.has(u.pathname)) return null;
      paths.add(u.pathname);
      const expected = u.pathname.endsWith('/get_post') ? ['band_no', 'post_no', 'resolution_type', 'token'] : ['band_no', 'content_key', 'post_no', 'token'];
      const keys = [...u.searchParams.keys()].sort();
      if (JSON.stringify(keys) !== JSON.stringify(expected)) return null;
      // Authentication values remain inside the site's normal request. Never read them.
      const band = u.searchParams.get('band_no')!, post = u.searchParams.get('post_no')!;
      if (!/^\d{1,30}$/.test(band) || !/^\d{1,30}$/.test(post) || target && (target.band !== band || target.post !== post)) return null;
      target = { band, post };
    }
    return target ?? null;
  } catch { return null; }
}
