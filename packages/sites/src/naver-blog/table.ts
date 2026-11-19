// Reference: ../refs/DAF/daf3/packages/engine-naver-editor/src/insert/info-table.ts (toolbar/control selectors only; live observations and input-only implementation).
import type { Surface } from '@goltou/surface';
import { trace, reasonCode, type ReasonCode } from '@goltou/surface/telemetry';
import { point, read, sleep, waitFor } from '../dom';
import { type BlogRun } from './formatting';
import { BlogRichTextWriter } from './rich-text';

export interface BlogTable { rows: string[][]; cellRuns?: BlogRun[][][] }
export interface BlogTableToken extends BlogTable { kind: 'table'; merged?: boolean }
export function tableRowRuns(table: BlogTable, row: number): BlogRun[] {
  return table.rows[row]!.flatMap((text, column) => [...(column ? [{ text: ' | ' }] : []), ...(table.cellRuns?.[row]?.[column] ?? [{ text }])]);
}
export function exactBlogTable(expected: BlogTable, actual: BlogTableToken | undefined) {
  return !!actual && !actual.merged && expected.rows.length === actual.rows.length &&
    expected.rows.every((row, r) => row.length === actual.rows[r]!.length);
}

/** Observed on the device: immediate 3x3; select row/column -> cell menu delete.
 * Selectors overlap the resize handles: use the outer 1px edge, with a hit check.
 * All content and selection changes use human mouse/keyboard input only. */
export async function insertBlogTable(surface: Surface, table: BlogTable, hooks: {
  check(): Promise<void>; snapshot(): Promise<unknown>; restoreEnd(): Promise<void>; acknowledge(added: number): void;
}): Promise<'native' | 'text-list'> {
  const s = surface, originalValue = await hooks.snapshot(), original = JSON.stringify(originalValue);
  const ids = () => read<string[]>(s, `return docs.flatMap(({d})=>Array.from(d.querySelectorAll('.se-component.se-table')).map(e=>e.id));`);
  const before = await ids(); let owned = '', reason: ReasonCode = 'TABLE_TOOL_MISSING';
  const scope = () => `.se-component.se-table[id=${JSON.stringify(owned)}]`;
  const shape = () => read<number[]>(s, `const t=docs.map(({d})=>d.querySelector(${JSON.stringify(scope())})).find(Boolean);return Array.from(t?.querySelectorAll('tr')||[]).map(r=>r.querySelectorAll('td,th').length);`);
  const press = async (selector: string, edge?: 'row' | 'column' | 'all' | 'bottom') => {
    await hooks.check();
    await waitFor(async () => {
      await hooks.check();
      const at = await read<{x:number;y:number;height:number}|null>(s, `for(const {d,x,y} of docs){const e=d.querySelector(${JSON.stringify(selector)});if(!e||!visible(e))continue;const r=e.getBoundingClientRect();return {x:x+r.left+${edge === 'row' || edge === 'all' ? '1' : 'r.width/2'},y:y+r.top+${edge === 'column' || edge === 'all' ? '1' : edge === 'bottom' ? 'Math.min(20,r.height/2)' : 'r.height/2'},height:innerHeight};}return null;`);
      if (!at) return null;
      if (at.y <= 0 || at.y >= at.height) { await s.pressKey({key:at.y<=0?'PageUp':'PageDown'}); return null; }
      if (at.x <= 0 || s.readClickTarget && !await s.readClickTarget(at.x,at.y,selector)) return null;
      let confirmed = false;
      try {
        await s.click(at.x,at.y,async()=>{
          if(s.readClickTarget&&!await s.readClickTarget(at.x,at.y,selector)) throw Error('TABLE_CONTROL_MISSING');
          confirmed = true;
        });
      } catch(error) {
        // Only hover happened when this check refused the press. The editor
        // can scroll/reposition a newly inserted table between these reads.
        if(!confirmed&&error instanceof Error&&error.message==='TABLE_CONTROL_MISSING') return null;
        throw error;
      }
      return true;
    }, 5000, { surface, control: "BLOG_TABLE" });
    await sleep(150);
  };
  const activate = () => press(`${scope()} tr:first-child td:first-child .se-text-paragraph`);
  trace('table_insert_started', 'start');
  trace('table_size', 'ok', { counts: { rows: table.rows.length, columns: table.rows[0]?.length ?? 0 } });
  try {
    const columns = table.rows[0]?.length ?? 0;
    if (!columns || !table.rows.length || table.rows.some(row => row.length !== columns)) { reason = 'TABLE_SHAPE_UNSUPPORTED'; throw Error(reason); }
    const control = await point(s, 'button[data-name="table"]');
    if (!control) throw Error(reason);
    reason = 'TABLE_INSERT_UNCONFIRMED'; await s.click(control.x, control.y, async()=>{if(s.readClickTarget&&!await s.readClickTarget(control.x,control.y,'button[data-name="table"]'))throw Error(reason);});
    const added = await waitFor(async () => { const found = (await ids()).filter(id => !before.includes(id)); return found.length === 1 ? found[0] : null; }, 3500, { surface, control: "BLOG_TABLE" });
    owned = added!;
    reason = 'TABLE_SIZE_MISMATCH';
    let dimensions = await shape();
    if (!dimensions.length || dimensions.some(n => n !== dimensions[0])) throw Error(reason);
    // Resize only the uniquely created component; re-read after every action.
    for (const axis of ['column', 'row'] as const) {
      const wanted = axis === 'column' ? columns : table.rows.length;
      const count = () => axis === 'column' ? dimensions[0]! : dimensions.length;
      for (let attempts = 0; count() !== wanted && attempts < 100; attempts++) {
        const previous = count(); await activate();
        const bar = `${scope()} .se-cell-controlbar-${axis}`;
        if (previous > wanted) {
          await press(`${bar} li:last-child .se-cell-select-button`, axis);
          await press(`${scope()} .se-cell-context-menu-button.se-context-menu-button-delete`);
        } else await press(`${bar} li:last-child .se-cell-add-button`);
        dimensions = await waitFor(async () => { const v = await shape(); return (axis === 'column' ? v[0] : v.length) === previous + (previous > wanted ? -1 : 1) ? v : null; }, 2500, { surface, control: "BLOG_TABLE" });
      }
      if (count() !== wanted) throw Error(reason);
    }
    reason = 'TABLE_CELL_MISMATCH'; let filled = 0;
    for (let r = 0; r < table.rows.length; r++) for (let c = 0; c < columns; c++) {
      await hooks.check();
      const cell = `${scope()} tr:nth-child(${r + 1}) > :nth-child(${c + 1})`;
      const paragraph = `${cell} .se-text-paragraph`;
      for (let n = 0; !await point(s, paragraph) && n < 20; n++) { await s.pressKey({ key: 'PageDown' }); await sleep(100); }
      await press(paragraph);
      const empty = await read<boolean>(s, `const e=docs.map(({d})=>d.querySelector(${JSON.stringify(cell)})).find(Boolean);return !!e&&!Array.from(e.querySelectorAll('.__se-node')).some(n=>n.textContent);`);
      if (!empty) throw Error(reason);
      const text = table.rows[r]![c]!;
      await new BlogRichTextWriter(text, table.cellRuns?.[r]?.[c] ?? [{ text }], 1, paragraph).write(s, hooks.check, async added => { hooks.acknowledge(added); });
      trace('cells_filled', 'ok', { counts: { cells: ++filled } });
    }
    const actual = await hooks.snapshot() as { tokens?: (BlogTableToken | { kind: string })[] };
    const tables = actual.tokens?.filter((t): t is BlogTableToken => t.kind === 'table');
    if (!exactBlogTable(table, tables?.[before.length])) throw Error(reason);
    const prior = originalValue as {tokens:unknown[]};
    if (JSON.stringify(actual.tokens?.slice(0,-1)) !== JSON.stringify(prior.tokens) || actual.tokens?.at(-1)?.kind !== 'table') throw Error(reason);
    reason = 'TABLE_EXIT_UNCONFIRMED';
    // The real editor has no bottom edge button. A click in the native gap
    // beneath the last component creates its next empty text component.
    const next = `${scope()} + .se-component.se-text .se-text-paragraph:last-child`;
    if (await point(s, next)) await press(next);
    else if (await read<boolean>(s, `return docs.some(({d})=>d.querySelector('button.se-canvas-bottom-button'));`)) await press('button.se-canvas-bottom-button','bottom');
    else {
      const gap = await read<{x:number;y:number}|null>(s, `for(const {d,x,y}of docs){const t=d.querySelector(${JSON.stringify(scope())});if(!t||t.nextElementSibling)continue;const r=t.getBoundingClientRect();const px=x+r.left+r.width/2,py=y+r.bottom+12;if(px>0&&py>0&&px<innerWidth&&py<innerHeight)return{x:px,y:py};}return null;`);
      if (!gap) throw Error(reason);
      await s.click(gap.x,gap.y,async()=>{if(s.readClickTarget&&!await s.readClickTarget(gap.x,gap.y,'.se-content, .se-components-wrap'))throw Error(reason);});
    }
    await s.pressKey({ key: 'ArrowDown' }); await hooks.restoreEnd();
    if (JSON.stringify(await hooks.snapshot()) !== JSON.stringify(actual)) throw Error(reason);
    trace('table_verified', 'ok', { counts: { rows: table.rows.length, columns, cells: filled } });
    return 'native';
  } catch {
    await hooks.check();
    try {
    // A missing/ambiguous creation cannot authorize deleting any prior component.
    const added = (await ids()).filter(id => !before.includes(id));
    if (!owned && added.length === 1) owned = added[0]!;
    if (added.length > 1 || added.some(id => id !== owned)) throw Error('TABLE_CLEANUP_UNCONFIRMED');
    try {
      if (owned && added.includes(owned)) {
        await s.pressKey({ key: 'Escape' }); await activate();
        await press(`${scope()} .se-cell-select-all-button`, 'all');
        await press(`${scope()} .se-cell-context-menu-button.se-context-menu-button-delete`);
        await waitFor(async () => !(await ids()).includes(owned), 2500, { surface, control: "BLOG_TABLE" });
      }
    } catch { throw Error('TABLE_CLEANUP_UNCONFIRMED'); }
    if (JSON.stringify(await hooks.snapshot()) !== original) throw Error('TABLE_CLEANUP_UNCONFIRMED');
    await hooks.restoreEnd();
    } catch(error) { trace('table_fallback','fail',{reason:reasonCode(error)}); throw error; }
    trace('table_fallback', 'ok', { reason });
    return 'text-list';
  }
}
