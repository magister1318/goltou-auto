// Reference: ../refs/DAF/daf3/packages/engine-naver-editor/test/harness/fake-smarteditor.ts (bold toolbar selector only).
import { inputCharacters, type KeyInput, type Surface } from '@goltou/surface';
import { point, read } from '../dom';
import { BlogFormattingError, blogRunReader, normalizeBlogRuns, splitBlogRuns, type BlogRun, type NormalizedBlogRun } from './formatting';

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
  runs: NormalizedBlogRun[]; bold: boolean | null;
}
export async function readBlogCursor(surface: Surface): Promise<Cursor | null> {
  return read(surface, `${blogRunReader}
    for(const {d} of docs){
      const paragraphs=Array.from(d.querySelectorAll(${JSON.stringify(blogRichEditor.paragraph)}));
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
      return {text:paragraphRuns(p).map(r=>r.text).join(''),runs:paragraphRuns(p),anchor:offset(s.anchorNode,s.anchorOffset),focus:offset(s.focusNode,s.focusOffset),
        focused:!!buffered||!!active&&(active===p||active.contains(p)||p.contains(active))&&active.isContentEditable,
        last:paragraphs[paragraphs.length-1]===p,bold};
    }return null;`);
}
const equal = (a: readonly BlogRun[], b: readonly BlogRun[]) => JSON.stringify(normalizeBlogRuns(a)) === JSON.stringify(normalizeBlogRuns(b));

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
  constructor(text: string, runs: readonly BlogRun[], private readonly ordinal: number) {
    if (runs.map(r => r.text).join('') !== text) throw new BlogFormattingError('INPUT', [{ paragraph: ordinal, fields: ['text'] }]);
    this.paragraphs = splitBlogRuns(runs);
  }
  private fail(): never {
    const preceding = this.paragraphs.slice(0, this.paragraph).filter(r => r.length > 0).length;
    throw new BlogFormattingError('INPUT', [{ paragraph: this.ordinal + preceding, fields: ['input'] }]);
  }
  async requireClosedDialog(s: Surface) {
    const closed = await read<boolean>(s, `return !docs.some(({d})=>Array.from(d.querySelectorAll(${JSON.stringify(blogRichEditor.dialog)})).some(visible));`).catch(() => false);
    if (!closed) this.fail();
  }
  private async cursor(s: Surface, text: string, collapsed = true) {
    const c = await readBlogCursor(s).catch(() => null);
    if (!c || !c.focused || !c.last || c.text !== text || (collapsed && (c.anchor !== text.length || c.focus !== text.length))) this.fail();
    return c;
  }
  private async bold(s: Surface, text: string, value: boolean) {
    let c = await this.cursor(s, text);
    if (c.bold === null) this.fail();
    if (c.bold !== value) {
      await s.pressKey(blogRichEditor.boldKey);
      c = await this.cursor(s, text);
      if (c.bold !== value) this.fail();
    }
  }
  private async select(s: Surface, text: string, start: number, end: number, check: () => Promise<void>) {
    // Re-establish the endpoint by real keyboard input, then measure every move in UTF-16.
    // Chromium chooses its grapheme boundaries; no codepoint or surrogate-count assumption.
    let c = await this.toEnd(s, text, check);
    while (c.focus > end) {
      await check();
      const previous = c.focus; await s.pressKey(blogRichEditor.left); c = await this.cursor(s, text, false);
      if (c.anchor !== c.focus || c.focus >= previous || c.focus < end) this.fail();
    }
    while (c.focus > start) {
      await check();
      const previous = c.focus; await s.pressKey(blogRichEditor.selectLeft); c = await this.cursor(s, text, false);
      if (c.anchor !== end || c.focus >= previous || c.focus < start) this.fail();
    }
    if (c.anchor !== end || c.focus !== start) this.fail();
  }
  private async toEnd(s: Surface, text: string, check: () => Promise<void>) {
    let c = await this.cursor(s, text, false);
    // Observed SmartEditor keeps link selections and ignores Ctrl+End. Collapse
    // with a real Right key, then measure every grapheme move to this paragraph's
    // exact endpoint. Never infer cursor position from the amount already typed.
    if (c.anchor !== c.focus) {
      const endpoint = Math.max(c.anchor, c.focus);
      await check(); await s.pressKey(blogRichEditor.right); c = await this.cursor(s, text, false);
      if (c.anchor !== c.focus || c.focus !== endpoint) this.fail();
    }
    while (c.focus < text.length) {
      const previous = c.focus;
      await check(); await s.pressKey(blogRichEditor.right); c = await this.cursor(s, text, false);
      if (c.anchor !== c.focus || c.focus <= previous || c.focus > text.length) this.fail();
    }
    return this.cursor(s, text);
  }
  private async link(s: Surface, text: string, start: number, end: number, href: string, check: () => Promise<void>) {
    await this.select(s, text, start, end, check);
    await check();
    const control = await point(s, blogRichEditor.link); if (!control) this.fail();
    await s.click(control.x, control.y);
    const address = await point(s, blogRichEditor.address); if (!address) this.fail();
    await s.click(address.x, address.y); await s.pressKey(blogRichEditor.selectAddress);
    const addressMatches = (expected: string | null) => read<boolean>(s, `const inputs=docs.flatMap(({d})=>Array.from(d.querySelectorAll(${JSON.stringify(blogRichEditor.address)})).filter(visible));
      if(inputs.length!==1)return false;const e=inputs[0];return e===e.ownerDocument.activeElement&&${expected === null ? 'e.selectionStart===0&&e.selectionEnd===e.value.length' : `e.value===${JSON.stringify(expected)}`};`).catch(() => false);
    if (!await addressMatches(null)) this.fail();
    const characters = inputCharacters(href); let prefix = '';
    for (let offset = 0; offset < characters.length; offset += 32) {
      await check(); const chunk = characters.slice(offset, offset + 32).join('');
      await s.typeText(chunk); prefix += chunk;
      if (!await addressMatches(prefix)) this.fail();
    }
    await check();
    const confirm = await point(s, blogRichEditor.confirm); if (!confirm) this.fail();
    await s.click(confirm.x, confirm.y);
    const closed = await read<boolean>(s, `return !docs.some(({d})=>Array.from(d.querySelectorAll(${JSON.stringify(blogRichEditor.dialog)})).some(visible));`).catch(() => false);
    if (!closed) this.fail();
    // The editor must return selection/focus itself. Never restore it by script.
    await this.toEnd(s, text, check);
  }
  async write(s: Surface, check: () => Promise<void>, acknowledge: (added: number, runs: BlogRun[]) => Promise<void>) {
    await this.requireClosedDialog(s);
    while (this.paragraph < this.paragraphs.length) {
      const runs = this.paragraphs[this.paragraph]!;
      if (this.entering) {
        await this.cursor(s, ''); this.entering = false;
      }
      for (; this.run < runs.length; this.run++, this.units = 0) {
        const run = runs[this.run]!, chars = inputCharacters(run.text);
        for (; this.units < chars.length;) {
          await check();
          const prefix = runs.slice(0, this.run).map(r => r.text).join('') + chars.slice(0, this.units).join('');
          await this.bold(s, prefix, run.bold);
          const chunk = chars.slice(this.units, this.units + 32).join('');
          await s.typeText(chunk);
          const current = await this.cursor(s, prefix + chunk);
          const expected = [...runs.slice(0, this.run).map(r => ({ ...r, href: null })), { ...run, text: chars.slice(0, this.units).join('') + chunk, href: null }];
          if (!equal(current.runs, expected)) this.fail();
          this.units += inputCharacters(chunk).length;
          await acknowledge(Array.from(chunk).length, [...this.finished, ...current.runs]);
        }
      }
      const text = runs.map(r => r.text).join('');
      // Reconcile a completed link before sending any input on resume.
      for (; this.linked < runs.length; this.linked++) {
        await check(); const run = runs[this.linked]!;
        if (!run.href) continue;
        const current = await this.cursor(s, text);
        const expected = runs.map((r, i) => ({ ...r, href: i <= this.linked ? r.href : null }));
        if (!equal(current.runs, expected)) {
          const before = runs.map((r, i) => ({ ...r, href: i < this.linked ? r.href : null }));
          if (!equal(current.runs, before)) this.fail();
          const start = runs.slice(0, this.linked).reduce((n, r) => n + r.text.length, 0);
          await this.link(s, text, start, start + run.text.length, run.href, check);
          if (!equal((await this.cursor(s, text)).runs, expected)) this.fail();
        }
        await acknowledge(0, [...this.finished, ...(await this.cursor(s, text)).runs]);
      }
      await this.bold(s, text, false);
      if (!equal((await this.cursor(s, text)).runs, runs)) this.fail();
      if (this.paragraph + 1 < this.paragraphs.length) {
        await check(); await this.toEnd(s, text, check); await s.pressKey(blogRichEditor.newline);
        this.finished.push(...runs, { text: '\n' });
        this.run = 0; this.units = 0; this.linked = 0; this.entering = true;
        this.paragraph++;
        await acknowledge(1, this.finished);
      } else this.paragraph++;
    }
  }
}
