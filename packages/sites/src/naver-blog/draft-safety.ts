import type { Surface } from '@goltou/surface';
import { click, read, sleep } from '../dom';

export const tagInputSelector = 'input#tag-input, input[placeholder*="태그"], .tag_input input, input[name="tag"]';
export const tagPanelToggle = 'button[data-click-area="tpb.publish"][class*="publish_btn__"]';
// Check both independent layer controls, including a layer whose tag input vanished.
const layerSelector = '[class^="tag_textarea__"] #tag-input, button[data-click-area="tpb*i.publish"]';
const layerRead = `const open=docs.some(({d})=>Array.from(d.querySelectorAll(${JSON.stringify(layerSelector)})).some(visible));`;
const focusRead = `const inputs=docs.flatMap(({d})=>Array.from(d.querySelectorAll(${JSON.stringify(tagInputSelector)})).filter(visible));
  let active=document.activeElement;
  while(active?.tagName==='IFRAME'&&active.contentDocument) active=active.contentDocument.activeElement;
  const tagFocused=inputs.length===1&&active===inputs[0];`;

export function tagLayerOpen(surface: Surface): Promise<boolean> {
  return read(surface, `${layerRead} return open;`);
}
export async function requireTagFocus(surface: Surface): Promise<void> {
  if (!await read<boolean>(surface, `${focusRead} return tagFocused;`)) throw new Error('BLOG_TAG_FOCUS_LOST');
}

/** Guard the actual Surface entry points used by EVERY executor/helper input.
 * Keep surface identity/lifecycle intact for the shell. No page handlers or DOM are changed. */
export function protectBlogInputs(surface: Surface, allowLayerClick?: (x: number, y: number) => Promise<boolean>): void {
  const press = surface.pressKey.bind(surface), mouse = surface.click.bind(surface), type = surface.typeText.bind(surface);
  surface.pressKey = async input => {
    const safe = await read<boolean>(surface, `${layerRead} ${focusRead} return !open||tagFocused;`);
    if (!safe) throw new Error('BLOG_TAG_FOCUS_LOST');
    await press(input);
  };
  surface.click = async (x, y, beforePress) => {
    if (await tagLayerOpen(surface)) {
      // elementFromPoint is rejected by CDP throwOnSideEffect (layout flush).
      // Use the Surface's read-only compositor hit test, never approximate rectangles.
      const safe = await surface.readClickTarget?.(x, y, `${tagInputSelector}, ${tagPanelToggle}`).catch(() => false);
      if (!safe && !await allowLayerClick?.(x, y)) throw new Error('BLOG_TAG_FOCUS_LOST');
    }
    await mouse(x, y, beforePress);
  };
  surface.typeText = async text => {
    const open = await tagLayerOpen(surface);
    if (open) await requireTagFocus(surface);
    await type(text);
    if (open) await requireTagFocus(surface);
  };
}

export async function closeTagLayer(surface: Surface): Promise<void> {
  try {
    if (!await tagLayerOpen(surface)) return;
    // The real layer covers the toolbar toggle. Its loaded keydown handler
    // closes on Escape. Focus only the exact tag input before sending that key.
    await click(surface, 'BLOG_TAG_INPUT', tagInputSelector, undefined, 1000);
    await requireTagFocus(surface);
    await surface.pressKey({ key: 'Escape' });
    for (let n = 0; n < 5; n++) {
      if (!await tagLayerOpen(surface)) return;
      await sleep(100);
    }
  } catch { /* Never try a background click, Tab, Enter or the final publish control. */ }
  throw new Error('BLOG_TAG_LAYER_NOT_CLOSED');
}

export async function requireTagLayerClosed(surface: Surface): Promise<void> {
  if (await tagLayerOpen(surface)) throw new Error('BLOG_TAG_LAYER_NOT_CLOSED');
}
