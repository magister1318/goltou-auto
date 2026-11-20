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
export interface NavigationRoute { hostname: string; pathname: string; prefix?: boolean }
export interface NavigationPolicy {
  allowed: readonly NavigationRoute[];
  /** May load hidden for an authentication indicator; never displayed to the user. */
  landing: readonly NavigationRoute[];
  fallbackUrl: string;
}
export function matchesNavigation(url: string, routes: readonly NavigationRoute[]): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') &&
      routes.some(r => u.hostname === r.hostname && (r.prefix ? u.pathname.startsWith(r.pathname) : u.pathname === r.pathname));
  } catch { return false; }
}
export interface KeyInput {
  key: string;
  /** CDP bit mask: Alt=1, Control=2, Meta=4, Shift=8. */
  modifiers?: number;
}
export interface SurfaceDialog { id: string; kind: 'alert' | 'confirm'; message: string; url?: string }
export const clickHitTags = ['button', 'span', 'div', 'a', 'svg', 'path', 'iframe', 'body', 'html', 'section', 'p', 'label', 'input', 'img', 'textarea', '[other]'] as const;
export const clickHitRelations = ['ancestor', 'descendant', 'unrelated', 'same'] as const;
export interface ViewportRect { x: number; y: number; width: number; height: number }
export interface ClickHitElement {
  tag: string; classes: string[]; ariaLabel?: string | null;
  ancestorClasses?: string[];
  rect?: ViewportRect; relation?: typeof clickHitRelations[number];
}
export interface ClickTargetMiss { scrollX: number; scrollY: number; rejectedHit?: ClickHitElement }
export interface ClickTargetOptions {
  exactText?: string;
  /** Require the hit itself to match the selector. */
  direct?: boolean;
  onMiss?: { classes: readonly string[]; classPrefixes?: readonly string[]; ancestorClasses?: readonly string[]; ariaLabels: readonly string[]; report(miss: ClickTargetMiss): void };
}
export interface RequestRule { hostname: string; pathname: string; prefix?: boolean }
/** Ephemeral transport data. Callers must never persist bodies or headers. */
export interface GuardedRequest {
  url: string; method: string; postData?: string;
  contentType?: string; hasPostData?: boolean; postDataInline?: boolean;
  postDataFetched?: boolean; postDataComplete?: boolean;
  postDataFailure?: 'MISSING' | 'NETWORK_ID_MISSING' | 'FETCH_FAILED' | 'LENGTH_MISMATCH';
}
export interface GuardedResponse { status: number; body: string; url?: string; method?: string }
export type RequestBlockReason = 'STATIC_BLOCK' | 'INSPECTOR_DENIED' | 'INSPECTOR_ERROR' | 'REQUEST_INVALID';

export interface Surface {
  readonly session: SurfaceSession;
  open(options: SurfaceOpenOptions): Promise<void>;
  readState(): Promise<SurfaceState>;
  waitForNavigation(options?: NavigationOptions): Promise<SurfaceState>;
  /** Read-only expression, including element geometry. Never use to edit the page. */
  evaluateReadOnly<T>(expression: string): Promise<T>;
  /** Native foreground, window focus and screen-on signals. Read only. */
  readAppFocus?(): Promise<boolean>;
  /** Shell-enforced, before first navigation; applies to redirects, frames and new windows. */
  restrictNavigation?(policy: NavigationPolicy): Promise<void>;
  onUserHidden?(listener: () => void): () => void;
  /** Shell hid a landing or blocked main-frame navigation, including child windows. */
  onNavigationHidden?(listener: () => void): () => void;
  /** Test the click's viewport point, including occlusion and same-origin frames. */
  readClickTarget?(x: number, y: number, selector: string, options?: ClickTargetOptions): Promise<boolean>;
  /** Re-read a safety condition immediately before mousePressed, after hover/delay. */
  click(x: number, y: number, beforePress?: () => Promise<void>): Promise<void>;
  /** Send a native vertical wheel event at a viewport point, in CSS pixels. */
  wheel?(x: number, y: number, deltaY: number): Promise<void>;
  typeText(text: string): Promise<void>;
  /** One native text input event. Use only for an editor prefix or a single grapheme. */
  insertText?(text: string): Promise<void>;
  pressKey(input: KeyInput, beforePress?: () => Promise<void>): Promise<void>;
  attachFiles(selector: string, absolutePaths: readonly string[]): Promise<void>;
  /** Shell-enforced request barrier, installed before navigation; persists until close. */
  blockRequests?(rules: readonly { hostname: string; pathname: string; expected?: boolean }[]): Promise<void>;
  guardRequests?(rules: readonly RequestRule[], inspect: (request: GuardedRequest) => boolean | Promise<boolean>,
    response: (response: GuardedResponse) => void,
    observeResponse?: (request: Pick<GuardedRequest, 'url' | 'method'>) => boolean,
    /** Called only after Fetch acknowledges blocking. Request identity is ephemeral. */
    blocked?: (request: Pick<GuardedRequest, 'url' | 'method'> | undefined, reason: RequestBlockReason) => void): Promise<void>;
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
