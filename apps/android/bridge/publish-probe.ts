/** Debug entry only. The output contains shapes, never editor/request content. */
import type { GuardedRequest } from '../../../packages/surface/src/index';
import type { VisibilityProof } from '../../../packages/sites/src/naver-blog/publish-safety';
import { requestFields, walkFields } from '../../../packages/sites/src/naver-blog/request-fields';

const visibilityKey = /open|visib|public|private|secret|scope/i;
const sensitiveKey = /(?:id|token|cookie|auth|password|title|body|text|tag|url)/i;
const safeName = (name: string) => /^[A-Za-z_$][A-Za-z0-9_$-]{0,79}$/.test(name) ? name : /^\d{1,5}$/.test(name) ? name : '[redacted-key]';
const length = (value: unknown) => typeof value === 'string' ? value.length : JSON.stringify(value)?.length ?? 0;
const type = (value: unknown) => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
const short = (value: unknown) => typeof value === 'boolean' || (typeof value === 'string' || typeof value === 'number') && String(value).length <= 8 && /^[A-Za-z0-9_-]*$/.test(String(value));
export function publishProbeShape(request: GuardedRequest, proof: VisibilityProof | undefined) {
  const candidates: { path: string[]; type: string; length: number; value?: string | number | boolean }[] = [];
  let fields: { name: string; length: number; json: boolean }[] = [], encoding = 'unknown', parsed = false;
  try {
    const result = requestFields(request); encoding = result.encoding;
    fields = result.fields.map(([name, node]) => {
      let json = !!node.entries;
      if (typeof node.value === 'string') { try { JSON.parse(node.value); json = true; } catch { /* Plain form value. */ } }
      return { name: safeName(name), length: length(node.value), json };
    });
    walkFields(result.fields, ({ path, key, node }) => {
      if (!visibilityKey.test(key)) return;
      candidates.push({ path: path.map(safeName), type: type(node.value), length: length(node.value),
        ...(!path.some(p => sensitiveKey.test(p)) && short(node.value) ? { value: node.value as string | number | boolean } : {}) });
    });
    parsed = true;
  } catch { /* Retain the available shape; never error strings or body fragments. */ }
  return {
    at: new Date().toISOString(), decision: 'blocked-unconditionally', selected: proof?.selected ?? null,
    radios: (proof?.radios ?? []).map(r => ({ mode: r.mode, tag: safeName(r.tag), type: safeName(r.type), name: safeName(r.name), id: safeName(r.id), value: short(r.value) ? r.value : '[redacted]', checked: r.checked })),
    request: { method: request.method === 'POST' ? 'POST' : 'other', contentType: (request.contentType ?? '').split(';')[0]!.trim().toLowerCase().replace(/[^a-z0-9/+.-]/g, ''),
      hasPostData: request.hasPostData === true, inline: request.postDataInline === true,
      fetched: request.postDataFetched === true, fetchMethod: request.postDataFetched ? 'Network.getRequestPostData' : null,
      complete: request.postDataComplete !== false, length: request.postData?.length ?? null, encoding, parsed, fields, candidates },
  };
}
