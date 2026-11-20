import { blogTagClassPrefixes, traceStep, trace, type BlogTagDiagnostic } from '@goltou/surface/telemetry';
import { clickHitTags, type Surface } from '@goltou/surface';
import { read, sleep, waitFor } from '../dom';
import { ControlNotFoundError } from '../control-failure';

export const tagInputSelector = 'input#tag-input, input[placeholder*="태그"], .tag_input input, input[name="tag"]';
export const tagPanelToggle = 'button[data-click-area="tpb.publish"][class*="publish_btn__"]';
// Check both independent layer controls, including a layer whose tag input vanished.
const layerSelector = '[class^="tag_textarea__"] #tag-input, button[data-click-area="tpb*i.publish"]';
const areaSelector = 'div[class^="tag_textarea__"]';
const layerRead = `const open=docs.some(({d})=>Array.from(d.querySelectorAll(${JSON.stringify(layerSelector)})).some(visible));`;
const inputRead = `const inputs=docs.flatMap(frame=>Array.from(frame.d.querySelectorAll(${JSON.stringify(tagInputSelector)})).filter(visible).map(input=>({input,frame})));`;
const focusRead = `${inputRead}
  let active=document.activeElement;
  while(active?.tagName==='IFRAME'&&active.contentDocument) active=active.contentDocument.activeElement;
  const tagFocused=inputs.length===1&&active===inputs[0].input;
  const tag=active?.localName;
  const classes=(active?.getAttribute('class')||'').split(/\\s+/);
  const prefix=${JSON.stringify(blogTagClassPrefixes)}.find(prefix=>classes.some(name=>name.startsWith(prefix+'__')));
  const focusHit=!tag?'[none]':${JSON.stringify(clickHitTags)}.includes(tag)?tag.toUpperCase()+(prefix?'.'+prefix:''):'[other]';`;

type Point = { x: number; y: number };
type ScrollMethod = NonNullable<BlogTagDiagnostic['method']>;
type TagGeometry = {
  input: Point;
  inputInside: boolean;
  windowYs: [number, ...number[]];
  area?: { clientHeight: number; scrollHeight: number; scrollTop: number; chips: number };
};

function tagGeometry(surface: Surface): Promise<TagGeometry | null> {
  return read(surface, `${inputRead}
    if(inputs.length!==1||inputs[0].input.disabled) return null;
    const {input,frame:{d,x,y}}=inputs[0], r=input.getBoundingClientRect();
    const at={x:x+r.left+r.width/2,y:y+r.top+r.height/2};
    const inViewport=at.x>0&&at.y>0&&at.x<innerWidth&&at.y<innerHeight;
    const windowYs=[];
    for(let w=d.defaultView;;w=w.parent){
      windowYs.push(w.scrollY);
      if(w===window) break;
    }
    const areas=Array.from(d.querySelectorAll(${JSON.stringify(areaSelector)}));
    let area=input.parentElement;
    while(area&&!areas.includes(area)) area=area.parentElement;
    if(!area) return {input:at,inputInside:inViewport,windowYs};
    const box=area.getBoundingClientRect();
    const {clientWidth,clientHeight,clientLeft,clientTop,scrollHeight,scrollTop}=area;
    const x0=x+box.left+clientLeft,y0=y+box.top+clientTop;
    const left=Math.max(0,x0),right=Math.min(innerWidth,x0+clientWidth);
    const top=Math.max(0,y0),bottom=Math.min(innerHeight,y0+clientHeight);
    const inputInside=inViewport&&at.x>=left&&at.x<right&&at.y>=top&&at.y<bottom;
    const chips=area.querySelectorAll('span[class*="tag__"][aria-label]').length;
    return {input:at,inputInside,windowYs,area:{clientHeight,scrollHeight,scrollTop,chips}};`);
}

async function clickTarget(surface: Surface, at: Point, selector: string, direct = false) {
  let hit = '[other]';
  const matched = await surface.readClickTarget?.(at.x, at.y, selector, {
    direct,
    onMiss: { classes: [], classPrefixes: blogTagClassPrefixes, ariaLabels: [], report: ({ rejectedHit }) => {
      if (!rejectedHit) hit = '[none]';
      else if (rejectedHit.tag !== '[other]') hit = rejectedHit.tag.toUpperCase() + (rejectedHit.classes[0] ? `.${rejectedHit.classes[0]}` : '');
    } },
  }).catch(() => false);
  return { matched: matched === true, hit: matched ? 'SELF' : hit };
}

function tagFocusLost(phase: BlogTagDiagnostic['phase'], hit: string): never {
  trace('verification', 'decision', { check: 'focus', choice: 'fail', reason: 'BLOG_TAG_FOCUS_LOST', blogTag: { phase, hit } });
  throw new Error('BLOG_TAG_FOCUS_LOST');
}

function tagClickDecision(phase: 'before_click' | 'after_click', method: ScrollMethod, before: TagGeometry,
  after: TagGeometry | null, hit: string, choice: 'ok' | 'retry' | 'fail') {
  const area = after?.area ?? before.area;
  trace('verification', 'decision', { check: 'focus', selector: 'BLOG_TAG_INPUT', choice,
    ...(choice === 'fail' ? { reason: 'BLOG_TAG_FOCUS_LOST' as const } : {}),
    blogTag: { phase, method, hit, inputInside: after?.inputInside ?? false,
      ...(before.area && { scrollTopBefore: before.area.scrollTop, chipsBefore: before.area.chips }),
      ...(area && { clientHeight: area.clientHeight, scrollHeight: area.scrollHeight }),
      ...(after?.area && { scrollTopAfter: after.area.scrollTop, chipsAfter: after.area.chips }),
      winYBefore: before.windowYs[0], ...(after && { winYAfter: after.windowYs[0] }),
    } });
}

export function tagLayerOpen(surface: Surface): Promise<boolean> {
  return read(surface, `${layerRead} return open;`);
}

function readTagFocus(surface: Surface) {
  return read<{ tagFocused: boolean; focusHit: string }>(surface, `${focusRead} return {tagFocused,focusHit};`);
}

export async function requireTagFocus(surface: Surface, phase: 'required_focus' | 'input_before' | 'input_after' = 'required_focus'): Promise<void> {
  return traceStep('sites.naver-blog.draft-safety.requireTagFocus', async () => {
    const { tagFocused, focusHit } = await readTagFocus(surface);
    if (!tagFocused) tagFocusLost(phase, focusHit);
  });
}

/** Guard the actual Surface entry points used by EVERY executor/helper input.
 * Keep surface identity/lifecycle intact for the shell. No page handlers or DOM are changed. */
export function protectBlogInputs(surface: Surface, allowLayerClick?: (x: number, y: number) => Promise<boolean>): void {
  const press = surface.pressKey.bind(surface), mouse = surface.click.bind(surface), type = surface.typeText.bind(surface);
  surface.pressKey = async input => {
    const { safe, focusHit } = await read<{ safe: boolean; focusHit: string }>(surface, `${layerRead} ${focusRead} return {safe:!open||tagFocused,focusHit};`);
    if (!safe) tagFocusLost('key_focus', focusHit);
    await press(input);
  };
  surface.click = async (x, y, beforePress) => {
    if (await tagLayerOpen(surface)) {
      // Check the element hit at the actual pointer position.
      const { matched, hit } = await clickTarget(surface, { x, y }, `${tagInputSelector}, ${tagPanelToggle}`);
      if (!matched && !await allowLayerClick?.(x, y)) tagFocusLost('click_target', hit);
    }
    await mouse(x, y, beforePress);
  };
  surface.typeText = async text => {
    const open = await tagLayerOpen(surface);
    if (open) await requireTagFocus(surface, 'input_before');
    await type(text);
    if (open) await requireTagFocus(surface, 'input_after');
  };
}

export async function clickTagInput(surface: Surface, timeoutMs = 8000, check?: () => Promise<void>): Promise<void> {
  return traceStep('sites.naver-blog.draft-safety.clickTagInput', async () => {
    let geometry = await waitFor(() => tagGeometry(surface), timeoutMs, { surface, control: 'BLOG_TAG_INPUT' }).catch(error => {
      if (error instanceof Error && error.message === 'OBSERVATION_TIMEOUT') throw new ControlNotFoundError('BLOG_TAG_INPUT');
      throw error;
    });
    let before = geometry;
    let method: ScrollMethod = 'none';
    let target = await clickTarget(surface, geometry.input, tagInputSelector, true);
    for (const nextMethod of ['scrollIntoView', 'scrollTop'] as const) {
      if (geometry.inputInside && target.matched) break;
      const { area } = geometry;
      if (!area || !surface.scrollElement) break;
      tagClickDecision('before_click', method, before, geometry, target.hit, 'retry');
      await check?.();
      before = geometry;
      method = nextMethod;
      const scrolled = await surface.scrollElement(tagInputSelector, areaSelector, method);
      if (scrolled) await sleep(100);
      const after = await tagGeometry(surface);
      target = after ? await clickTarget(surface, after.input, tagInputSelector, true) : { matched: false, hit: '[none]' };
      if (!scrolled || !after?.area || area.chips !== after.area.chips ||
        before.windowYs.length !== after.windowYs.length || before.windowYs.some((y, i) => y !== after.windowYs[i])) {
        tagClickDecision('before_click', method, before, after, target.hit, 'fail');
        throw new Error('BLOG_TAG_FOCUS_LOST');
      }
      geometry = after;
    }
    if (!geometry.inputInside || !target.matched) {
      tagClickDecision('before_click', method, before, geometry, target.hit, 'fail');
      throw new Error('BLOG_TAG_FOCUS_LOST');
    }
    await check?.();
    tagClickDecision('before_click', method, before, geometry, target.hit, 'ok');
    const { input } = geometry;
    await surface.click(input.x, input.y, async () => {
      const current = await clickTarget(surface, input, tagInputSelector, true);
      if (!current.matched) tagFocusLost('click_target', current.hit);
    });
    await sleep(350);
    const after = await tagGeometry(surface);
    const focused = await readTagFocus(surface);
    const hitAfter = after ? await clickTarget(surface, after.input, tagInputSelector, true) : null;
    tagClickDecision('after_click', method, before, after, hitAfter?.hit ?? focused.focusHit, focused.tagFocused ? 'ok' : 'fail');
    if (!focused.tagFocused) tagFocusLost('required_focus', focused.focusHit);
  });
}

export async function closeTagLayer(surface: Surface): Promise<void> {
    return traceStep('sites.naver-blog.draft-safety.closeTagLayer', async () => {
  try {
    if (!await tagLayerOpen(surface)) return;
    // The real layer covers the toolbar toggle. Its loaded keydown handler
    // closes on Escape. Focus only the exact tag input before sending that key.
    await clickTagInput(surface, 1000);
    await requireTagFocus(surface);
    await surface.pressKey({ key: 'Escape' });
    for (let n = 0; n < 5; n++) {
      if (!await tagLayerOpen(surface)) return;
      await sleep(100);
    }
  } catch { trace('sites.naver-blog.draft-safety.closeTagLayer', 'fail', { reason: 'CAUGHT_FAILURE' });  /* Never try a background click, Tab, Enter or the final publish control. */ }
  throw new Error('BLOG_TAG_LAYER_NOT_CLOSED');

    });
  }

export async function requireTagLayerClosed(surface: Surface): Promise<void> {
    return traceStep('sites.naver-blog.draft-safety.requireTagLayerClosed', async () => {
  if (await tagLayerOpen(surface)) throw new Error('BLOG_TAG_LAYER_NOT_CLOSED');

    });
  }
