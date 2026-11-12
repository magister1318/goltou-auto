// Reference: ../refs/golfliat/programs/golfliat-workbench/electron/renderer.js, fillBandComposerInWebview (composer/file selectors and readback only; DOM setters, synthetic paste and CKEditor mutations excluded).
import type { Surface } from '@goltou/surface';
import { click, compact, point, read, sleep, typeParagraphs, waitFor } from '../dom';
import type { exampleArticle } from '../fixture';

export async function listBands(surface: Surface) {
  return waitFor(async () => {
    const rows = await read<{ key: string; name: string }[]>(surface, `const seen=new Set(); return docs.flatMap(({d})=>Array.from(d.querySelectorAll('._myBandListWrap a.bandCover:not(._adBandCover)'))).flatMap(e=>{
      const m=(e.getAttribute('href')||'').match(/^(?:https:[/][/](?:www[.])?band[.]us)?[/]band[/]([0-9]+)(?:[/]post)?[/]?(?:[?#].*)?$/);
      const name=(e.querySelector('.bandName')?.textContent||e.textContent||'').trim(); if (!m || !name || seen.has(m[1])) return []; seen.add(m[1]); return [{key:m[1],name:name.slice(0,100)}]; });`);
    return rows.length ? rows : null;
  });
}
const editor = 'textarea._postTextArea, [contenteditable="true"][role="textbox"], .cke_editable[contenteditable="true"], textarea[placeholder*="글"], [contenteditable="true"][data-placeholder]';
export async function bandSnapshot(surface: Surface, expected: string) {
  return read<{ bodyMatches: boolean; bodyChars: number; rawBodyChars: number; images: number; maxLength: number | null; fileInput: boolean; draftControl: boolean }>(surface, `
    const e=docs.flatMap(({d})=>Array.from(d.querySelectorAll(${JSON.stringify(editor)}))).find(visible);
    const text=n=>{if(n.nodeType===3)return n.textContent||'';if(n.nodeType!==1||n.tagName.toLowerCase()==='band:attachment'||/(^|\\s)(?:_?placeholder)(?:\\s|$)/.test(n.className||''))return '';return Array.from(n.childNodes).map(text).join('');};
    const body=e?.tagName==='TEXTAREA' ? e.value : (e ? text(e) : '');
    const compact=s=>s.replace(/[\\s\\u200b-\\u200d\\ufeff]+/gu,'');
    const imageCount=docs.reduce((n,{d})=>{const attachments=Array.from(d.querySelectorAll('*')).filter(e=>e.tagName.toLowerCase()==='band:attachment').length;
      return n+(attachments||d.querySelectorAll('.postAttachItem ._mediaListWrap img.mediaImg, .cke_editable img, [class*="photoPreview"] img, [class*="attachedPhoto"] img, [contenteditable="true"] img').length);},0);
    return {bodyMatches:compact(body)===compact(${JSON.stringify(expected)}),bodyChars:compact(body).length,rawBodyChars:body.length,images:imageCount,
      maxLength:e?.hasAttribute('maxlength') ? Number(e.getAttribute('maxlength')) : null,
      fileInput:docs.some(({d})=>d.querySelector('input[type="file"]')),
      draftControl:docs.some(({d})=>Array.from(d.querySelectorAll('button,a')).some(e=>visible(e)&&/^(임시저장|임시 저장|Save draft)$/i.test((e.textContent||'').trim())))};`);
}
export async function openBandComposer(surface: Surface) {
  if (!/^https:\/\/(?:www\.)?band\.us\/band\/\d+\/post\/?(?:[?#].*)?$/.test((await surface.readState()).url)) throw new Error('NOT_BAND_COMPOSE_ROUTE');
  // Never type into an existing composition or a search/comment box.
  if (!await read<boolean>(surface, `return docs.some(({d})=>Array.from(d.querySelectorAll(${JSON.stringify(editor)})).some(visible));`)) {
    const mobileSelector = 'button.uFloatingButton._btnPostWrite[aria-label="글쓰기"]';
    const desktopSelector = 'button._btnPostWrite, button.cPostWriteEventWrapper._btnOpenWriteLayer';
    const mode = await waitFor(async () => await point(surface, mobileSelector) ? 'mobile'
      : await point(surface, desktopSelector, '글쓰기') ? 'desktop' : null);
    if (mode === 'mobile') await click(surface, mobileSelector);
    else await click(surface, desktopSelector, '글쓰기');
  }
  await waitFor(() => read(surface, `return docs.some(({d})=>Array.from(d.querySelectorAll(${JSON.stringify(editor)})).some(visible));`));
}
export async function fillBand(surface: Surface, article: ReturnType<typeof exampleArticle>, photos: readonly string[], check: () => void) {
  await openBandComposer(surface);
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
  await confirmBandPhotos(surface, photos.length);
  const result = await waitFor(async () => { const v = await bandSnapshot(surface, text); return v.images === photos.length ? v : null; }, 60000);
  if (!result.bodyMatches || result.bodyChars !== compact(text).length) throw new Error('BAND_INPUT_MISMATCH');
  return { ...result, attachmentMethod: 'file-input', paste: 'not-tested', draftBehavior: 'not-tested', stoppedBeforePost: true };
}
export async function confirmBandPhotos(surface: Surface, count: number) {
  let confirmed = false;
  await waitFor(async () => {
    if ((await bandSnapshot(surface, '')).images === count) return true;
    if (!confirmed) {
      const control = await read<{ x: number; y: number } | null>(surface, `for(const {d,x,y} of docs) for(const dialog of d.querySelectorAll('section.lyWrap')) {
        if((dialog.querySelector('h1,h2,h3')?.textContent||'').trim()!=='사진 올리기'||dialog.querySelectorAll('._itemDraggable').length!==${count})continue;
        const e=dialog.querySelector('button._submitBtn');if(!e||!visible(e)||e.disabled||(e.textContent||'').trim()!=='첨부하기')continue;
        const r=e.getBoundingClientRect();return {x:x+r.left+r.width/2,y:y+r.top+r.height/2};
      }return null;`);
      if (control) { confirmed = true; await surface.click(control.x, control.y); await sleep(350); }
    }
    return null;
  }, 60000);
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
  const cancelConfirmation = () => read<{ x: number; y: number } | null>(surface, `for(const {d,x,y} of docs) for(const dialog of d.querySelectorAll('.modalLayerView,section.lyWrap')) {
    if ((dialog.querySelector('h1,.headingMsg')?.textContent||'').trim()!=='글 작성을 취소하시겠습니까?') continue;
    const e=dialog.querySelector('button._confirmBtn,button._btnConfirm'); if(!e||!visible(e)||(e.textContent||'').trim()!=='확인') continue;
    const r=e.getBoundingClientRect();return {x:x+r.left+r.width/2,y:y+r.top+r.height/2};
  } return null;`);
  if (!await cancelConfirmation()) {
    if (await point(surface, 'button.buttonClose._closeBtn', '이전')) await click(surface, 'button.buttonClose._closeBtn', '이전');
    else if (await point(surface, 'button[aria-label="닫기"]')) await click(surface, 'button[aria-label="닫기"]');
    else await click(surface, 'button', '취소');
  }
  const discardControl = await cancelConfirmation();
  if (discardControl) { await surface.click(discardControl.x, discardControl.y); await sleep(350); }
  // A discard dialog may appear; only an explicit discard/cancel action is ever allowed.
  const discard = await read<string | null>(surface, `for(const {d} of docs) for(const dialog of d.querySelectorAll('[role="dialog"]')) {
    if(!/작성|내용/.test(dialog.textContent||'')||!/취소|삭제|나가/.test(dialog.textContent||'')) continue;
    const e=Array.from(dialog.querySelectorAll('button')).find(e=>visible(e)&&/^(작성 취소|나가기)$/.test((e.textContent||'').trim())); if(e)return e.textContent.trim();
  } return null;`);
  if (discard) await click(surface, '[role="dialog"] button', discard);
  const remaining = await read<boolean>(surface, `return docs.some(({d})=>Array.from(d.querySelectorAll(${JSON.stringify(editor)})).some(visible));`);
  if (remaining) { await surface.show(); throw new Error('BAND_DISCARD_CONFIRM_REQUIRED'); }
}
