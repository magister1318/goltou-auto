import type { GuardedRequest } from '@goltou/surface';

/** Ephemeral parsing only. Preserve duplicate JSON and form keys; never log values. */
export interface RequestNode { value: unknown; entries?: [string, RequestNode][] }
export function jsonNode(raw: string): RequestNode {
  JSON.parse(raw); // Validate the complete input, including escapes and trailing bytes.
  let offset = 0;
  const whitespace = () => { while (/\s/.test(raw[offset] ?? '') && offset < raw.length) offset++; };
  const token = (): string => {
    const start = offset++;
    while (offset < raw.length) {
      if (raw[offset] === '\\') offset += 2;
      else if (raw[offset++] === '"') break;
    }
    return raw.slice(start, offset);
  };
  const parse = (depth: number): RequestNode => {
    if (depth > 32) throw new Error('REQUEST_TOO_DEEP');
    whitespace();
    const start = offset;
    if (raw[offset] === '{' || raw[offset] === '[') {
      const object = raw[offset++] === '{', end = object ? '}' : ']';
      const entries: [string, RequestNode][] = [];
      whitespace();
      while (raw[offset] !== end) {
        const key = object ? JSON.parse(token()) as string : String(entries.length);
        if (object) { whitespace(); offset++; }
        entries.push([key, parse(depth + 1)]); whitespace();
        if (raw[offset] === ',') { offset++; whitespace(); } else break;
      }
      offset++;
      return { value: JSON.parse(raw.slice(start, offset)), entries };
    }
    if (raw[offset] === '"') return { value: JSON.parse(token()) };
    while (offset < raw.length && !/[\s,}\]]/.test(raw[offset]!)) offset++;
    return { value: JSON.parse(raw.slice(start, offset)) };
  };
  return parse(0);
}
export function requestFields(request: GuardedRequest): { encoding: string; fields: [string, RequestNode][] } {
  if (!request.postData || request.postDataComplete === false) throw new Error('REQUEST_BODY_UNAVAILABLE');
  const raw = request.postData, media = (request.contentType ?? '').split(';')[0]!.trim().toLowerCase();
  if (media === 'application/json' || !media && raw.trim().startsWith('{')) {
    const node = jsonNode(raw);
    if (!node.entries || Array.isArray(node.value)) throw new Error('REQUEST_OBJECT_REQUIRED');
    return { encoding: 'json', fields: node.entries };
  }
  if (media === 'multipart/form-data') {
    const boundary = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(request.contentType ?? '');
    if (!boundary) throw new Error('REQUEST_BOUNDARY_MISSING');
    const marker = `--${boundary[1] ?? boundary[2]}`;
    if (!raw.endsWith(`${marker}--\r\n`) && !raw.endsWith(`${marker}--`)) throw new Error('REQUEST_MULTIPART_INCOMPLETE');
    const fields: [string, RequestNode][] = [];
    for (const part of raw.split(marker).slice(1, -1)) {
      const split = part.indexOf('\r\n\r\n'), header = part.slice(0, split);
      const name = /content-disposition:[^\r\n]*;\s*name="([^"]+)"/i.exec(header)?.[1];
      if (split < 0 || !name || /filename\s*=/i.test(header)) throw new Error('REQUEST_MULTIPART_UNSUPPORTED');
      fields.push([name, { value: part.slice(split + 4, -2) }]);
    }
    return { encoding: 'multipart', fields };
  }
  if (media && media !== 'application/x-www-form-urlencoded') throw new Error('REQUEST_ENCODING_UNKNOWN');
  if (!raw.includes('=') || /%(?![a-f\d]{2})/i.test(raw)) throw new Error('REQUEST_FORM_INVALID');
  return { encoding: 'form', fields: Array.from(new URLSearchParams(raw), ([key, value]) => [key, { value }]) };
}
export interface RequestField { path: string[]; key: string; node: RequestNode; depth: number }
export function walkFields(fields: [string, RequestNode][], visit: (entry: RequestField) => void, maxDepth = 8) {
  const walk = (entries: [string, RequestNode][], path: string[], depth: number) => {
    if (depth > maxDepth) throw new Error('REQUEST_DEPTH_LIMIT');
    for (const [key, node] of entries) {
      const next = [...path, key]; visit({ path: next, key, node, depth });
      let nested = node.entries;
      if (!nested && typeof node.value === 'string' && /^[\s]*[\[{]/.test(node.value)) {
        try { nested = jsonNode(node.value).entries; } catch { /* Ordinary text is not a JSON-valued field. */ }
      }
      if (nested) walk(nested, next, depth + 1);
    }
  };
  walk(fields, [], 0);
}
