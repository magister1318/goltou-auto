export type SurfaceSession = 'naver' | 'band' | 'ai';

export { inputCharacters } from './input-characters';

export interface SurfaceOpenOptions {
  url: string;
  width: number;
  height: number;
  userAgent: string;
  session: SurfaceSession;
}

export interface SurfaceState { url: string; title: string; loading: boolean }
export interface NavigationOptions { timeoutMs?: number; url?: string }
export interface KeyInput {
  key: string;
  /** CDP bit mask: Alt=1, Control=2, Meta=4, Shift=8. */
  modifiers?: number;
}
export interface SurfaceDialog { id: string; kind: 'alert' | 'confirm'; message: string; url?: string }
export interface RequestRule { hostname: string; pathname: string }
/** Ephemeral transport data. Callers must never persist bodies or headers. */
export interface GuardedRequest {
  url: string; method: string; postData?: string;
  contentType?: string; hasPostData?: boolean; postDataInline?: boolean;
  postDataFetched?: boolean; postDataComplete?: boolean;
}
export interface GuardedResponse { status: number; body: string }

export interface Surface {
  readonly session: SurfaceSession;
  open(options: SurfaceOpenOptions): Promise<void>;
  readState(): Promise<SurfaceState>;
  waitForNavigation(options?: NavigationOptions): Promise<SurfaceState>;
  /** Read-only expression, including element geometry. Never use to edit the page. */
  evaluateReadOnly<T>(expression: string): Promise<T>;
  /** Read the actual hit-tested element, including occluding elements and frames. */
  readClickTarget?(x: number, y: number, selector: string): Promise<boolean>;
  /** Re-read a safety condition immediately before mousePressed, after hover/delay. */
  click(x: number, y: number, beforePress?: () => Promise<void>): Promise<void>;
  typeText(text: string): Promise<void>;
  pressKey(input: KeyInput): Promise<void>;
  attachFiles(selector: string, absolutePaths: readonly string[]): Promise<void>;
  /** Shell-enforced request barrier, installed before navigation; persists until close. */
  blockRequests?(rules: readonly { hostname: string; pathname: string }[]): Promise<void>;
  guardRequests?(rules: readonly RequestRule[], inspect: (request: GuardedRequest) => boolean | Promise<boolean>,
    response: (response: GuardedResponse) => void): Promise<void>;
  readDialog?(): Promise<SurfaceDialog | null>;
  respondDialog?(id: string, accept: boolean): Promise<void>;
  show(): Promise<void>;
  hide(): Promise<void>;
  close(): Promise<void>;
}

export interface SurfaceHost {
  create(session: SurfaceSession): Promise<Surface>;
  destroy(surface: Surface): Promise<void>;
  /** Destroy open surfaces in this session, then erase all of its stored site data. */
  clearSession(session: SurfaceSession): Promise<void>;
}
