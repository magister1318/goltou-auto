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
  return read(surface, `for (const {d,x,y} of docs) for (const e of d.querySelectorAll(${JSON.stringify(selector)})) {
    if (!visible(e) || e.disabled) continue;
    ${exactText === undefined ? '' : `if ((e.textContent||'').trim() !== ${JSON.stringify(exactText)}) continue;`}
    const r=e.getBoundingClientRect(), px=x+r.left+r.width/2, py=y+r.top+r.height/2;
    if (px>0 && py>0 && px<innerWidth && py<innerHeight) return {x:px,y:py};
  } return null;`);
}
export async function click(surface: Surface, control: ControlId, selector: string, text?: string, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await point(surface, selector, text);
    if (found) { await surface.click(found.x, found.y); await sleep(350); return; }
    await sleep(250);
  }
  throw new ControlNotFoundError(control);
}
export async function typeParagraphs(surface: Surface, paragraphs: readonly string[], check: () => void) {
  for (let i = 0; i < paragraphs.length; i++) {
    check(); await surface.typeText(paragraphs[i]!);
    if (i < paragraphs.length - 1) { await surface.pressKey({ key: 'Enter' }); await surface.pressKey({ key: 'Enter' }); }
  }
}
export async function waitFor<T>(readValue: () => Promise<T | null | false>, timeoutMs = 15000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { const v = await readValue(); if (v) return v; await sleep(250); }
  throw new Error('OBSERVATION_TIMEOUT');
}
export const compact = (text: string) => text.replace(/[\s\u200b-\u200d\ufeff]+/gu, '');

/** A structural summary contains counts only. Text, attributes and URLs never leave the page. */
export async function domSummary(surface: Surface) {
  return read<{ documents: number; editables: number; fileInputs: number; images: number; buttons: number }>(surface,
    `return {documents:docs.length,editables:docs.reduce((n,{d})=>n+d.querySelectorAll('[contenteditable="true"],textarea').length,0),
      fileInputs:docs.reduce((n,{d})=>n+d.querySelectorAll('input[type="file"]').length,0),
      images:docs.reduce((n,{d})=>n+d.images.length,0),buttons:docs.reduce((n,{d})=>n+d.querySelectorAll('button').length,0)};`);
}
