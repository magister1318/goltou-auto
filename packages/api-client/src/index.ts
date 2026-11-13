export type ErrorCode = 'auth' | 'forbidden' | 'invalid' | 'not_found' | 'conflict' | 'server';
export class ApiError extends Error {
  constructor(public readonly code: ErrorCode, message: string) { super(message); this.name = 'ApiError'; }
}
export interface User { userNo: number; name: string; userType: number; role: 'manager' | 'staff' | 'admin' }
export interface Settings { closingText: string; defaultHashtags: string[]; bandDailyLimit: number }
export interface LoginInput { loginId: string; password: string; device: { kind: string; model: string; appVersion: string } }
export type Channel = 'blog' | 'band';
export type Mode = 'draft' | 'publish';
export type PostStatus = 'running' | 'draft_saved' | 'published' | 'failed' | 'stopped' | 'stopped_before_post';
export interface PostMark { status: PostStatus; at: string }
export interface ProductSummary {
  productNo: number; title: string; country: string; region: string; thumbUrl: string;
  priceFrom: number; departureCount: number; updatedAt: string; myPosts: Record<Channel, PostMark | null>;
}
export interface Product {
  productNo: number; title: string; country: string; region: string; contentsHtml: string;
  images: { order: number; url: string }[]; departures: { date: string; price: number }[];
  golfCourses: string[]; productUrl: string; updatedAt: string; contentHash: string;
}
export interface ProductQuery {
  q?: string; country?: string; region?: string; month?: string; sort?: 'recent' | 'departure';
  onlyUnposted?: boolean; page?: number; pageSize?: number;
}
export interface Page<T> { total: number; items: T[] }
export interface PostInput {
  productNo: number; channel: Channel; mode: Mode; target: { name: string; key: string };
  options: { polish: boolean; closing: boolean; linkCard: boolean }; contentHash: string;
}
export interface PostUpdate { postNo: number; status: PostStatus; step: number; failReason: string; postUrl: string }
export interface Post extends PostUpdate {
  productNo: number; productTitle: string; channel: Channel; mode: Mode; targetName: string;
  userName: string; startedAt: string; finishedAt: string; productChanged: boolean;
}
export interface PostQuery { scope: 'mine' | 'all'; page?: number; pageSize?: number }
export interface ApiRoutes {
  '/auto/login': { input: LoginInput; output: { token: string; user: User } };
  '/auto/logout': { input: Record<string, never>; output: Record<string, never> };
  '/auto/me': { input: Record<string, never>; output: { user: User; settings: Settings } };
  '/auto/products/list': { input: ProductQuery; output: Page<ProductSummary> };
  '/auto/products/get': { input: { productNo: number }; output: Product };
  '/auto/posts/start': { input: PostInput; output: { postNo: number } };
  '/auto/posts/update': { input: PostUpdate; output: Record<string, never> };
  '/auto/posts/list': { input: PostQuery; output: Page<Post> };
  '/auto/settings/save': { input: Settings; output: Record<string, never> };
}
export interface ApiClient {
  request<P extends keyof ApiRoutes>(path: P, input: ApiRoutes[P]['input'], token?: string): Promise<ApiRoutes[P]['output']>;
}
export type FetchLike = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string; signal: AbortSignal; redirect: 'error'; credentials: 'omit' }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
const codes: ErrorCode[] = ['auth', 'forbidden', 'invalid', 'not_found', 'conflict', 'server'];
/** No default endpoint or credential storage: the caller supplies both fetch and token. */
export function createApiClient(baseUrl: string, fetcher: FetchLike, timeoutMs = 15000): ApiClient {
  return { async request(path, input, token) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let body = JSON.stringify(input);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (path !== '/auto/login') {
        if (!token) throw new ApiError('auth', '다시 로그인해 주세요.');
        headers.Authorization = `Bearer ${token}`;
      }
      const result = async () => {
        const response = await fetcher(`${baseUrl.replace(/\/$/, '')}${path}`, { method: 'POST', headers, body, signal: controller.signal, redirect: 'error', credentials: 'omit' });
        body = '';
        return { response, envelope: await response.json() as { ok?: unknown; data?: unknown; code?: unknown; message?: unknown } | null };
      };
      const { response, envelope } = await Promise.race([result(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new ApiError('server', '요청 시간이 초과됐습니다. 연결을 확인하고 다시 눌러 주세요.')); }, timeoutMs);
      })]);
      if (envelope?.ok === false && codes.includes(envelope.code as ErrorCode) && typeof envelope.message === 'string')
        throw new ApiError(envelope.code as ErrorCode, envelope.message);
      if (!response.ok || envelope?.ok !== true || !Object.hasOwn(envelope, 'data')) throw new ApiError('server', '응답을 읽지 못했습니다.');
      return envelope.data as ApiRoutes[typeof path]['output'];
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError('server', '연결하지 못했습니다. 잠시 뒤 다시 해 주세요.');
    } finally { clearTimeout(timer); body = ''; }
  } };
}
export { createFakeApi, fakeAccounts } from './fake';
