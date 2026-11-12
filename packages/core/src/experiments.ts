import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Surface, SurfaceHost, SurfaceSession, SurfaceState } from '@goltou/surface';
import { bandSnapshot, closeComposer, domSummary, exampleArticle, fillBand, fillBlog, listBands, loginState, loginUrls, probeUrls, saveAndReopen, saveBandDraftAndVerify, sleep } from '@goltou/sites';
import type { LoginState } from '@goltou/sites';

export const desktopUA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const mobileUA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
type Channel = 'naver' | 'band';
type RecordValue = Record<string, unknown>;
interface Step { at: string; action: string; result: string; elapsedMs: number; detail?: RecordValue }
export interface ExperimentState {
  running: boolean; action: string; lastResult: string; steps: Step[];
  login: Record<Channel, LoginState>; bands: { key: string; name: string }[];
  info: RecordValue | null;
}
export interface ExperimentOptions {
  host: SurfaceHost; directory: string; photoPaths: readonly string[];
  info(): Promise<RecordValue>;
  lifecycle(mode: string): Promise<void>;
  capture(surface: Surface, name: string): Promise<RecordValue>;
}

/** Debug-only, single-flight tools. Never connected to the product API or registration runner. */
export class Experiments {
  private readonly surfaces = new Map<SurfaceSession, Surface>();
  private cancelled = false;
  private operation: Promise<void> | null = null;
  private runId = '';
  private readonly state: ExperimentState = { running: false, action: '', lastResult: '', steps: [], login: { naver: 'unknown', band: 'unknown' }, bands: [], info: null };
  constructor(private readonly options: ExperimentOptions) {}
  get busy() { return this.state.running; }
  snapshot(): ExperimentState { return structuredClone(this.state); }
  async handle(command: string, input: RecordValue = {}): Promise<ExperimentState> {
    if (command === 'state') return this.snapshot();
    if (command === 'stop') { this.cancelled = true; return this.snapshot(); }
    if (this.state.running) throw new Error('EXPERIMENT_BUSY');
    if (!['info', 'example', 'evidence', 'show', 'hide', 'login.open', 'login.check', 'band.list', 'blog.run', 'band.run', 'lifecycle'].includes(command)) throw new Error('UNKNOWN_EXPERIMENT');
    const channel: Channel = input.channel === 'band' ? 'band' : 'naver';
    if (command.startsWith('login.') && !['band', 'naver'].includes(String(input.channel))) throw new Error('INVALID_CHANNEL');
    if (command === 'band.run' && (!/^\d{1,30}$/.test(String(input.bandKey)) || !['mobile', 'desktop'].includes(String(input.ua)))) throw new Error('SELECT_BAND_AND_UA');
    if (command === 'lifecycle' && !['recreate', 'rotate', 'background'].includes(String(input.mode))) throw new Error('INVALID_LIFECYCLE');
    this.runId = randomUUID(); this.cancelled = false;
    this.state.running = true; this.state.action = command; this.state.steps = []; this.state.lastResult = '실험 중';
    this.operation = this.run(command, channel, input).catch(() => { this.state.lastResult = '기록 저장 실패'; }).finally(() => { this.state.running = false; });
    return this.snapshot();
  }
  private check = () => { if (this.cancelled) throw new Error('EXPERIMENT_STOPPED'); };
  private async persist() {
    await mkdir(this.options.directory, { recursive: true });
    // No UI inputs, account identifiers, URLs, band names/keys, raw exceptions, DOM text or cookies.
    await writeFile(path.join(this.options.directory, `${this.runId}.json`), JSON.stringify({ version: 1, runId: this.runId, action: this.state.action, result: this.state.lastResult, steps: this.state.steps }, null, 2), { mode: 0o600 });
  }
  private async step<T>(action: string, execute: () => Promise<T>, detail: (result: T) => RecordValue = () => ({})): Promise<T> {
    this.check(); const start = Date.now();
    const record: Step = { at: new Date().toISOString(), action, result: 'running', elapsedMs: 0 };
    this.state.steps.push(record); await this.persist();
    try {
      const result = await execute(); record.result = 'ok'; record.detail = detail(result); return result;
    } catch (error) {
      record.result = 'failed';
      // Only our fixed upper-case error codes may be recorded. CDP errors can contain URLs/secrets.
      const message = error instanceof Error ? error.message : '';
      record.detail = { code: /^[A-Z_]{3,80}$/.test(message) ? message : 'EXPERIMENT_FAILED' };
      throw error;
    } finally { record.elapsedMs = Date.now() - start; await this.persist(); }
  }
  private async get(session: SurfaceSession, fresh = false): Promise<Surface> {
    const previous = this.surfaces.get(session);
    if (previous && !fresh) return previous;
    if (previous) { await this.options.host.destroy(previous); this.surfaces.delete(session); }
    const surface = await this.options.host.create(session); this.surfaces.set(session, surface); return surface;
  }
  private async open(surface: Surface, url: string, ua = desktopUA) {
    this.check(); await surface.open({ session: surface.session, url, width: 1280, height: 900, userAgent: ua });
  }
  private async probe(channel: Channel) {
    const surface = await this.get(channel, true);
    await this.open(surface, probeUrls[channel]);
    this.state.login[channel] = await loginState(surface); return this.state.login[channel];
  }
  private async captureFailure(surface: Surface) {
    const start = Date.now();
    const structure = await domSummary(surface).catch(() => ({ unavailable: true }));
    const screenshot = await this.options.capture(surface, `${this.runId}-failure`).catch(() => ({ unavailable: true }));
    this.state.steps.push({ at: new Date(start).toISOString(), action: 'failure-evidence', result: 'captured', elapsedMs: Date.now() - start, detail: { structure, screenshot } });
  }
  private async run(command: string, channel: Channel, input: RecordValue) {
    let active: Surface | undefined;
    try {
      if (command === 'info') this.state.info = await this.step('runtime-and-profiles', this.options.info, value => value);
      if (command === 'example') {
        active = await this.get('ai', true);
        await this.step('open-example', () => this.open(active!, 'https://example.com/'));
        await this.step('read-example-title', () => active!.readState(), result => ({ titleMatches: result.title === 'Example Domain', node: process.version, uptimeMs: Math.round(process.uptime() * 1000) }));
        this.check();
      }
      if (command === 'show' || command === 'hide') {
        active = await this.get('ai');
        await this.step(command, () => command === 'show' ? active!.show() : active!.hide());
      }
      if (command === 'evidence') {
        active = await this.get('ai', true);
        await this.step('open-evidence-example', () => this.open(active!, 'https://example.com/'));
        await this.step('capture-and-dom-check', async () => ({ structure: await domSummary(active!), screenshot: await this.options.capture(active!, `${this.runId}-failure`) }), v => v);
      }
      if (command === 'login.open') {
        active = await this.get(channel, true);
        await this.step('open-login', () => this.open(active!, loginUrls[channel], mobileUA));
        await this.step('show-login', () => active!.show());
      }
      if (command === 'login.check') await this.step(`check-${channel}`, () => this.probe(channel), state => ({ state }));
      if (command === 'band.list') {
        if (await this.step('check-band', () => this.probe('band'), state => ({ state })) !== 'confirmed') throw new Error('LOGIN_REQUIRED');
        active = await this.get('band');
        this.state.bands = await this.step('read-band-list', () => listBands(active!), rows => ({ count: rows.length }));
      }
      if (command === 'blog.run') {
        if (await this.step('check-naver', () => this.probe('naver'), state => ({ state })) !== 'confirmed') throw new Error('LOGIN_REQUIRED');
        active = await this.get('naver', true);
        const article = exampleArticle(this.runId.slice(0, 8));
        await this.step('open-blog-desktop-1280x900', () => this.open(active!, probeUrls.naver));
        await this.step('type-blog-and-five-photos', () => fillBlog(active!, article, this.options.photoPaths, this.check), v => ({ chars: v.body.length, paragraphs: v.paragraphs, images: v.images }));
        await this.step('save-and-reopen-blog-draft', () => saveAndReopen(active!, article, 5, this.check, async () => {
          active = await this.get('naver', true); await this.open(active, probeUrls.naver); return active;
        }), v => v);
      }
      if (command === 'band.run') {
        if (!this.state.bands.some(b => b.key === input.bandKey)) throw new Error('BAND_NOT_SELECTED_FROM_LIST');
        if (await this.step('check-band', () => this.probe('band'), state => ({ state })) !== 'confirmed') throw new Error('LOGIN_REQUIRED');
        active = await this.get('band', true);
        // Keep the synthetic text identical across the mobile/desktop comparison.
        const article = exampleArticle('stage3');
        const ua = input.ua === 'mobile' ? mobileUA : desktopUA;
        await this.step(`open-band-${String(input.ua)}`, () => this.open(active!, `https://band.us/band/${String(input.bandKey)}/post`, ua));
        const result = await this.step('type-band-and-five-photos', () => fillBand(active!, article, this.options.photoPaths, this.check), v => v);
        // Evidence is captured before any post action. No posting primitive is available here.
        await this.step('capture-before-post', () => this.options.capture(active!, `${this.runId}-before-post`), v => v);
        if (result.draftControl) {
          await this.step('save-and-reopen-band-draft', () => saveBandDraftAndVerify(active!, article, this.check), v => v);
        } else {
          await this.step('close-without-post', () => closeComposer(active!));
          await this.step('confirm-composer-closed', async () => {
            const value = await bandSnapshot(active!, '');
            if (value.bodyChars !== 0) throw new Error('BAND_COMPOSER_STILL_OPEN');
            return { closed: true, draftControlObserved: false, limit: result.maxLength, observedAcceptedChars: result.bodyChars };
          }, value => value);
        }
      }
      if (command === 'lifecycle') {
        active = await this.get('ai');
        const observe = async (): Promise<SurfaceState & RecordValue> => ({ ...await active!.readState(), ...await this.options.info() });
        const before = await this.step('before-lifecycle', observe, v => ({ activityCreations: v.activityCreations, pauses: v.pauses, resumes: v.resumes }));
        await this.step(`activity-${String(input.mode)}`, () => this.options.lifecycle(String(input.mode)));
        if (input.mode === 'background') {
          const deadline = Date.now() + 30000;
          let returned = false;
          while (Date.now() < deadline) {
            await sleep(500);
            const info = await this.options.info();
            if (info.foreground === true && Number(info.pauses) > Number(before.pauses)) { returned = true; break; }
          }
          if (!returned) throw new Error('APP_RETURN_TIMEOUT');
        } else await sleep(1800);
        const after = await this.step('after-lifecycle', observe, v => ({ activityCreations: v.activityCreations, pauses: v.pauses, resumes: v.resumes, foreground: v.foreground, samePage: v.url === before.url && v.title === before.title }));
        if (after.url !== before.url || after.title !== before.title || after.foreground !== true) throw new Error('LIFECYCLE_STATE_LOST');
        if (input.mode === 'background' && !(Number(after.pauses) > Number(before.pauses))) throw new Error('BACKGROUND_NOT_OBSERVED');
        if (input.mode !== 'background' && !(Number(after.activityCreations) > Number(before.activityCreations))) throw new Error('RECREATION_NOT_OBSERVED');
        this.state.info = { ...after, url: undefined, title: undefined };
      }
      this.state.lastResult = '완료';
    } catch (error) {
      this.state.lastResult = error instanceof Error && /^[A-Z_]{3,80}$/.test(error.message) ? error.message : 'EXPERIMENT_FAILED';
      active ??= this.surfaces.get(channel);
      if (active) await this.captureFailure(active);
    } finally { await this.persist(); }
  }
  async close() { this.cancelled = true; await this.operation; for (const surface of this.surfaces.values()) await this.options.host.destroy(surface); this.surfaces.clear(); }
}
