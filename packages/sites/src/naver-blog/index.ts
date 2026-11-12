// Reference: ../refs/DAF/daf3/modules/helper/src/workflow/{editor,publish-draft}.ts and ../refs/DAF/daf3/packages/engine-naver-editor/src/{page/editor-page,verify/page,verify/draft-verifier}.ts (selectors and save/reopen sequence only).
import type { Surface } from '@goltou/surface';
import { click, compact, read, sleep, typeParagraphs, waitFor } from '../dom';
import type { exampleArticle } from '../fixture';

const titleSelector = '.se-documentTitle .se-text-paragraph, .se-documentTitle [contenteditable="true"]';
const bodySelector = '.se-content .se-component.se-text .se-text-paragraph, .se-main-container .se-component.se-text .se-text-paragraph';
export async function snapshot(surface: Surface) {
  return read<{ title: string; body: string; paragraphs: number; images: number }>(surface, `
    const d=docs.find(({d})=>d.querySelector('.se-documentTitle'))?.d;
    if (!d) return {title:'',body:'',paragraphs:0,images:0};
    const text=e=>Array.from(e?.querySelectorAll('.__se-node')||[]).map(n=>n.textContent||'').join('') || (e?.querySelector('.se-placeholder') ? '' : e?.textContent||'');
    const blocks=Array.from(d.querySelectorAll('.se-content .se-component.se-text .se-text-paragraph, .se-main-container .se-component.se-text .se-text-paragraph'));
    return { title:text(d.querySelector('.se-documentTitle .se-text-paragraph')).trim(),
      body:blocks.map(text).join('\\n'),
      paragraphs:blocks.filter(p=>text(p).trim()).length,
      images:d.querySelectorAll('.se-content .se-image-resource, .se-main-container .se-image-resource').length };`);
}
export async function fillBlog(surface: Surface, article: ReturnType<typeof exampleArticle>, photos: readonly string[], check: () => void) {
  await waitFor(() => read(surface, `return docs.some(({d})=>d.querySelector('.se-documentTitle'));`), 30000);
  await waitFor(() => read(surface, `return docs.some(({d})=>d.querySelector(${JSON.stringify(bodySelector)}) || Array.from(d.querySelectorAll('.se-popup-alert-confirm')).some(visible));`), 30000);
  // SmartEditor's autosave check can show its restore prompt after the first paint.
  await sleep(900); check();
  // Resume for preservation, then stop before any text input into the owner's composition.
  const restore = await read<boolean>(surface, `return docs.some(({d})=>Array.from(d.querySelectorAll('.se-popup-alert-confirm')).some(e=>visible(e)&&/작성 중인 글이 있습니다/.test(e.textContent||'')&&/이어서 작성/.test(e.textContent||'')));`);
  if (restore) {
    await click(surface, '.se-popup-alert-confirm .se-popup-button-confirm', '확인');
    await sleep(900);
    // Never overwrite a delayed restore, even if its first frame still looks empty.
    throw new Error('EXISTING_DRAFT_REQUIRES_EMPTY_EDITOR');
  }
  await waitFor(() => read(surface, `return docs.some(({d})=>d.querySelector(${JSON.stringify(bodySelector)}));`), 30000);
  const help = await read<boolean>(surface, `return docs.some(({d})=>Array.from(d.querySelectorAll('.se-help-panel-close-button')).some(visible));`);
  if (help) await click(surface, '.se-help-panel-close-button');
  const initial = await snapshot(surface);
  if (initial.title || compact(initial.body) || initial.images) throw new Error('EDITOR_NOT_EMPTY');
  await click(surface, titleSelector); check(); await surface.typeText(article.title);
  await click(surface, bodySelector); await typeParagraphs(surface, article.paragraphs, check);
  check();
  await click(surface, 'button[data-name="image"]');
  // File chooser is handled by CDP's file-input command, without opening personal storage UI.
  await surface.attachFiles('input[type="file"]', photos);
  await waitFor(async () => { const v = await snapshot(surface); return v.images === photos.length ? v : null; }, 60000);
  const before = await snapshot(surface);
  if (before.title !== article.title || compact(before.body) !== compact(article.body) || before.paragraphs < 15) throw new Error('INPUT_MISMATCH');
  return before;
}
export async function saveAndReopen(surface: Surface, article: ReturnType<typeof exampleArticle>, photos: number, check: () => void, reopenEmpty: () => Promise<Surface>) {
  check();
  // Exact save selector/text only. This module contains no publish or schedule action.
  await click(surface, 'button[data-click-area="tpb.save"]');
  await waitFor(() => read(surface, `return docs.some(({d})=>/저장되었습니다|저장 완료|임시저장되었습니다/.test(d.body?.textContent||''));`));
  check(); surface = await reopenEmpty();
  const empty = await snapshot(surface);
  if (empty.title || compact(empty.body) || empty.images) throw new Error('DRAFT_FRESH_EDITOR_NOT_EMPTY');
  await click(surface, 'button[class*="save_count"], button[aria-label*="임시저장된 글 보기"], button[data-click-area*="count"]');
  const selector = '[aria-label="임시저장된 글"] > li button[class*="title"], [aria-label="임시저장된 글"] > li a';
  const count = await waitFor(() => read<number | null>(surface, `const n=docs.reduce((n,{d})=>n+Array.from(d.querySelectorAll(${JSON.stringify(selector)})).filter(e=>(e.textContent||'').trim()===${JSON.stringify(article.title)}).length,0); return n||null;`));
  if (count !== 1) throw new Error('DRAFT_IDENTITY_AMBIGUOUS');
  check(); await click(surface, selector, article.title);
  const after = await waitFor(async () => { const v = await snapshot(surface); return v.title === article.title && v.images === photos ? v : null; }, 30000);
  if (compact(after.body) !== compact(article.body) || after.paragraphs < 15) throw new Error('DRAFT_READBACK_MISMATCH');
  return { titleMatches: true, bodyChars: compact(after.body).length, expectedChars: compact(article.body).length, images: after.images, paragraphs: after.paragraphs, reopenedFromList: true };
}
