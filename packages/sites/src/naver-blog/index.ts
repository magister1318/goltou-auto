// Reference: ../refs/DAF/daf3/modules/helper/src/workflow/{editor,publish-draft}.ts and ../refs/DAF/daf3/packages/engine-naver-editor/src/{page/editor-page,verify/page,verify/draft-verifier}.ts (selectors and save/reopen sequence only).
import type { Surface } from '@goltou/surface';
import { click, compact, read, typeParagraphs, waitFor } from '../dom';
import type { exampleArticle } from '../fixture';

const titleSelector = '.se-documentTitle .se-text-paragraph, .se-documentTitle [contenteditable="true"]';
const bodySelector = '.se-main-container .se-component.se-text .se-text-paragraph, article .se-component.se-text [contenteditable="true"]';
export async function snapshot(surface: Surface) {
  return read<{ title: string; body: string; paragraphs: number; images: number }>(surface, `
    const d=docs.find(({d})=>d.querySelector('.se-documentTitle'))?.d;
    if (!d) return {title:'',body:'',paragraphs:0,images:0};
    const blocks=Array.from(d.querySelectorAll('.se-main-container .se-component.se-text'));
    return { title:(d.querySelector('.se-documentTitle .se-text-paragraph')?.textContent||'').trim(),
      body:blocks.map(e=>e.textContent||'').join('\\n'),
      paragraphs:blocks.reduce((n,e)=>n+Array.from(e.querySelectorAll('.se-text-paragraph')).filter(p=>(p.textContent||'').trim()).length,0),
      images:d.querySelectorAll('.se-main-container .se-image-resource').length };`);
}
export async function fillBlog(surface: Surface, article: ReturnType<typeof exampleArticle>, photos: readonly string[], check: () => void) {
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
  await click(surface, 'button.save_btn__bzc5B, button[data-click-area="tpb.save"], button', '임시저장');
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
