// Reference: ../refs/golfliat/programs/golfliat-workbench/electron/renderer.js, fillBandComposerInWebview (composer/file selectors and readback only; DOM setters, synthetic paste and CKEditor mutations excluded).
import type { Surface } from '@goltou/surface';
import { click, compact, point, read, typeParagraphs, waitFor } from '../dom';
import type { exampleArticle } from '../fixture';

export async function listBands(surface: Surface) {
  return read<{ key: string; name: string }[]>(surface, `const seen=new Set(); return docs.flatMap(({d})=>Array.from(d.querySelectorAll('a[href]'))).flatMap(e=>{
    const m=(e.getAttribute('href')||'').match(/^(?:https:[/][/](?:www[.])?band[.]us)?[/]band[/]([0-9]+)[/]?(?:[?#].*)?$/);
    const name=(e.textContent||'').trim(); if (!m || !name || seen.has(m[1])) return []; seen.add(m[1]); return [{key:m[1],name:name.slice(0,100)}]; });`);
}
const editor = '[contenteditable="true"][role="textbox"], .cke_editable[contenteditable="true"], textarea[placeholder*="글"], [contenteditable="true"][data-placeholder]';
export async function bandSnapshot(surface: Surface, expected: string) {
  return read<{ bodyMatches: boolean; bodyChars: number; images: number; maxLength: number | null; fileInput: boolean; draftControl: boolean }>(surface, `
    const e=docs.flatMap(({d})=>Array.from(d.querySelectorAll(${JSON.stringify(editor)}))).find(visible);
    const body=e?.tagName==='TEXTAREA' ? e.value : (e?.textContent||'');
    const compact=s=>s.replace(/[\\s\\u200b-\\u200d\\ufeff]+/gu,'');
    const imageCount=docs.reduce((n,{d})=>{const attachments=Array.from(d.querySelectorAll('*')).filter(e=>e.tagName.toLowerCase()==='band:attachment').length;
      return n+(attachments||d.querySelectorAll('.cke_editable img, [class*="photoPreview"] img, [class*="attachedPhoto"] img, [contenteditable="true"] img').length);},0);
    return {bodyMatches:compact(body)===compact(${JSON.stringify(expected)}),bodyChars:compact(body).length,images:imageCount,
      maxLength:e?.hasAttribute('maxlength') ? Number(e.getAttribute('maxlength')) : null,
      fileInput:docs.some(({d})=>d.querySelector('input[type="file"]')),
      draftControl:docs.some(({d})=>Array.from(d.querySelectorAll('button,a')).some(e=>visible(e)&&/^(임시저장|임시 저장|Save draft)$/i.test((e.textContent||'').trim())))};`);
}
export async function fillBand(surface: Surface, article: ReturnType<typeof exampleArticle>, photos: readonly string[], check: () => void) {
  if (!/^https:\/\/(?:www\.)?band\.us\/band\/\d+\/post\/?(?:[?#].*)?$/.test((await surface.readState()).url)) throw new Error('NOT_BAND_COMPOSE_ROUTE');
  // Never type into an existing composition or a search/comment box.
  if (!await read<boolean>(surface, `return docs.some(({d})=>Array.from(d.querySelectorAll(${JSON.stringify(editor)})).some(visible));`)) {
    await click(surface, 'button._btnPostWrite, button[class*="buttonPostWrite"], button, a', '글쓰기');
  }
  const empty = await bandSnapshot(surface, '');
  if (!empty.bodyMatches || empty.images) throw new Error('COMPOSER_NOT_EMPTY');
  const candidates = await read<number>(surface, `return docs.flatMap(({d})=>Array.from(d.querySelectorAll(${JSON.stringify(editor)}))).filter(e=>visible(e)&&!/검색|search|댓글|comment|답글|reply|채팅/i.test([e.getAttribute('placeholder'),e.getAttribute('aria-label'),e.getAttribute('title')].join(' '))).length;`);
  if (candidates !== 1) throw new Error('BAND_EDITOR_AMBIGUOUS');
  const text = [article.title, ...article.paragraphs].join('\n\n');
  if (empty.maxLength !== null && text.length > empty.maxLength) throw new Error('BAND_DECLARED_LENGTH_LIMIT');
  await click(surface, editor); await typeParagraphs(surface, [article.title, ...article.paragraphs], check);
  check();
  const hasFile = await read<boolean>(surface, `return docs.some(({d})=>d.querySelector('input[type="file"]'));`);
  if (!hasFile) await click(surface, 'button, label, a', '사진');
  await surface.attachFiles('input[type="file"][accept*="image"], input[type="file"]', photos);
  const result = await waitFor(async () => { const v = await bandSnapshot(surface, text); return v.images === photos.length ? v : null; }, 60000);
  if (!result.bodyMatches || result.bodyChars !== compact(text).length) throw new Error('BAND_INPUT_MISMATCH');
  return { ...result, attachmentMethod: 'file-input', paste: 'not-tested', draftBehavior: 'not-tested', stoppedBeforePost: true };
}
export async function saveBandDraftAndVerify(surface: Surface, article: ReturnType<typeof exampleArticle>, check: () => void) {
  check();
  const label = await read<string | null>(surface, `return docs.flatMap(({d})=>Array.from(d.querySelectorAll('button'))).filter(visible).map(e=>(e.textContent||'').trim()).find(t=>/^(임시저장|임시 저장|Save draft)$/i.test(t))||null;`);
  if (!label) throw new Error('BAND_DRAFT_CONTROL_MISSING');
  await click(surface, 'button', label);
  await waitFor(() => read(surface, `return !docs.some(({d})=>Array.from(d.querySelectorAll(${JSON.stringify(editor)})).some(visible));`));
  check();
  await click(surface, 'button, a', '임시저장 글');
  await click(surface, '[role="dialog"] button, [role="dialog"] a, [class*="draft"] button, [class*="draft"] a', article.title);
  const expected = [article.title, ...article.paragraphs].join('\n\n');
  const reopened = await waitFor(async () => { const v = await bandSnapshot(surface, expected); return v.bodyMatches && v.images === 5 ? v : null; });
  return { draftSaved: true, reopened: true, bodyChars: reopened.bodyChars, images: reopened.images };
}
export async function closeComposer(surface: Surface) {
  if (await point(surface, 'button[aria-label="닫기"]')) await click(surface, 'button[aria-label="닫기"]');
  else await click(surface, 'button', '취소');
  // A discard dialog may appear; only an explicit discard/cancel action is ever allowed.
  const discard = await read<string | null>(surface, `for(const {d} of docs) for(const dialog of d.querySelectorAll('[role="dialog"]')) {
    if(!/작성|내용/.test(dialog.textContent||'')||!/취소|삭제|나가/.test(dialog.textContent||'')) continue;
    const e=Array.from(dialog.querySelectorAll('button')).find(e=>visible(e)&&/^(작성 취소|나가기)$/.test((e.textContent||'').trim())); if(e)return e.textContent.trim();
  } return null;`);
  if (discard) await click(surface, '[role="dialog"] button', discard);
  const remaining = await read<boolean>(surface, `return docs.some(({d})=>Array.from(d.querySelectorAll(${JSON.stringify(editor)})).some(visible));`);
  if (remaining) { await surface.show(); throw new Error('BAND_DISCARD_CONFIRM_REQUIRED'); }
}
