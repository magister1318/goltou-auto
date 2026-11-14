/** Debug entry only. No scalar content, identifiers, URLs or response fragments. */
import type { GuardedResponse } from '../../../packages/surface/src';
import { jsonNode, type RequestNode } from '../../../packages/sites/src/naver-blog/request-fields';
export function publishResponseShape(response: GuardedResponse) {
  let remaining = 512;
  // Unknown dictionary keys can themselves be account/content identifiers.
  // This vocabulary controls disclosure only; it does not parse post identity.
  const names = new Set(['isSuccess', 'success', 'result', 'response', 'status', 'code', 'error', 'errorCode', 'message', 'data', 'body', 'value', 'content', 'title', 'text', 'token', 'cookie', 'id', 'postId', 'blogId', 'logNo', 'postUrl', 'url', 'items', 'list', 'redirectUrl', 'redirectURL']);
  const shape = (node: RequestNode, depth: number): object => {
    const value = node.value;
    const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    const length = typeof value === 'string' ? value.length : node.entries?.length ?? String(value).length;
    if (--remaining < 0 || depth > 8) return { type, length, truncated: true };
    return { type, length, ...(node.entries ? { fields: node.entries.slice(0, 128).map(([key, child]) => ({
      name: names.has(key) ? key : `[key-length:${key.length}]`,
      ...shape(child, depth + 1),
    })), truncated: node.entries.length > 128 } : {}) };
  };
  let body: object = { type: 'unparsed', length: response.body.length };
  if (response.body.length <= 1024 * 1024) { try { body = shape(jsonNode(response.body), 0); } catch { /* Unknown shape stays unknown. */ } }
  return { status: response.status, length: response.body.length, body };
}
