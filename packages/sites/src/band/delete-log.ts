import type { GuardedRequest } from '@goltou/surface';

export type BandDeleteCode =
  | 'APP_PREPARED' | 'APP_CONFIRMED' | 'RECORD_SAVED' | 'RECORD_FAILED'
  | 'PRODUCT_READ_FAILED' | 'PRODUCT_VERIFIED' | 'REVIEW_OPEN' | 'REVIEW_CLOSED'
  | 'START' | 'FEED_OPEN' | 'FEED_READ' | 'IDENTITY_VERIFIED' | 'IDENTITY_REJECTED'
  | 'MENU_OPEN' | 'DELETE_SELECTED' | 'CONFIRM_VERIFIED' | 'ARMED' | 'DISARMED'
  | 'REQUEST_ALLOWED' | 'NOT_ARMED' | 'ALREADY_SENT' | 'METHOD_BLOCKED' | 'ORIGIN_BLOCKED'
  | 'ROUTE_BLOCKED' | 'QUERY_BLOCKED' | 'BODY_INCOMPLETE' | 'BODY_ENCODING' | 'BODY_PARSE'
  | 'TARGET_FIELDS' | 'TARGET_MISMATCH' | 'READ_BLOCKED' | 'SURFACE_BLOCKED'
  | 'RESPONSE_OK' | 'RESPONSE_REJECTED' | 'FEED_ABSENT' | 'URL_ABSENT' | 'ALREADY_ABSENT'
  | 'URL_OPEN' | 'URL_WRONG_ROUTE' | 'URL_POST_PRESENT' | 'URL_NO_DELETE_NOTICE' | 'URL_ALERT_OTHER' | 'URL_OPEN_FAILED'
  | 'READ_BATCH_ALLOWED' | 'READ_BATCH_BLOCKED' | 'PREFLIGHT_ALLOWED'
  | 'URL_RESULT'
  | 'URL_ALERT_READ' | 'URL_ALERT_ACKNOWLEDGED'
  | 'DELETED' | 'NOT_STARTED' | 'UNCERTAIN' | 'CONTROL_REJECTED' | 'CONFIRM_REJECTED'
  | 'READ_FAILED' | 'TIMEOUT' | 'UNEXPECTED_FAILURE';
export type BandDeleteLog = (event: { code: BandDeleteCode; shape?: ReturnType<typeof bandDeleteShape>; resultCodes?: number[]; checks?: { alert: boolean; missingMessage: boolean; samePost: boolean; feed: boolean; missingRead: boolean; length: number } }) => void;
/** Names and fixed routes only. Never retain query/body values or arbitrary URLs. */
export function bandDeleteShape(r: GuardedRequest) {
  const u = new URL(r.url);
  const safe = (s: string) => /^[a-z_][a-z0-9_]*$/i.test(s) ? s : '[field]';
  return {
    method: ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(r.method) ? r.method : '[method]',
    host: ['api.band.us', 'api-kr.band.us', 'bapi-kr.band.us'].includes(u.hostname) ? u.hostname : '[other]',
    path: ['/v1.5.0/delete_post', '/v2.0.0/batch'].includes(u.pathname) ? u.pathname : '[other]',
    contentType: (r.contentType ?? '').split(';')[0] === 'application/x-www-form-urlencoded' ? 'application/x-www-form-urlencoded' : '[other]',
    queryFieldNames: [...u.searchParams.keys()].map(safe),
    bodyFieldNames: (r.contentType ?? '').startsWith('application/x-www-form-urlencoded') && r.postDataComplete
      ? [...new URLSearchParams(r.postData).keys()].map(safe) : [],
    complete: r.postDataComplete === true,
  };
}
