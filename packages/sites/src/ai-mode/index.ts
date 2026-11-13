// Reference: ../refs/DAF/daf3/packages/engine-ai-mode/src/transport/{conversation-browser,conversation-transport}.ts (readiness, input receipts, responseAfterPrompt; Surface-only adaptation).
import type { Surface, SurfaceHost } from '@goltou/surface';
import { sleep } from '../dom';

export const aiUserAgent = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
export const aiUrl = 'https://www.google.com/search?udm=50&hl=ko';
interface Point { x: number; y: number }
interface AiState { blocked: string; input: Point | null; value: string; send: Point | null; generating: boolean; answer: string; receipts: number; body: string; ready: boolean }
export function readAiState(surface: Surface, prompt: string): Promise<AiState> {
  return surface.evaluateReadOnly(`(() => {
    // Gate before reading any input values or page text on credential pages.
    const gate=location.hostname==='accounts.google.com'||Boolean(document.querySelector('input[type="password"],input[type="email"]'))?'AI_LOGIN_REQUIRED':location.hostname==='consent.google.com'?'AI_CONSENT_REQUIRED':/^\\/sorry\\//.test(location.pathname)||Boolean(document.querySelector('#captcha-form,iframe[src*="recaptcha"]'))?'AI_BLOCKED':'';
    const empty={blocked:gate,input:null,value:'',send:null,generating:false,answer:'',receipts:0,body:'',ready:false};
    if(gate)return empty;
    const visible=e=>{const r=e.getBoundingClientRect();return r.width>8&&r.height>8&&getComputedStyle(e).visibility!=='hidden'&&e.getAttribute('aria-hidden')!=='true';};
    const point=e=>{const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};};
    const inputs=Array.from(document.querySelectorAll('textarea,input[name="q"],[contenteditable="true"][role="textbox"]')).filter(visible);
    const input=inputs[inputs.length-1];
    const buttons=Array.from(document.querySelectorAll('button,[role="button"]')).filter(visible);
    const label=e=>(e.getAttribute('aria-label')||e.textContent||'').trim();
    const send=buttons.slice().reverse().find(e=>/^(보내기|질문하기|시작|send|submit|ask)( message)?$/i.test(label(e))&&!e.disabled&&e.getAttribute('aria-disabled')!=='true');
    const copy=buttons.slice().reverse().find(e=>/^(텍스트 복사|Copy text)$/i.test(label(e)));
    const body=document.body?.innerText||'';
    const generating=buttons.some(e=>/^(응답 생성 중지|생성 중지|중지|stop|stop generating|stop response)$/i.test(label(e)))||Boolean(copy&&(copy.disabled||copy.getAttribute('aria-disabled')==='true'))||/AI Mode is processing your query|AI 모드가 쿼리를 처리 중입니다/.test(body);
    const blocked=/Before you continue to Google|Google로 이동하기 전에|Google 서비스를 사용하기 전에/.test(body)?'AI_CONSENT_REQUIRED':/Sign in to (?:use|try) AI Mode|AI 모드를 (?:사용|이용)하려면 로그인|로그인하여 AI 모드/.test(body)?'AI_LOGIN_REQUIRED':/AI Mode (?:is not|isn't) available in your (?:country|region)|(?:거주 국가|현재 지역|해당 국가)에서.{0,30}(?:지원|사용).{0,10}(?:않|없)/i.test(body)?'AI_REGION_UNAVAILABLE':/(?:AI Mode|AI 모드).{0,50}(?:18세 미만|연령 요건|age requirement|under 18)/i.test(body)?'AI_AGE_RESTRICTED':'';
    if(blocked)return {blocked,input:null,value:'',send:null,generating:false,answer:'',receipts:0,body:'',ready:false};
    const prompt=${JSON.stringify(prompt)};
    const normalize=s=>s.replace(/\\s/g,'');
    const receipts=Array.from(document.querySelectorAll('[aria-label]')).filter(e=>{const s=e.getAttribute('aria-label')||'';return /^(복사|수정|Copy|Edit)\\s+/.test(s)&&normalize(s.replace(/^(복사|수정|Copy|Edit)\\s+/,''))===normalize(prompt);}).length+
      Array.from(document.querySelectorAll('h1')).filter(e=>/^(AI 모드 대화:|AI Mode conversation:)/i.test(e.textContent||'')&&normalize((e.textContent||'').replace(/^(AI 모드 대화:|AI Mode conversation:)\\s*/i,''))===normalize(prompt)).length;
    // Copy belongs to the newest answer. Do not accept echoed composer/body text as an answer.
    let answer='';
    if(copy){let region=copy.parentElement;
      while(region&&region!==document.body&&!region.hasAttribute('data-ai-response')&&!region.hasAttribute('data-response-id')&&!region.hasAttribute('data-container-id'))region=region.parentElement;
      if(region&&region!==document.body){
        const text=region.querySelector('[data-answer-text],.markdown,pre');
        if(text)answer=text.innerText;
        else {
          // Live AI Mode renders numbered replies as OL/LI; innerText omits markers.
          // Read the whole answer, including unexpected extra prose (validator rejects it).
          // Exclude only the copy/feedback toolbar, never discard response paragraphs.
          const render=e=>{
            if(e.contains(copy)||e.hasAttribute('data-ignore-copy')||!visible(e))return '';
            if(e.tagName==='OL')return Array.from(e.children).map((li,i)=>String(Number(li.getAttribute('value')||Number(e.getAttribute('start')||1)+i))+'. '+li.innerText.trim()).join('\\n');
            if(e.querySelector('ol'))return Array.from(e.children).map(render).filter(Boolean).join('\\n');
            return e.innerText.trim();
          };
          answer=Array.from(region.children).map(render).filter(Boolean).join('\\n');
        }
      }
    }
    const ready=Boolean(copy)||/AI 모드 대답이 준비되었습니다\\.|AI Mode response is ready\\./.test(body);
    return {blocked,input:input?point(input):null,value:input?String(input.value??input.textContent):'',send:send?point(send):null,generating,answer,receipts,body,ready};
  })()`);
}
export interface AiModeOptions { url?: string; timeoutMs?: number; pollMs?: number; paceMs?: number }
export class AiModeError extends Error {
  constructor(code: string, readonly submitted = false) { super(code); }
}
// A host cannot run simultaneous requests through separate transport instances either.
const busyHosts = new WeakSet<SurfaceHost>();
// Reference: ../refs/DAF/daf3/packages/engine-ai-mode/src/transport/conversation-transport.ts (responseAfterPrompt; bounded numbered-answer cleanup).
export function answerAfterPrompt(body: string, baseline: string, prompt: string): string {
  if (body === baseline) return '';
  let text = baseline && body.startsWith(baseline) ? body.slice(baseline.length) : body;
  const pattern = prompt.split(/\s+/).filter(Boolean).map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*');
  const match = new RegExp(pattern).exec(text);
  if (match) text = text.slice(match.index + match[0].length);
  return text.replace(/^\s*(?:텍스트 복사|Copy text|AI 모드 대답이 준비되었습니다\.|AI Mode response is ready\.)\s*$/gm, '').trim();
}
export function aiModeTransport(host: SurfaceHost, options: AiModeOptions = {}) {
  let lastFinished = 0;
  return async (prompt: string, check: () => void = () => {}): Promise<string> => {
    if (busyHosts.has(host)) throw new AiModeError('AI_BUSY');
    busyHosts.add(host); let surface: Surface | undefined; let submitted = false;
    try {
      const pause = (options.paceMs ?? 1800) - (Date.now() - lastFinished);
      if (pause > 0) await sleep(pause);
      check(); surface = await host.create('ai');
      await surface.open({ session: 'ai', url: options.url ?? aiUrl, width: 1280, height: 900, userAgent: aiUserAgent });
      const read = async () => { check(); const state = await readAiState(surface!, prompt); if (state.blocked) throw new AiModeError(state.blocked); return state; };
      const deadline = Date.now() + (options.timeoutMs ?? 60000);
      let state = await read();
      while (!state.input && Date.now() < deadline) { await sleep(options.pollMs ?? 800); state = await read(); }
      if (!state.input) throw new AiModeError('AI_LAYOUT_UNSUPPORTED');
      if (state.generating || state.value.trim()) throw new AiModeError('AI_INPUT_NOT_READY');
      const baseline = state.answer, baselineReceipts = state.receipts;
      await surface.click(state.input.x, state.input.y);
      await surface.typeText(prompt);
      await sleep(options.paceMs ?? 900);
      state = await read();
      const sendDeadline = Date.now() + 5000;
      while ((!state.send || state.value !== prompt) && Date.now() < sendDeadline) { await sleep(options.pollMs ?? 800); state = await read(); }
      if (state.value !== prompt || !state.send) throw new AiModeError('AI_INPUT_MISMATCH');
      if (surface.readClickTarget && !await surface.readClickTarget(state.send.x, state.send.y, 'button,[role="button"]')) throw new AiModeError('AI_INPUT_NOT_READY');
      submitted = true; // An ambiguous click is never retried.
      await surface.click(state.send.x, state.send.y); // Single submit, never resend an ambiguous request.
      const responseDeadline = Date.now() + (options.timeoutMs ?? 60000);
      let previous = '', stable = 0;
      while (Date.now() < responseDeadline) {
        await sleep(options.pollMs ?? 1000); state = await read();
        const answer = state.answer; // A body delta can include the echoed prompt; require a response region.
        if (state.receipts > baselineReceipts && !state.value.trim() && !state.generating && state.ready && answer && answer !== baseline && !answer.includes(prompt)) {
          stable = answer === previous ? stable + 1 : 0; previous = answer;
          if (stable >= 2) return answer;
        } else stable = 0;
      }
      throw new AiModeError(state.receipts > baselineReceipts ? 'AI_RESPONSE_TIMEOUT' : 'AI_REQUEST_NOT_RECEIVED');
    } catch (error) {
      check();
      const message = error instanceof Error ? error.message : '';
      const code = /^AI_[A-Z_]+$/.test(message) ? message : message === 'SURFACE_NAVIGATION_TIMEOUT' ? 'AI_NAVIGATION_TIMEOUT' : message === 'SURFACE_READ_FAILED_OR_SIDE_EFFECT' ? 'AI_READ_FAILED' : 'AI_UNAVAILABLE';
      throw new AiModeError(code, submitted);
    } finally { try { if (surface) await host.destroy(surface); } finally { lastFinished = Date.now(); busyHosts.delete(host); } }
  };
}

/** Owner-controlled surface uses the same isolated profile and UA as polishing. */
export class AiModeClient {
  private owner: Surface | undefined;
  private busy = false;
  private readonly transport;
  constructor(private readonly host: SurfaceHost, private readonly options: AiModeOptions = {}) { this.transport = aiModeTransport(host, options); }
  readonly polish = async (prompt: string, check?: () => void): Promise<string> => {
    if (this.busy) throw new AiModeError('AI_BUSY');
    this.busy = true;
    try { await this.closeOwner(); return await this.transport(prompt, check); } finally { this.busy = false; }
  };
  async show() {
    if (this.busy || busyHosts.has(this.host)) throw new AiModeError('AI_BUSY');
    this.busy = true;
    try {
      if (!this.owner) {
        this.owner = await this.host.create('ai');
        try { await this.owner.open({ session: 'ai', url: this.options.url ?? aiUrl, width: 1280, height: 900, userAgent: aiUserAgent }); }
        catch (error) { await this.closeOwner(); throw error; }
      }
      await this.owner.show();
    } finally { this.busy = false; }
  }
  async hide() { if (this.busy) throw new AiModeError('AI_BUSY'); await this.owner?.hide(); }
  async clear() {
    if (this.busy || busyHosts.has(this.host)) throw new AiModeError('AI_BUSY');
    this.busy = true;
    try { await this.closeOwner(); await this.host.clearSession('ai'); } finally { this.busy = false; }
  }
  private async closeOwner() { const surface = this.owner; this.owner = undefined; if (surface) await this.host.destroy(surface); }
}
