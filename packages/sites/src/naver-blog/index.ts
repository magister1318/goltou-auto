// Reference: ../refs/DAF/daf3/modules/helper/src/workflow/{editor,publish-draft}.ts and ../refs/DAF/daf3/packages/engine-naver-editor/src/{page/editor-page,verify/page,verify/draft-verifier}.ts (selectors and save/reopen sequence only).
import type { Surface } from '@goltou/surface';
import { click, compact, read, sleep, waitFor } from '../dom';
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
/** Fixture identities and paragraph positions only. Never return image URLs or account metadata. */
export async function blogImageLayout(surface: Surface) {
  return read<{ sample: number | null; afterParagraph: number }[]>(surface, `
    const d=docs.find(({d})=>d.querySelector('.se-documentTitle'))?.d;
    if(!d) return [];
    let paragraphs=0; const images=[];
    for(const e of d.querySelectorAll(${JSON.stringify(`${bodySelector}, .se-content .se-image-resource, .se-main-container .se-image-resource`)})) {
      if(e.tagName==='IMG') {
        const identity=[e.getAttribute('src'),e.getAttribute('alt'),e.getAttribute('data-file-name')].join(' ');
        const match=/sample-([1-5])(?:[._]|$)/.exec(identity);
        images.push({sample:match?Number(match[1]):null,afterParagraph:paragraphs});
      } else {
        const nodes=Array.from(e.querySelectorAll('.__se-node'));
        const text=nodes.length?nodes.map(n=>n.textContent||'').join(''):(e.querySelector('.se-placeholder')?'':e.textContent||'');
        if(text.trim()) paragraphs++;
      }
    }
    return images;`);
}
export interface BlogEditorOptions {
  /** Set only after the user agrees in the app to discard the auto-recovered unsaved composition.
   * Never authorizes deleting saved drafts or published posts. The default stops without clicking. */
  autoRecover?: 'stop' | 'decline-with-user-consent';
  lastTypedTitle?: string | null;
  onOwnRecoveryDiscarded?(): void;
}
async function requireBlogEditor(surface: Surface) {
  const ready = await read<boolean>(surface, `return !docs.some(({d})=>d.querySelector('input[type="password"]')||/nid\\.naver\\.com/.test(d.location.hostname))&&docs.some(({d})=>d.querySelector('.se-documentTitle'));`);
  if (!ready) throw new Error('LOGIN_OR_EDITOR_LOST');
}
async function typeBlogText(surface: Surface, text: string, check: () => void) {
  // Recheck the editor between short chunks and stop when a dropped session is observed.
  const characters = Array.from(text);
  for (let offset = 0; offset < characters.length; offset += 32) {
    check(); await requireBlogEditor(surface);
    await surface.typeText(characters.slice(offset, offset + 32).join(''));
  }
}
export async function prepareBlogEditor(surface: Surface, check: () => void, options: BlogEditorOptions = {}) {
  await waitFor(() => read(surface, `return docs.some(({d})=>d.querySelector('.se-documentTitle'));`), 30000);
  await waitFor(() => read(surface, `return docs.some(({d})=>d.querySelector(${JSON.stringify(bodySelector)}) || Array.from(d.querySelectorAll('.se-popup-alert-confirm')).some(visible));`), 30000);
  // SmartEditor's autosave check can show its restore prompt after the first paint.
  await sleep(900); check();
  const restore = await read<number>(surface, `return docs.reduce((n,{d})=>n+Array.from(d.querySelectorAll('.se-popup-alert-confirm')).filter(e=>visible(e)&&/작성 중인 글이 있습니다/.test(e.textContent||'')&&/이어서 작성/.test(e.textContent||'')).length,0);`);
  if (restore) {
    // Read only a title explicitly displayed by the recovery prompt. A blank
    // editor behind the modal is not the leftover. Never restore it to inspect
    // its body, inspect page state, or collect the autosave response document.
    const title = await read<string | null>(surface, `
      const titles=docs.flatMap(({d})=>Array.from(d.querySelectorAll('.se-popup-alert-confirm')).filter(visible).flatMap(e=>Array.from(e.querySelectorAll('.se-documentTitle .se-text-paragraph'))).filter(visible));
      if(titles.length!==1||titles[0].querySelector('.se-placeholder'))return null;
      const nodes=Array.from(titles[0].querySelectorAll('.__se-node'));
      return (nodes.length?nodes.map(e=>e.textContent||'').join(''):titles[0].textContent||'')||null;`).catch(() => null);
    const own = !!title && !!options.lastTypedTitle && title === options.lastTypedTitle;
    if (restore !== 1 || !own && options.autoRecover !== 'decline-with-user-consent') throw new Error('AUTO_RECOVER_CONSENT_REQUIRED');
    check();
    await click(surface, 'BLOG_RESTORE_CANCEL', '.se-popup-alert-confirm .se-popup-button-cancel', '취소');
    await waitFor(() => read(surface, `return !docs.some(({d})=>Array.from(d.querySelectorAll('.se-popup-alert-confirm')).some(visible));`));
    if (own) options.onOwnRecoveryDiscarded?.();
  }
  await waitFor(() => read(surface, `return docs.some(({d})=>d.querySelector(${JSON.stringify(bodySelector)}));`), 30000);
  const help = await read<boolean>(surface, `return docs.some(({d})=>Array.from(d.querySelectorAll('.se-help-panel-close-button')).some(visible));`);
  if (help) await click(surface, 'BLOG_HELP_CLOSE', '.se-help-panel-close-button');
  const initial = await snapshot(surface);
  const embedded = await read<boolean>(surface, `return docs.some(({d})=>d.querySelector('.se-component.se-table,.se-component.se-oglink,.se-component.se-quotation,.se-component.se-video,.se-component.se-sticker'));`);
  if (initial.title || compact(initial.body) || initial.images || embedded) throw new Error('EDITOR_NOT_EMPTY');
  return { empty: true, autoRecoverDeclined: restore === 1 };
}
export async function confirmBlogPhotos(surface: Surface, count: number, check: () => void) {
  // Multiple selected files require an explicit layout choice in the current editor.
  const state = await waitFor(() => read<'choice' | 'inserted' | null>(surface, `
    if(docs.some(({d})=>Array.from(d.querySelectorAll('.se-popup-image-type')).some(e=>visible(e)&&e.querySelector('input#image-type-list[name="image-type-selection"]')))) return 'choice';
    return docs.some(({d})=>d.querySelectorAll('.se-content .se-image-resource, .se-main-container .se-image-resource').length===${count})?'inserted':null;`), 60000);
  if (state === 'choice') {
    check(); await requireBlogEditor(surface);
    await click(surface, 'BLOG_IMAGE_LIST', '.se-popup-image-type label[for="image-type-list"]', '개별사진');
  }
  return waitFor(async () => { const v = await snapshot(surface); return v.images === count ? v : null; }, 60000);
}
export async function fillBlog(surface: Surface, article: ReturnType<typeof exampleArticle>, photos: readonly string[], check: () => void, options: BlogEditorOptions = {}) {
  await prepareBlogEditor(surface, check, options);
  await requireBlogEditor(surface);
  await click(surface, 'BLOG_TITLE', titleSelector); await typeBlogText(surface, article.title, check);
  await click(surface, 'BLOG_BODY', bodySelector);
  for (let i = 0; i < article.paragraphs.length; i++) {
    await typeBlogText(surface, article.paragraphs[i]!, check);
    if (i < article.paragraphs.length - 1) {
      check(); await requireBlogEditor(surface);
      await surface.pressKey({ key: 'Enter' }); await surface.pressKey({ key: 'Enter' });
    }
  }
  check();
  await requireBlogEditor(surface);
  await click(surface, 'BLOG_IMAGE_BUTTON', 'button[data-name="image"]');
  // File chooser is handled by CDP's file-input command, without opening personal storage UI.
  await surface.attachFiles('input[type="file"]', photos);
  await confirmBlogPhotos(surface, photos.length, check);
  const before = await snapshot(surface);
  if (before.title !== article.title || compact(before.body) !== compact(article.body) || before.paragraphs !== article.paragraphs.length) throw new Error('INPUT_MISMATCH');
  return before;
}
export async function saveAndReopen(surface: Surface, article: ReturnType<typeof exampleArticle>, photos: number, check: () => void, reopenEmpty: () => Promise<Surface>, options: BlogEditorOptions = {}) {
  check();
  await requireBlogEditor(surface);
  const before = await snapshot(surface);
  if (before.title !== article.title || compact(before.body) !== compact(article.body) || before.paragraphs !== article.paragraphs.length || before.images !== photos) throw new Error('DRAFT_SAVE_INPUT_MISMATCH');
  const layoutBefore = await blogImageLayout(surface);
  const countBefore = await draftCount(surface);
  if (countBefore === null) throw new Error('DRAFT_COUNT_UNAVAILABLE');
  // Exact save selector/text only. This module contains no publish or schedule action.
  await click(surface, 'BLOG_SAVE', 'button[data-click-area="tpb.save"]');
  // This experiment always saves a new, uniquely titled draft. A transient toast is not reliable.
  await waitFor(async () => { const count = await draftCount(surface); return count !== null && count > countBefore; }, 30000);
  check(); surface = await reopenEmpty();
  await prepareBlogEditor(surface, check, options);
  const empty = await snapshot(surface);
  if (empty.title || compact(empty.body) || empty.images) throw new Error('DRAFT_FRESH_EDITOR_NOT_EMPTY');
  const result = await reopenBlogDraftFromList(surface, article, photos, check);
  if (result.rawBodyChars !== before.body.length || JSON.stringify(result.imageLayout) !== JSON.stringify(layoutBefore)) throw new Error('DRAFT_LAYOUT_READBACK_MISMATCH');
  return result;
}
async function draftCount(surface: Surface) {
  return read<number | null>(surface, `const e=docs.map(({d})=>d.querySelector('button[data-click-area="tpb*s.count"]')).find(Boolean);const text=(e?.textContent||'').replace(/[^0-9]/g,'');return text?Number(text):null;`);
}
export async function reopenBlogDraftFromList(surface: Surface, article: ReturnType<typeof exampleArticle>, photos: number, check: () => void) {
  check(); await requireBlogEditor(surface);
  const opened = await read<boolean>(surface, `return docs.some(({d})=>Array.from(d.querySelectorAll('[aria-label="임시저장된 글"]')).some(visible));`);
  if (!opened) await click(surface, 'BLOG_DRAFT_LIST', 'button[data-click-area="tpb*s.count"]');
  const selector = '[aria-label="임시저장된 글"] > li button[data-click-area="tpb*s.tlist"] strong';
  const count = await waitFor(() => read<number | null>(surface, `const n=docs.reduce((n,{d})=>n+Array.from(d.querySelectorAll(${JSON.stringify(selector)})).filter(e=>(e.textContent||'').trim()===${JSON.stringify(article.title)}).length,0); return n||null;`));
  if (count !== 1) throw new Error('DRAFT_IDENTITY_AMBIGUOUS');
  check(); await click(surface, 'BLOG_DRAFT_ITEM', selector, article.title);
  const after = await waitFor(async () => { const v = await snapshot(surface); return v.title === article.title && v.images === photos ? v : null; }, 30000);
  if (compact(after.body) !== compact(article.body) || after.paragraphs !== article.paragraphs.length) throw new Error('DRAFT_READBACK_MISMATCH');
  // Reopened offscreen photos initially have a data:image SVG placeholder, without a filename.
  // PageDown uses editor input to reveal them; never scroll or change src through a DOM write.
  await click(surface, 'BLOG_BODY', bodySelector);
  const imageLayout = await waitFor(async () => {
    check(); await requireBlogEditor(surface);
    const layout = await blogImageLayout(surface);
    if (layout.length === photos && layout.every(item => item.sample !== null)) return layout;
    await surface.pressKey({ key: 'PageDown' }); await sleep(350);
    return null;
  }, 30000);
  const imageOrderVerified = imageLayout.length === photos && imageLayout.every((item, index) => item.sample === index + 1);
  if (!imageOrderVerified) throw new Error('DRAFT_IMAGE_ORDER_MISMATCH');
  return { titleMatches: true, titleChars: after.title.length, rawBodyChars: after.body.length, bodyChars: compact(after.body).length, expectedChars: compact(article.body).length, images: after.images, paragraphs: after.paragraphs, reopenedFromList: true, imageLayout, imageOrderVerified };
}
