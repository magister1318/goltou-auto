// Reference: ../refs/DAF/daf3/packages/engine-ai-mode/src/transport/{conversation-browser,conversation-transport}.ts (readiness, input receipts, responseAfterPrompt; Surface-only adaptation).
import type { Surface, SurfaceHost } from '@goltou/surface';
import { sleep } from '../dom';

const userAgent = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
interface Point { x: number; y: number }
interface AiState { blocked: string; input: Point | null; value: string; send: Point | null; generating: boolean; answer: string; receipts: number; body: string; ready: boolean }
export function readAiState(surface: Surface, prompt: string): Promise<AiState> {
  return surface.evaluateReadOnly(`(() => {
    const visible=e=>{const r=e.getBoundingClientRect();return r.width>8&&r.height>8&&getComputedStyle(e).visibility!=='hidden';};
    const point=e=>{const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};};
    const inputs=Array.from(document.querySelectorAll('textarea,input[name="q"],[contenteditable="true"][role="textbox"]')).filter(visible);
    const input=inputs[inputs.length-1];
    const buttons=Array.from(document.querySelectorAll('button,[role="button"]')).filter(visible);
    const label=e=>(e.getAttribute('aria-label')||e.textContent||'').trim();
    const send=buttons.slice().reverse().find(e=>/^(보내기|질문하기|시작|send|submit|ask)( message)?$/i.test(label(e))&&!e.disabled&&e.getAttribute('aria-disabled')!=='true');
    const copy=buttons.slice().reverse().find(e=>/^(텍스트 복사|Copy text)$/i.test(label(e)));
    const body=document.body?.innerText||'';
    const generating=buttons.some(e=>/^(응답 생성 중지|생성 중지|중지|stop|stop generating|stop response)$/i.test(label(e)))||Boolean(copy&&(copy.disabled||copy.getAttribute('aria-disabled')==='true'))||/AI Mode is processing your query|AI 모드가 쿼리를 처리 중입니다/.test(body);
    const blocked=location.hostname==='accounts.google.com'||Boolean(document.querySelector('input[type="password"]'))?'login':location.hostname==='consent.google.com'?'consent':/^\\/sorry\\//.test(location.pathname)||Boolean(document.querySelector('#captcha-form,iframe[src*="recaptcha"]'))?'blocked':'';
    const prompt=${JSON.stringify(prompt)};
    const receipts=Array.from(document.querySelectorAll('[aria-label]')).filter(e=>{const s=e.getAttribute('aria-label')||'';return /^(복사|수정|Copy|Edit)\\s+/.test(s)&&s.replace(/^(복사|수정|Copy|Edit)\\s+/,'').replace(/\\s/g,'')===prompt.replace(/\\s/g,'');}).length;
    // Copy belongs to the newest answer. Do not accept echoed composer/body text as an answer.
    let answer='';
    if(copy){let region=copy.parentElement;
      while(region&&region!==document.body&&!region.hasAttribute('data-ai-response')&&!region.hasAttribute('data-response-id')&&!region.hasAttribute('data-container-id'))region=region.parentElement;
      if(region&&region!==document.body){const text=region.querySelector('[data-answer-text],.markdown,pre');answer=text?text.innerText:'';}
    }
    const ready=Boolean(copy)||/AI 모드 대답이 준비되었습니다\\.|AI Mode response is ready\\./.test(body);
    return {blocked,input:input?point(input):null,value:input?String(input.value??input.textContent):'',send:send?point(send):null,generating,answer,receipts,body,ready};
  })()`);
}
export interface AiModeOptions { url?: string; timeoutMs?: number; pollMs?: number }
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
  let busy = false;
  return async (prompt: string, check: () => void = () => {}): Promise<string> => {
    if (busy) throw new Error('AI_BUSY');
    busy = true; let surface: Surface | undefined;
    try {
      check(); surface = await host.create('ai');
      const url = options.url ?? 'https://www.google.com/search?udm=50&hl=ko';
      await surface.open({ session: 'ai', url, width: 1280, height: 900, userAgent });
      const read = async () => { check(); const state = await readAiState(surface!, prompt); if (state.blocked) throw new Error(state.blocked === 'login' ? 'AI_LOGIN_REQUIRED' : 'AI_UNAVAILABLE'); return state; };
      const deadline = Date.now() + (options.timeoutMs ?? 60000);
      let state = await read();
      while (!state.input && Date.now() < deadline) { await sleep(options.pollMs ?? 250); state = await read(); }
      if (!state.input || state.generating || state.value.trim()) throw new Error('AI_INPUT_NOT_READY');
      const baseline = state.answer, baselineBody = state.body, baselineReceipts = state.receipts;
      await surface.click(state.input.x, state.input.y);
      await surface.typeText(prompt);
      state = await read();
      const sendDeadline = Date.now() + 5000;
      while ((!state.send || state.value !== prompt) && Date.now() < sendDeadline) { await sleep(options.pollMs ?? 250); state = await read(); }
      if (state.value !== prompt || !state.send) throw new Error('AI_INPUT_MISMATCH');
      await surface.click(state.send.x, state.send.y); // Single submit, never resend an ambiguous request.
      const responseDeadline = Date.now() + (options.timeoutMs ?? 60000);
      let previous = '', stable = 0;
      while (Date.now() < responseDeadline) {
        await sleep(options.pollMs ?? 500); state = await read();
        const answer = state.answer || (state.ready && !state.value.trim() ? answerAfterPrompt(state.body, baselineBody, prompt) : '');
        if (state.receipts > baselineReceipts && !state.generating && answer && answer !== baseline) {
          stable = answer === previous ? stable + 1 : 0; previous = answer;
          if (stable >= 2) return answer;
        } else stable = 0;
      }
      throw new Error('AI_RESPONSE_TIMEOUT');
    } finally { try { if (surface) await host.destroy(surface); } finally { busy = false; } }
  };
}
