import type { Channel, LoginInput, Mode, Page, Post, PostInput, Product, ProductQuery, ProductSummary, Settings, User } from '@goltou/api-client';
export type Service = 'naver' | 'band' | 'ai';
export type LoginState = 'confirmed' | 'expired' | 'unknown';
export type JobStatus = 'running' | 'login_paused' | 'user_paused' | 'failed' | 'draft_saved' | 'published' | 'stopped_before_post';
export const steps = ['로그인 확인', '사진 내려받기', '본문 정리', '블로그에 쓰기', '블로그 임시저장과 확인', '밴드에 쓰기', '결과 기록'] as const;
export interface JobInput {
  productNo: number; mode: Mode; targets: { channel: Channel; name: string; key: string }[];
  options: PostInput['options']; publishConfirmed?: boolean; previewHash?: string;
}
export interface Job {
  id: number; productNo: number; title: string; mode: Mode; status: JobStatus;
  step: number; current: number; total: number; completedSteps: number[];
  targets: JobInput['targets']; service: Service | null; message: string;
}
export interface Simulation { tickMs: number; loginAt: number | null; failAt: number | null }
export interface AppSnapshot { user: User | null; settings: Settings | null; services: Record<Service, LoginState>; visibleService: Service | null; job: Job | null; simulation: Simulation }
/** This storage lives in core. A shell secure-storage channel can implement it later. */
export interface TokenStore { read(): Promise<string | null>; write(token: string | null): Promise<void> }
export interface Commands {
  'session.get': { input: Record<string, never>; output: AppSnapshot };
  'login': { input: LoginInput; output: AppSnapshot };
  'logout': { input: Record<string, never>; output: AppSnapshot };
  'products.list': { input: ProductQuery; output: Page<ProductSummary> };
  'products.get': { input: { productNo: number }; output: Product };
  'preview.prepare': { input: { productNo: number; options: PostInput['options'] }; output: import('./preparation').PreparedPreview };
  'preview.revert': { input: { productNo: number; paragraphId: string }; output: import('./preparation').PreparedPreview };
  'posts.list': { input: { scope: 'mine' | 'all'; page?: number; pageSize?: number }; output: Page<Post> };
  'settings.save': { input: Settings; output: AppSnapshot };
  'service.check': { input: { service: Service }; output: AppSnapshot };
  'service.show': { input: { service: Service }; output: AppSnapshot };
  'service.hide': { input: Record<string, never>; output: AppSnapshot };
  'service.clear': { input: { service: Service }; output: AppSnapshot };
  'job.start': { input: JobInput; output: AppSnapshot };
  'job.stop': { input: Record<string, never>; output: AppSnapshot };
  'job.resume': { input: Record<string, never>; output: AppSnapshot };
  'simulation.configure': { input: Partial<Simulation>; output: AppSnapshot };
}
export type AppRequest = { [K in keyof Commands]: { id: number; type: 'app'; command: K; input: Commands[K]['input'] } }[keyof Commands];
export type AppEvent = { type: 'snapshot'; snapshot: AppSnapshot } | { id: number; type: 'reply'; data: unknown } | { id: number; type: 'error'; code: string; message: string };
