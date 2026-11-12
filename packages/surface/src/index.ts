export type SurfaceSession = 'naver' | 'band' | 'ai';

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

export interface Surface {
  readonly session: SurfaceSession;
  open(options: SurfaceOpenOptions): Promise<void>;
  readState(): Promise<SurfaceState>;
  waitForNavigation(options?: NavigationOptions): Promise<SurfaceState>;
  /** Read-only expression, including element geometry. Never use to edit the page. */
  evaluateReadOnly<T>(expression: string): Promise<T>;
  click(x: number, y: number): Promise<void>;
  typeText(text: string): Promise<void>;
  pressKey(input: KeyInput): Promise<void>;
  attachFiles(selector: string, absolutePaths: readonly string[]): Promise<void>;
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
