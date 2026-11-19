import type { Surface, ViewportRect } from '@goltou/surface';
import { reasonCode, trace } from '@goltou/surface/telemetry';
import { bandWriteHitClasses, bandWriteHitLabels, type BandWriteCandidateDiagnostic, type BandWriteDiagnostic } from '../../../surface/src/band-write-diagnostics';
import { read, waitFor } from '../dom';

export const bandWrite = 'button._btnPostWrite, button._btnOpenWriteLayer';
const writeControls = [
  { kind: 'legacyFloating', selector: 'button.uFloatingButton._btnPostWrite[aria-label="글쓰기"]' },
  { kind: 'legacyText', selector: bandWrite, exactText: '글쓰기' },
  { kind: 'labelled', selector: 'button._btnPostWrite[aria-label="글쓰기"], button._btnOpenWriteLayer[aria-label="글쓰기"]' },
] as const;
const eligibleControl = ':not(:disabled,[aria-disabled="true"],._btnPostSubmit,._btnSubmitPost,.postWriteSection *,[role="dialog"] *,[role="alertdialog"] *)';
const writeControlId = 'BAND_WRITE_CONTROL';
type WriteControl = typeof writeControls[number];
type Point = { x: number; y: number; rect: ViewportRect };
type CandidateGroup = { summary: BandWriteCandidateDiagnostic; points: Point[] };

function observeWriteControls(surface: Surface, editor: string) {
  const hasHitTest = !!surface.readClickTarget;
  return read<{ composer: boolean; groups: CandidateGroup[] }>(surface, `
    const composer = docs.some(({d}) => Array.from(d.querySelectorAll(${JSON.stringify(editor)})).some(visible));
    const inside = (x,y) => x > 0 && y > 0 && x < innerWidth && y < innerHeight;
    const groups = ${JSON.stringify(writeControls)}.map(({selector,exactText}) => {
      const summary = {matches:0,visible:0,textMatches:0,ariaMatches:0,inViewport:0,eligible:0,readClickTarget:'not_checked'};
      const points = [];
      for (const {d,x,y} of docs) {
        const eligible = Array.from(d.querySelectorAll(':is(' + selector + ')' + ${JSON.stringify(eligibleControl)}));
        for (const e of d.querySelectorAll(selector)) {
          summary.matches++;
          const textMatches = (e.textContent || '').trim() === '글쓰기';
          if (textMatches) summary.textMatches++;
          if (e.getAttribute('aria-label') === '글쓰기') summary.ariaMatches++;
          if (!visible(e)) continue;
          summary.visible++;
          const r = e.getBoundingClientRect(), cx = x+r.left+r.width/2, cy = y+r.top+r.height/2;
          const centerInViewport = inside(cx,cy);
          if (centerInViewport) summary.inViewport++;
          if (composer || (exactText && !textMatches) || !eligible.includes(e)) continue;
          summary.eligible++;
          const rect = {x:x+r.left,y:y+r.top,width:r.width,height:r.height};
          if (centerInViewport) points.push({x:cx,y:cy,rect});
          if (!${hasHitTest}) continue;
          const left = Math.max(0,x+r.left), right = Math.min(innerWidth,x+r.right);
          const top = Math.max(0,y+r.top), bottom = Math.min(innerHeight,y+r.bottom);
          if (left >= right || top >= bottom) continue;
          if (!centerInViewport) points.push({x:(left+right)/2,y:(top+bottom)/2,rect});
          for (const [fx,fy] of [[.25,.5],[.75,.5],[.5,.25],[.5,.75]]) {
            points.push({x:left+(right-left)*fx,y:top+(bottom-top)*fy,rect});
          }
        }
      }
      return {summary,points};
    });
    return {composer,groups};`);
}

export async function waitForBandWrite(surface: Surface, editor: string, guard: () => Promise<void>) {
  const bandWrite: BandWriteDiagnostic = {};
  let loggedMiss = false;
  async function hits(at: Point, control: WriteControl, summary: BandWriteCandidateDiagnostic) {
    if (!surface.readClickTarget) { summary.readClickTarget = 'unavailable'; return true; }
    delete summary.rejectedHit;
    delete summary.candidateRect;
    delete summary.scrollX;
    delete summary.scrollY;
    try {
      const hit = await surface.readClickTarget(at.x, at.y, `:is(${control.selector})${eligibleControl}`, {
        ...('exactText' in control ? { exactText: control.exactText } : {}),
        onMiss: {
          classes: bandWriteHitClasses, ariaLabels: bandWriteHitLabels,
          report: ({ scrollX, scrollY, rejectedHit }) => {
            summary.scrollX = scrollX;
            summary.scrollY = scrollY;
            if (rejectedHit) summary.rejectedHit = rejectedHit;
          },
        },
      });
      summary.readClickTarget = hit ? 'match' : 'miss';
      if (!hit) summary.candidateRect = at.rect;
      return hit;
    } catch (error) {
      summary.readClickTarget = 'error';
      trace('sites.band.write-control', 'fail', { selector: writeControlId, bandWrite, reason: reasonCode(error) });
      throw error;
    }
  }
  try {
    return await waitFor(async () => {
      await guard();
      const { composer, groups } = await observeWriteControls(surface, editor);
      if (composer) throw Error('BAND_EXISTING_COMPOSER');
      writeControls.forEach(({ kind }, i) => { bandWrite[kind] = groups[i]!.summary; });
      for (const [i, control] of writeControls.entries()) {
        const { summary, points } = groups[i]!;
        for (const at of points) {
          if (await hits(at, control, summary)) {
            return {
              x: at.x, y: at.y,
              async recheck() {
                await guard();
                const composerPresent = await read<boolean>(surface, `return docs.some(({d}) => Array.from(d.querySelectorAll(${JSON.stringify(editor)})).some(visible));`);
                if (composerPresent) throw Error('BAND_EXISTING_COMPOSER');
                if (await hits(at, control, summary)) return;
                trace('sites.band.write-control', 'fail', { selector: writeControlId, bandWrite, reason: 'BAND_COMPOSER_UNAVAILABLE' });
                throw Error('BAND_COMPOSER_UNAVAILABLE');
              },
            };
          }
          if (!loggedMiss) {
            trace('sites.band.write-control', 'retry', { selector: writeControlId, bandWrite });
            loggedMiss = true;
          }
        }
      }
      return null;
    }, undefined, { surface, control: writeControlId, diagnostics: () => ({ bandWrite }) });
  } catch (error) {
    if (error instanceof Error && error.message === 'OBSERVATION_TIMEOUT') throw Error('BAND_COMPOSER_UNAVAILABLE');
    throw error;
  }
}
