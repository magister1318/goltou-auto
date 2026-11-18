import { traceStep, trace, reasonCode, type TraceDetail } from '@goltou/surface/telemetry';
import type { Surface } from '@goltou/surface';
import { ControlNotFoundError, type ControlId } from './control-failure';

export const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
/** Same-origin frame readers only; inaccessible frames fail closed. No writes or input values. */
export function read<T>(surface: Surface, source: string): Promise<T> {
  return surface.evaluateReadOnly<T>(`(() => {
    const docs = []; const visit = (d, x, y) => { docs.push({d,x,y});
      for (const f of d.querySelectorAll('iframe')) { try { if (f.contentDocument) {
        const r = f.getBoundingClientRect(); visit(f.contentDocument, x+r.left, y+r.top);
      }} catch {} }
    }; visit(document,0,0);
    const visible = e => { const r=e.getBoundingClientRect(); const s=e.ownerDocument.defaultView.getComputedStyle(e);
      return r.width>0 && r.height>0 && s.display!=='none' && s.visibility!=='hidden'; };
    ${source}
  })()`);
}
export async function point(surface: Surface, selector: string, exactText?: string): Promise<{ x: number; y: number } | null> {
    return traceStep('sites.dom.point', async () => {
  return read(surface, `for (const {d,x,y} of docs) for (const e of d.querySelectorAll(${JSON.stringify(selector)})) {
    if (!visible(e) || e.disabled) continue;
    ${exactText === undefined ? '' : `if ((e.textContent||'').trimStart().trimEnd() !== ${JSON.stringify(exactText)}) continue;`}
    const r=e.getBoundingClientRect(), px=x+r.left+r.width/2, py=y+r.top+r.height/2;
    if (px>0 && py>0 && px<innerWidth && py<innerHeight) return {x:px,y:py};
  } return null;`);

    });
  }
export async function click(surface: Surface, control: ControlId, selector: string, text?: string, timeoutMs = 8000): Promise<void> {
  const found = await pollControl(() => point(surface, selector, text), timeoutMs, { surface, control },
    'sites.dom.click', () => new ControlNotFoundError(control));
  await surface.click(found.x, found.y);
  await sleep(350);
  }
export async function typeParagraphs(surface: Surface, paragraphs: readonly string[], check: () => void) {
    return traceStep('sites.dom.typeParagraphs', async () => {
  for (let i = 0; i < paragraphs.length; i++) {
    check(); await surface.typeText(paragraphs[i]!);
    if (i < paragraphs.length - 1) { await surface.pressKey({ key: 'Enter' }); await surface.pressKey({ key: 'Enter' }); }
  }

    });
  }
type ControlObservation = { surface: Surface; control: NonNullable<TraceDetail['selector']> };

export function waitFor<T>(readValue: () => Promise<T | null | false>, timeoutMs = 15000, observation?: ControlObservation): Promise<T> {
  return pollControl(readValue, timeoutMs, observation, 'sites.dom.waitFor', () => Error('OBSERVATION_TIMEOUT'));
}

async function pollControl<T>(readValue: () => Promise<T | null | false>, timeoutMs: number, observation: ControlObservation | undefined,
  step: 'sites.dom.waitFor' | 'sites.dom.click', timeout: () => Error): Promise<T> {
  const start = Date.now();
  const detail = { selector: observation?.control ?? 'other', counts: { timeoutMs } } as const;
  trace(step, 'start', detail);
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  try {
    while (Date.now() < deadline) {
      const value = await readValue();
      if (value) { trace(step, 'ok', { ...detail, counts: { timeoutMs, attempt: attempt + 1 } }, Date.now() - start); return value; }
      trace('poll', 'wait', { ...detail, counts: { timeoutMs, attempt: ++attempt } });
      await sleep(250);
    }
  } catch (error) {
    trace(step, 'fail', { ...detail, reason: reasonCode(error) }, Date.now() - start);
    throw error;
  }
  let summary: Awaited<ReturnType<typeof observationSummary>> | undefined;
  try {
    if (observation && !await observation.surface.readDialog?.()) summary = await observationSummary(observation.surface);
  } catch { /* A detached or dialog-blocked document has no summary. */ }
  const error = timeout();
  trace(step, 'fail', { ...detail, reason: reasonCode(error),
    ...(summary ? { navigation: { host: summary.host, path: summary.path } } : {}),
    counts: { timeoutMs, attempt, ...summary?.controls } }, Date.now() - start);
  throw error;
  }

const observationSummary = (surface: Surface) => read<{ host: string; path: string; controls: NonNullable<TraceDetail['counts']> }>(surface, `
  const count=selector=>docs.reduce((sum,{d})=>sum+d.querySelectorAll(selector).length,0);
  return {host:location.hostname,path:location.pathname,controls:{
    documents:docs.length,editables:count('textarea,[contenteditable="true"]'),fileInputs:count('input[type="file"]'),
    writeButtons:count('._btnPostWrite,._btnOpenWriteLayer'),dialogs:count('[role="dialog"],[role="alertdialog"],.lyWrap'),
    composers:count('.postWriteSection,.cke_editable,._postTextArea'),postBodies:count('.postTextView,.postText,p.txtBody,.se-main-container')
  }};`);
export const compact = (text: string) => text.replace(/[\s\u200b-\u200d\ufeff]+/gu, '');

/** A structural summary contains counts only. Text, attributes and URLs never leave the page. */
export async function domSummary(surface: Surface) {
    return traceStep('sites.dom.domSummary', async () => {
  return read<{ documents: number; editables: number; fileInputs: number; images: number; buttons: number }>(surface,
    `return {documents:docs.length,editables:docs.reduce((n,{d})=>n+d.querySelectorAll('[contenteditable="true"],textarea').length,0),
      fileInputs:docs.reduce((n,{d})=>n+d.querySelectorAll('input[type="file"]').length,0),
      images:docs.reduce((n,{d})=>n+d.images.length,0),buttons:docs.reduce((n,{d})=>n+d.querySelectorAll('button').length,0)};`);

    });
  }
