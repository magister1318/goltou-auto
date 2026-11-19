import type { Surface } from '@goltou/surface';
import { reasonCode, trace } from '@goltou/surface/telemetry';
import { read, waitFor } from '../dom';

const region = '._appUsagePromptModalRegion.modalLayerView';
const enabled = ':not(:disabled,[aria-disabled="true"])';
const controls = {
  web: { selector: `${region} button${enabled}`, text: '모바일 웹에서 계속하기', id: 'BAND_APP_PROMPT_WEB' },
  close: { selector: `${region} button._closeBtn${enabled}`, text: '닫기', id: 'BAND_APP_PROMPT_CLOSE' },
} as const;
const step = 'sites.band.app-prompt';
export const bandAppPromptFailure = 'BAND_APP_PROMPT_NOT_DISMISSED';
type Point = { x: number; y: number };
type Prompt = { active: false } | { active: true; kind?: keyof typeof controls; points?: Point[] };

function observePrompt(surface: Surface) {
  return read<Prompt>(surface, `
    const regions = Array.from(document.querySelectorAll(${JSON.stringify(region)})).filter(root =>
      Array.from(root.querySelectorAll('[class*="modalWrap"],button')).some(visible));
    if (!regions.length) return {active:false};
    if (regions.length !== 1) return {active:true};
    const root = regions[0];
    const web = Array.from(root.querySelectorAll('button')).filter(b =>
      (b.textContent || '').trim() === ${JSON.stringify(controls.web.text)});
    const kind = web.length ? 'web' : 'close';
    const candidates = web.length ? web : Array.from(root.querySelectorAll('button._closeBtn')).filter(b =>
      (b.textContent || '').trim() === ${JSON.stringify(controls.close.text)});
    const button = candidates[0];
    if (candidates.length !== 1 || !visible(button) || button.disabled || button.getAttribute('aria-disabled') === 'true') return {active:true};
    const r = button.getBoundingClientRect();
    const fractions = kind === 'close' ? [[.5,.5],[.1,.1],[.9,.1],[.1,.9],[.9,.9]] : [[.5,.5]];
    const points = fractions.map(([fx,fy]) => ({x:r.left+r.width*fx,y:r.top+r.height*fy}))
      .filter(({x,y}) => x > 0 && x < innerWidth && y > 0 && y < innerHeight);
    return {active:true, kind, points};`);
}

/** Clear the known top-level BAND prompt using real input on the expected route. */
export async function dismissBandAppPrompt(surface: Surface, expectedUrl: string, check = () => {}) {
  check();
  if (await surface.readDialog?.()) return;
  const prompt = await observePrompt(surface);
  if (!prompt.active) return;
  trace(step, 'start', { counts: { observed: 1 } });
  const control = prompt.kind && controls[prompt.kind];
  const expected = new URL(expectedUrl);
  const guard = async () => {
    check();
    if (await surface.readDialog?.()) throw Error('USER_DIALOG_REQUIRED');
    const actual = new URL((await surface.readState()).url);
    const serviceOrigins = ['https://band.us', 'https://www.band.us'];
    const sameOrigin = actual.origin === expected.origin || serviceOrigins.includes(expected.origin) && serviceOrigins.includes(actual.origin);
    if (!sameOrigin || actual.pathname.replace(/\/$/, '') !== expected.pathname.replace(/\/$/, '')) throw Error(bandAppPromptFailure);
  };
  try {
    if (!control || !prompt.points?.length || !surface.readClickTarget) throw Error(bandAppPromptFailure);
    const hit = (p: Point) => surface.readClickTarget!(p.x, p.y, control.selector, { exactText: control.text });
    await guard();
    let point: Point | undefined;
    for (const p of prompt.points) {
      if (await hit(p)) { point = p; break; }
    }
    if (!point) throw Error(bandAppPromptFailure);
    const { x, y } = point;
    const recheck = async () => {
      await guard();
      const current = await observePrompt(surface);
      if (!current.active || current.kind !== prompt.kind ||
        !current.points?.some(p => p.x === x && p.y === y) || !await hit({ x, y })) throw Error(bandAppPromptFailure);
    };
    trace(step, 'wait', { selector: control.id });
    await surface.click(x, y, recheck);
    await waitFor(async () => {
      await guard();
      return !(await observePrompt(surface)).active;
    }, 3000, { surface, control: control.id });
    trace(step, 'ok', { selector: control.id, counts: { observed: 0 } });
  } catch (error) {
    const failure = reasonCode(error) === 'OBSERVATION_TIMEOUT' ? Error(bandAppPromptFailure) : error;
    trace(step, 'fail', { ...(control && { selector: control.id }), reason: reasonCode(failure) });
    throw failure;
  }
}
