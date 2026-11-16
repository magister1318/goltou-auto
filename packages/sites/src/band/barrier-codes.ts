/** Fixed codes only: never put a URL, field value, body or exception text here. */
const codes = [
  'ARMED', 'DISARMED', 'ALLOWANCE_CONSUMED', 'CREATE_ALLOWED', 'BLOCK_CONFIRMED',
  'PREFLIGHT_ALLOWED', 'MEMBERSHIP_ALLOWED', 'UPLOAD_ALLOWED', 'READ_BATCH_ALLOWED',
  'ORIGIN_BLOCKED', 'METHOD_BLOCKED', 'ROUTE_BLOCKED', 'NOT_ARMED', 'ALREADY_SENT',
  'BODY_MISSING', 'BODY_NETWORK_ID_MISSING', 'BODY_FETCH_FAILED', 'BODY_LENGTH_MISMATCH',
  'BODY_INCOMPLETE', 'BODY_ENCODING', 'BODY_PARSE',
  'TARGET_MISSING', 'TARGET_DUPLICATE', 'TARGET_TYPE', 'TARGET_MISMATCH',
  'SURFACE_STATIC_BLOCK', 'SURFACE_INSPECTOR_ERROR', 'SURFACE_REQUEST_INVALID',
] as const;
export type BandBarrierCode = typeof codes[number];

export function bandPostBlocked(reason = ''): boolean {
  return reason.startsWith('BAND_POST_BLOCKED:') && codes.includes(reason.slice('BAND_POST_BLOCKED:'.length) as BandBarrierCode);
}
