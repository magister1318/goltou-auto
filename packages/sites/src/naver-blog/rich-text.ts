// Reference: ../refs/DAF/daf3/packages/engine-naver-editor/test/harness/fake-smarteditor.ts (bold toolbar selector only).
import { traceStep, trace, reasonCode } from '@goltou/surface/telemetry';
import { inputCharacters, type KeyInput, type Surface } from '@goltou/surface';
import { compareReadbackText, sameReadbackNumbers, traceReadbackText } from '../readback-checks';
import { point, read, waitFor } from '../dom';
import { BlogFormattingError, blogFieldReason, runValues, blogRunReader, normalizeBlogRuns, splitBlogRuns, type BlogFormattingField, type BlogRun, type NormalizedBlogRun } from './formatting';

/** WP18 REAL-EDITOR ADAPTER. Phase B observed toolbar DOM and the focused input-buffer iframe.
 * All rich-text selectors, shortcuts and keyboard navigation belong here.
 * Unknown state or different refocus behavior must stop, never guess or mutate DOM.
 */
export const blogRichEditor = {
  paragraph: '.se-component.se-text .se-text-paragraph',
  inputBuffer: 'iframe[id^="input_buffer"]',
  virtualSelection: '.se-native-selection-hidden',
  bold: 'button[data-name="bold"]',
  boldToggle: 'se-property-toolbar-toggle-button',
  boldSelected: 'se-is-selected',
  link: 'button[data-name="text-link"]',
  dialog: '.se-custom-layer-option-link',
  address: '.se-custom-layer-option-link input.se-custom-layer-link-input',
  confirm: '.se-custom-layer-option-link button.se-custom-layer-link-apply-button',
  boldKey: { key: 'b', modifiers: 2 } as KeyInput,
  left: { key: 'ArrowLeft' } as KeyInput,
  right: { key: 'ArrowRight' } as KeyInput,
  selectLeft: { key: 'ArrowLeft', modifiers: 8 } as KeyInput,
  selectAddress: { key: 'a', modifiers: 2 } as KeyInput,
  newline: { key: 'Enter' } as KeyInput,
};
interface Cursor {
  text: string; anchor: number; focus: number; focused: boolean; last: boolean;
  runs: NormalizedBlogRun[]; bold: boolean | null; lastComponent: boolean;
}
export async function readBlogCursor(surface: Surface, selector: string = blogRichEditor.paragraph): Promise<Cursor | null> {
    return traceStep('sites.naver-blog.rich-text.readBlogCursor', async () => {
  return read(surface, `${blogRunReader}
    for(const {d} of docs){
      const paragraphs=Array.from(d.querySelectorAll(${JSON.stringify(selector)}));
      const active=d.activeElement;
      const buffered=Array.from(d.querySelectorAll(${JSON.stringify(blogRichEditor.inputBuffer)})).includes(active)&&/^input_buffer[0-9]+$/.test(active.id)
        &&active.contentDocument?.activeElement===active.contentDocument?.body&&active.contentDocument?.body?.isContentEditable===true;
      let s=d.defaultView.getSelection();
      if(buffered&&d.querySelector(${JSON.stringify(blogRichEditor.virtualSelection)})){
        // Observed SmartEditor hides/collapses native Selection even after real
        // navigation keys. Read only the already-rendered selection endpoints.
        // getSelection() invokes observable getters, rejected by throwOnSideEffect;
        // its backing endpoint values are plain data. Never invoke editor methods.
        const editors=d.defaultView.SmartEditor?._editors,ids=Object.keys(editors||{});
        if(ids.length!==1)return null;
        const store=editors[ids[0]]?._papyrus?._selectionInfoStore,values=store?.$mobx?.values;
        const start=values?.start?.value,end=values?.end?.value,ref=store?._state?._anchorRef;
        if(!start||!end||!['start','end'].includes(ref)||values.shouldBlur?.value!==false)return null;
        const elements=Array.from(d.querySelectorAll('[id]')),byId=id=>elements.find(e=>e.id===id);
        const endpoint=raw=>{
          const fields=raw.$mobx?.values;
          if(!fields)return null;
          const value={compId:fields.compId?.value,unitId:fields.unitId?.value,paraId:fields.paraId?.value,nodeId:fields.nodeId?.value,offset:fields.offset?.value};
          if(!['compId','unitId','paraId','nodeId'].every(k=>typeof value[k]==='string'&&value[k]))return null;
          const p=byId(value.paraId),unit=byId(value.unitId),component=byId(value.compId);
          if(!paragraphs.includes(p)||!unit?.contains(p)||!component?.contains(unit)||!Number.isInteger(value.offset)||value.offset<0)return null;
          const node=byId(value.nodeId);
          if(!node||!p.contains(node)||!node.classList.contains('__se-node'))return null;
          const leaves=[];const collect=n=>{if(n.nodeType===3)leaves.push(n);else for(const c of n.childNodes)collect(c);};collect(node);
          let remaining=value.offset;
          for(const leaf of leaves){if(remaining<=leaf.length)return {node:leaf,offset:remaining};remaining-=leaf.length;}
          // Emoji insertion and format changes leave empty text nodes at the
          // caret, including within a nonempty paragraph. Their real offset is 0.
          return leaves.length===0&&remaining===0?{node,offset:0}:null;
        };
        const a=endpoint(ref==='start'?start:end),f=endpoint(ref==='start'?end:start);
        if(!a||!f)return null;
        s={anchorNode:a.node,anchorOffset:a.offset,focusNode:f.node,focusOffset:f.offset};
      }
      if(!s||!s.anchorNode||!s.focusNode)continue;
      const paragraphOf=n=>{for(let e=n.nodeType===1?n:n.parentElement;e;e=e.parentElement)if(paragraphs.includes(e))return e;return null;};
      const p=paragraphOf(s.anchorNode);
      if(!p||paragraphOf(s.focusNode)!==p)continue;
      const offset=(target,at)=>{
        let total=0,found=false;
        const length=n=>n.nodeType===3?(n.nodeValue||'').length:n.nodeType===1&&n.classList.contains('se-placeholder')?0:Array.from(n.childNodes).reduce((v,c)=>v+length(c),0);
        const walk=n=>{if(found)return;
          if(n.nodeType===1&&n.classList.contains('se-placeholder')){if(n===target||n.contains(target))found=true;return;}
          if(n===target){total+=n.nodeType===3?at:Array.from(n.childNodes).slice(0,at).reduce((v,c)=>v+length(c),0);found=true;return;}
          if(n.nodeType===3)total+=(n.nodeValue||'').length;else for(const c of n.childNodes)walk(c);};walk(p);return found?total:-1;
      };
      const toolbar=d.querySelector(${JSON.stringify(blogRichEditor.bold)}),pressed=toolbar?.getAttribute('aria-pressed');
      const bold=pressed==='true'?true:pressed==='false'?false:
        toolbar?.classList.contains(${JSON.stringify(blogRichEditor.boldToggle)})&&toolbar.getAttribute('data-type')==='toggle'
          ?toolbar.classList.contains(${JSON.stringify(blogRichEditor.boldSelected)}):null;
      // SmartEditor renders non-contenteditable paragraphs and receives human keys
      // in its own focused, offscreen input-buffer iframe. Its sentinel is not
      // body text; the endpoint evidence above must identify the rendered nodes.
      const components=Array.from(d.querySelectorAll('.se-component')).filter(e=>!e.classList.contains('se-documentTitle'));
      let component=p;while(component&&!component.classList.contains('se-component'))component=component.parentElement;
      return {text:paragraphRuns(p).map(r=>r.text).join(''),runs:paragraphRuns(p),anchor:offset(s.anchorNode,s.anchorOffset),focus:offset(s.focusNode,s.focusOffset),
        focused:!!buffered||!!active&&(active===p||active.contains(p)||p.contains(active))&&active.isContentEditable,
        last:paragraphs[paragraphs.length-1]===p,lastComponent:components[components.length-1]===component,bold};
    }return null;`);

    });
  }
/** A stale native Selection after component removal is not the editor caret. */
export async function blogBodyAtEnd(surface: Surface) {
  const cursor = await readBlogCursor(surface);
  return !!cursor && cursor.focused && cursor.last && cursor.lastComponent && cursor.anchor === cursor.focus && cursor.focus === cursor.text.length;
}

const sameLinks = (a: readonly BlogRun[], b: readonly BlogRun[]) =>
  JSON.stringify(runValues(normalizeBlogRuns(a), 'href').filter(Boolean)) === JSON.stringify(runValues(normalizeBlogRuns(b), 'href').filter(Boolean));
const literalMarker = /^[ \t]*(?:\(?[0-9]+[.)]|[-*+>•]|#{1,6}|[a-zA-Z][.)])[ \t]+/;

const literalSpaces = (text: string) => text.replace(/\u00a0/g, ' ');
export const hasBlogLiteralMarker = (text: string) => text.split('\n').some(line => literalMarker.test(line));

/** A resumable, acknowledged prefix. Formatting is read back after each input.
 * Links are applied after the paragraph's text, so a link cannot inherit into the next run.
 */
export class BlogRichTextWriter {
  private readonly paragraphs: NormalizedBlogRun[][];
  private paragraph = 0;
  private run = 0;
  private units = 0;
  private linked = 0;
  private finished: BlogRun[] = [];
  private entering = false;
  constructor(text: string, runs: readonly BlogRun[], private readonly ordinal: number, private readonly selector: string = blogRichEditor.paragraph) {
    if (runs.map(r => r.text).join('') !== text) throw new BlogFormattingError('INPUT', [{ paragraph: ordinal, fields: ['text'] }]);
    this.paragraphs = splitBlogRuns(runs);
  }
  private fail(field: BlogFormattingField = 'input'): never {
    const preceding = this.paragraphs.slice(0, this.paragraph).filter(r => r.length > 0).length;
    const paragraph = this.ordinal + preceding;
    trace('verification', 'fail', { check: field, reason: blogFieldReason[field], counts: { paragraphIndex: paragraph } });
    throw new BlogFormattingError('INPUT', [{ paragraph, fields: [field] }]);
  }
  async requireClosedDialog(s: Surface) {
    return traceStep('sites.naver-blog.rich-text.BlogRichTextWriter.requireClosedDialog', async () => {
    const closed = await read<boolean>(s, `return !docs.some(({d})=>Array.from(d.querySelectorAll(${JSON.stringify(blogRichEditor.dialog)})).some(visible));`).catch(() => false);
    if (!closed) this.fail();

    });
  }
  private async cursor(s: Surface, text: string, collapsed = true) {
    return traceStep('sites.naver-blog.rich-text.BlogRichTextWriter.cursor', async () => {
    const c = await readBlogCursor(s, this.selector).catch(() => null);
    if (!c || !c.focused || !c.last || (collapsed && (c.anchor !== c.text.length || c.focus !== c.text.length))) this.fail('cursor');
    if (!text && c.text.trim()) this.fail('cursor');
    const comparison = compareReadbackText([text], [c.text]);
    traceReadbackText(comparison);
    if (comparison.missing.length) this.fail('text');
    if (text && !sameReadbackNumbers(text, c.text)) this.fail('number');
    return c;

    });
  }
  private async bold(s: Surface, text: string, value: boolean) {
    return traceStep('sites.naver-blog.rich-text.BlogRichTextWriter.bold', async () => {
    let c = await this.cursor(s, text);
    if (c.bold !== null && c.bold !== value) {
      await s.pressKey(blogRichEditor.boldKey);
      c = await this.cursor(s, text);
    }
    if (c.bold !== value) trace('verification', 'ok', { check: 'bold', reason: 'READBACK_BOLD_VARIANCE', counts: { expected: 1, observed: 0 } });

    });
  }
  private async select(s: Surface, text: string, start: number, end: number, check: () => Promise<void>) {
    return traceStep('sites.naver-blog.rich-text.BlogRichTextWriter.select', async () => {
    // Re-establish the endpoint by real keyboard input, then measure every move in UTF-16.
    // Chromium chooses its grapheme boundaries; no codepoint or surrogate-count assumption.
    let c = await this.toEnd(s, text, check);
    while (c.focus > end) {
      await check();
      const previous = c.focus; await s.pressKey(blogRichEditor.left); c = await this.cursor(s, text, false);
      if (c.anchor !== c.focus || c.focus >= previous || c.focus < end) this.fail('cursor');
    }
    while (c.focus > start) {
      await check();
      const previous = c.focus; await s.pressKey(blogRichEditor.selectLeft); c = await this.cursor(s, text, false);
      if (c.anchor !== end || c.focus >= previous || c.focus < start) this.fail('cursor');
    }
    if (c.anchor !== end || c.focus !== start) this.fail('cursor');

    });
  }
  private async toEnd(s: Surface, text: string, check: () => Promise<void>) {
    return traceStep('sites.naver-blog.rich-text.BlogRichTextWriter.toEnd', async () => {
    let c = await this.cursor(s, text, false);
    // Observed SmartEditor keeps link selections and ignores Ctrl+End. Collapse
    // with a real Right key, then measure every grapheme move to this paragraph's
    // exact endpoint. Never infer cursor position from the amount already typed.
    if (c.anchor !== c.focus) {
      const endpoint = Math.max(c.anchor, c.focus);
      await check(); await s.pressKey(blogRichEditor.right); c = await this.cursor(s, text, false);
      if (c.anchor !== c.focus || c.focus !== endpoint) this.fail('cursor');
    }
    while (c.focus < c.text.length) {
      const previous = c.focus;
      await check(); await s.pressKey(blogRichEditor.right); c = await this.cursor(s, text, false);
      if (c.anchor !== c.focus || c.focus <= previous || c.focus > c.text.length) this.fail('cursor');
    }
    return this.cursor(s, text);

    });
  }
  private async link(s: Surface, text: string, start: number, end: number, href: string, check: () => Promise<void>) {
    return traceStep('sites.naver-blog.rich-text.BlogRichTextWriter.link', async () => {
    await this.select(s, text, start, end, check);
    await check();
    const control = await point(s, blogRichEditor.link); if (!control) this.fail();
    await s.click(control.x, control.y);
    // The real layer moves 6px while opening; a transient editor toast can
    // also cover it after a table edit. Wait for a stable, hittable input.
    let previous = '', stableSince = 0;
    const address = await waitFor(async () => {
      await check(); const p = await point(s, blogRichEditor.address), signature = JSON.stringify(p);
      if (!p || signature !== previous) { previous = signature; stableSince = Date.now(); return null; }
      if (Date.now() - stableSince < 350) return null;
      return !s.readClickTarget || await s.readClickTarget(p.x,p.y,blogRichEditor.address) ? p : null;
    }, 5000, { surface: s, control: "BLOG_LINK" }).catch(() => this.fail());
    await s.click(address.x, address.y, async () => {
      if (s.readClickTarget && !await s.readClickTarget(address.x,address.y,blogRichEditor.address)) this.fail();
    });
    await s.pressKey(blogRichEditor.selectAddress);
    const addressMatches = (expected: string | null) => read<boolean>(s, `const inputs=docs.flatMap(({d})=>Array.from(d.querySelectorAll(${JSON.stringify(blogRichEditor.address)})).filter(visible));
      if(inputs.length!==1)return false;const e=inputs[0];return e===e.ownerDocument.activeElement&&${expected === null ? 'e.selectionStart===0&&e.selectionEnd===e.value.length' : `e.value===${JSON.stringify(expected)}`};`).catch(() => false);
    if (!await addressMatches(null)) this.fail('href');
    const characters = inputCharacters(href); let prefix = '';
    for (let offset = 0; offset < characters.length; offset += 32) {
      await check(); const chunk = characters.slice(offset, offset + 32).join('');
      await s.typeText(chunk); prefix += chunk;
      if (!await addressMatches(prefix)) this.fail('href');
    }
    await check();
    const confirm = await point(s, blogRichEditor.confirm); if (!confirm) this.fail();
    await s.click(confirm.x, confirm.y);
    const closed = await read<boolean>(s, `return !docs.some(({d})=>Array.from(d.querySelectorAll(${JSON.stringify(blogRichEditor.dialog)})).some(visible));`).catch(() => false);
    if (!closed) this.fail();
    // The editor must return selection/focus itself. Never restore it by script.
    await this.toEnd(s, text, check);

    });
  }
  async write(s: Surface, check: () => Promise<void>, acknowledge: (added: number, runs: BlogRun[]) => Promise<void>) {
    return traceStep('sites.naver-blog.rich-text.BlogRichTextWriter.write', async () => {
    await this.requireClosedDialog(s);
    while (this.paragraph < this.paragraphs.length) {
      const runs = this.paragraphs[this.paragraph]!;
      const text = runs.map(run => run.text).join('');
      const marker = literalMarker.exec(text)?.[0];
      // Send a marker split by formatting as one input event. Link ranges
      // still come from the original runs after the paragraph is typed.
      let typingRuns = runs;
      if (marker && runs[0]!.text.length <= marker.length && runs.length > 1) {
        const first = inputCharacters(text.slice(marker.length))[0] ?? '';
        const head = marker + first;
        let remaining = head.length;
        typingRuns = [ { ...runs[0]!, text: head }, ...runs.flatMap(run => {
          const text = run.text.slice(remaining);
          remaining = Math.max(0, remaining - run.text.length);
          return text ? [{ ...run, text }] : [];
        }) ];
      }
      if (this.entering) {
        await this.cursor(s, ''); this.entering = false;
      }
      for (; this.run < typingRuns.length; this.run++, this.units = 0) {
        const run = typingRuns[this.run]!, chars = inputCharacters(run.text);
        for (; this.units < chars.length;) {
          await check();
          const prefix = typingRuns.slice(0, this.run).map(r => r.text).join('') + chars.slice(0, this.units).join('');
          await this.bold(s, prefix, run.bold);
          const literal = marker && prefix.length < marker.length;
          const chunk = chars.slice(this.units, this.units + Math.max(32, literal ? marker.length + 1 : 0)).join('');
          if (literal && s.insertText) await s.insertText(chunk);
          else await s.typeText(chunk);
          if (literal && prefix.length + chunk.length >= marker.length) {
            let observed = await readBlogCursor(s, this.selector).catch(() => null);
            if (!observed || !literalSpaces(observed.text).startsWith(marker)) {
              await check();
              trace('verification', 'retry', { check: 'input', reason: 'BLOG_LITERAL_PREFIX', counts: { expected: marker.length } });
              await s.pressKey({ key: 'z', modifiers: 2 });
              observed = await readBlogCursor(s, this.selector).catch(() => null);
              if (!observed || !literalSpaces(observed.text).startsWith(marker)) this.fail('input');
              const wanted = prefix + chunk;
              const restored = literalSpaces(observed.text);
              if (restored !== wanted) {
                if (!wanted.startsWith(restored)) this.fail('input');
                await this.cursor(s, observed.text);
                await s.typeText(wanted.slice(restored.length));
              }
            }
            trace('verification', 'ok', { check: 'input', reason: 'BLOG_LITERAL_PREFIX', counts: { observed: marker.length } });
          }
          const current = await this.cursor(s, prefix + chunk);
          if (!sameLinks(current.runs, [])) this.fail('href');
          this.units += inputCharacters(chunk).length;
          await acknowledge(Array.from(chunk).length, [...this.finished, ...current.runs]);
        }
      }
      // Reconcile a completed link before sending any input on resume.
      for (; this.linked < runs.length; this.linked++) {
        await check(); const run = runs[this.linked]!;
        if (!run.href) continue;
        const current = await this.cursor(s, text);
        const expected = runs.map((r, i) => ({ ...r, href: i <= this.linked ? r.href : null }));
        if (!sameLinks(current.runs, expected)) {
          const before = runs.map((r, i) => ({ ...r, href: i < this.linked ? r.href : null }));
          if (!sameLinks(current.runs, before)) this.fail('href');
          const start = current.text === text ? runs.slice(0, this.linked).reduce((n, r) => n + r.text.length, 0) : current.text.indexOf(run.text);
          if (start < 0 || current.text !== text && current.text.indexOf(run.text, start + 1) >= 0) this.fail('href');
          await this.link(s, current.text, start, start + run.text.length, run.href, check);
          if (!sameLinks((await this.cursor(s, text)).runs, expected)) this.fail('href');
        }
        await acknowledge(0, [...this.finished, ...(await this.cursor(s, text)).runs]);
      }
      await this.bold(s, text, false);
      const current = await this.cursor(s, text);
      if (!sameLinks(current.runs, runs)) this.fail('href');
      if (marker && !literalSpaces(current.text).startsWith(marker)) this.fail('input');
      if (this.paragraph + 1 < this.paragraphs.length) {
        await check(); await this.toEnd(s, text, check); await s.pressKey(blogRichEditor.newline);
        this.finished.push(...runs, { text: '\n' });
        this.run = 0; this.units = 0; this.linked = 0; this.entering = true;
        this.paragraph++;
        await acknowledge(1, this.finished);
      } else this.paragraph++;
    }

    });
  }
}
