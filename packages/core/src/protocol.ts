import type { Channel, LoginInput, Mode, Page, Post, PostInput, Product, ProductQuery, ProductSummary, Settings, User } from '@goltou/api-client';
export type Service = 'naver' | 'band' | 'ai';
export type LoginState = 'confirmed' | 'expired' | 'unknown';
export type BlogVisibility = import('@goltou/sites').BlogVisibility;
export type JobStatus = 'running' | 'login_paused' | 'user_paused' | 'recovery_paused' | 'dialog_paused' | 'channel_paused' | 'record_failed' | 'failed' | 'draft_saved' | 'published' | 'stopped_before_post' | 'stopped';
export interface TargetResult { channel: Channel; key: string; name: string; status: import('@goltou/api-client').PostStatus; postUrl?: string; reason?: string }
export const steps = ['로그인 확인', '사진 내려받기', '본문 정리', '블로그에 쓰기', '블로그 임시저장과 확인', '밴드에 쓰기', '결과 기록'] as const;
export interface JobInput {
  productNo: number; mode: Mode; targets: { channel: Channel; name: string; key: string }[];
  options: PostInput['options']; publishConfirmed?: boolean; previewHash?: string;
  blogVisibility?: import('@goltou/sites').BlogVisibility;
}
export interface Job {
  id: number; productNo: number; title: string; mode: Mode; status: JobStatus;
  step: number; current: number; total: number; completedSteps: number[];
  targets: JobInput['targets']; service: Service | null; message: string;
  characters?: number; totalCharacters?: number; secondsLeft?: number; postUrl?: string;
  photoUploadMilliseconds?: number; photoUploadSamples?: number;
  blogVisibility?: import('@goltou/sites').BlogVisibility;
  testPostDeleted?: boolean;
  publishProbe?: boolean;
  blogReadbackTimings?: { photos: number; milliseconds: number; navigationKeys: number }[];
  blogIdentitySources?: ('response' | 'result-url' | 'title')[];
  tableModes?: ('native' | 'text-list')[]; linkCard?: 'off' | 'card' | 'url-text';
  dialog?: import('@goltou/surface').SurfaceDialog; evidence?: string;
  failureCode?: string;
  recordFailure?: { status: JobStatus; message: string };
  targetResults?: TargetResult[]; activeTargetKey?: string;
  bandPhotoLimit?: number | null; bandLimitObservedAt?: string | undefined;
  bandPhotoVerification?: { order: 'matched'; ratio: 'matched' | 'unavailable'; counts: number[]; sources: { width: number; height: number }[]; thumbnails: { width: number; height: number }[] };
}
export interface Simulation { tickMs: number; loginAt: number | null; failAt: number | null }
export interface AppSnapshot { postDeletion?: { postNo: number; verifiedGone: boolean; recorded: boolean; at?: string }; user: User | null; settings: Settings | null; services: Record<Service, LoginState>; visibleService: Service | null; job: Job | null; simulation: Simulation; realBlog?: boolean; realBand?: boolean }
/** Platform-neutral contract; Android implements it with a Keystore-encrypted native channel. */
export interface TokenStore { read(): Promise<string | null>; write(token: string | null): Promise<void> }
export interface Commands {
  'polish.setting.get': { input: Record<string, never>; output: import('@goltou/api-client').PolishStrength };
  'polish.setting.save': { input: { strength: import('@goltou/api-client').PolishStrength }; output: import('@goltou/api-client').PolishStrength };
  'session.get': { input: Record<string, never>; output: AppSnapshot };
  'login': { input: LoginInput; output: AppSnapshot };
  'logout': { input: Record<string, never>; output: AppSnapshot };
  'products.list': { input: ProductQuery; output: Page<ProductSummary> };
  'products.get': { input: { productNo: number }; output: Product };
  'preview.prepare': { input: { productNo: number; options: PostInput['options']; retryPolish?: boolean }; output: import('./preparation').PreparedPreview };
  'preview.revert': { input: { productNo: number; paragraphId: string }; output: import('./preparation').PreparedPreview };
  'posts.delete.prepare': { input: { postNo: number }; output: { confirmation: string; productTitle: string } };
  'posts.delete.confirm': { input: { confirmation: string }; output: AppSnapshot };
  'posts.delete.retryRecord': { input: Record<string, never>; output: AppSnapshot };
  'posts.list': { input: { scope: 'mine' | 'all'; page?: number; pageSize?: number }; output: Page<Post> };
  'settings.save': { input: Settings; output: AppSnapshot };
  'service.check': { input: { service: Service }; output: AppSnapshot };
  'service.show': { input: { service: Service }; output: AppSnapshot };
  'service.hide': { input: Record<string, never>; output: AppSnapshot };
  'service.clear': { input: { service: Service }; output: AppSnapshot };
  'job.start': { input: JobInput; output: AppSnapshot };
  'job.stop': { input: Record<string, never>; output: AppSnapshot };
  'job.resume': { input: Record<string, never>; output: AppSnapshot };
  'job.retryRecord': { input: Record<string, never>; output: AppSnapshot };
  'job.recovery': { input: { discard: boolean }; output: AppSnapshot };
  'job.dialog': { input: { id: string; accept: boolean }; output: AppSnapshot };
  'draft.show': { input: { title: string }; output: AppSnapshot };
  'bands.list': { input: Record<string, never>; output: import('@goltou/sites').BandChoice[] };
  'band.show': { input: { key: string }; output: AppSnapshot };
  'band.check': { input: Record<string, never>; output: AppSnapshot };
  'band.discard': { input: Record<string, never>; output: AppSnapshot };
  'job.continueBand': { input: Record<string, never>; output: AppSnapshot };
  'simulation.configure': { input: Partial<Simulation>; output: AppSnapshot };
}
export type AppRequest = { [K in keyof Commands]: { id: number; type: 'app'; command: K; input: Commands[K]['input'] } }[keyof Commands];
export type AppEvent = { type: 'snapshot'; snapshot: AppSnapshot } | { id: number; type: 'reply'; data: unknown } | { id: number; type: 'error'; code: string; message: string };
