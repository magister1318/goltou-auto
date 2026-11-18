import { ApiError, type ApiClient } from '@goltou/api-client';
import { trace } from '@goltou/surface/telemetry';

export async function uploadFailedPostLog(api: ApiClient, postNo: number, log: string, token: string) {
  const counts = { bytes: Buffer.byteLength(log) };
  for (let attempt = 1; attempt <= 2; attempt++) {
    trace('runner.log_upload', attempt === 1 ? 'start' : 'retry', { reason: attempt === 1 ? 'POST_LOG_UPLOAD' : 'POST_LOG_NETWORK', counts: { ...counts, attempt } });
    try {
      await api.request('/auto/posts/log', { postNo, log }, token);
      trace('runner.log_upload', 'ok', { reason: 'POST_LOG_UPLOAD', counts: { ...counts, attempt } });
      return;
    } catch (error) {
      if (error instanceof ApiError && error.code === 'not_found') {
        trace('runner.log_upload', 'skip', { reason: 'POST_LOG_ROUTE_MISSING' });
        return;
      }
      if (attempt === 1 && (error instanceof ApiError && error.network || error instanceof TypeError)) continue;
      trace('runner.log_upload', 'skip', { reason: 'POST_LOG_UPLOAD_FAILED', counts: { ...counts, attempt } });
      return;
    }
  }
}
