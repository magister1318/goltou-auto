// Owner-only evidence stays outside the repository. Never read login fields or cookies.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { CdpConnection } = require('../dist/surface.cjs');
const adb = path.join(process.env.LOCALAPPDATA, 'Android/Sdk/platform-tools/adb.exe');
export const output = path.resolve('../runs/wp16-shots');
mkdirSync(output, { recursive: true });
export const run = args => execFileSync(adb, ['-s', 'R3CX10HP9CB', ...args], { windowsHide: true, maxBuffer: 20 * 1024 * 1024 });
export function ready() {
  const power = run(['shell', 'dumpsys', 'power']).toString();
  const win = run(['shell', 'dumpsys', 'window']).toString();
  const activity = run(['shell', 'dumpsys', 'activity', 'activities']).toString();
  if (!/mWakefulness=Awake/.test(power) || !/mCurrentFocus=Window\{[^\n]*kr\.goltou\.auto\/kr\.goltou\.auto\.MainActivity/.test(win) || !/topResumedActivity=[^\n]*kr\.goltou\.auto\/.MainActivity/.test(activity)) throw Error('DEVICE_NOT_READY');
  return win;
}
export async function attach() {
  ready();
  const pid = run(['shell', 'pidof', 'kr.goltou.auto']).toString().trim();
  if (!/^\d+$/.test(pid)) throw Error('APP_PROCESS_MISSING');
  const port = Number(run(['forward', 'tcp:0', `localabstract:webview_devtools_remote_${pid}`]).toString());
  let targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  async function connect(target) {
    const url = new URL(target.webSocketDebuggerUrl); url.host = `127.0.0.1:${port}`;
    return CdpConnection.connect(url.href);
  }
  const appTargets = () => targets.filter(t => { try { const u = new URL(t.url); return u.hostname === '127.0.0.1' && u.pathname.startsWith('/ui/'); } catch { return false; } });
  for(let n=0;n<40&&!appTargets().length;n++) {ready();await new Promise(r=>setTimeout(r,200));targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();}
  const ui = appTargets();
  if (ui.length !== 1) {run(['forward','--remove',`tcp:${port}`]);throw Error('APP_UI_AMBIGUOUS');}
  const cdp = await connect(ui[0]);
  cdp.on('Network.webSocketFrameReceived', e => {
    try { const m = JSON.parse(e.response.payloadData); if(m.type==='error') console.log(JSON.stringify({appErrorCode:m.code,stableCause:/^[A-Z_]+(?::[A-Z_0-9,]+)*$/.test(m.message)?m.message:'PLAIN_APP_ERROR'})); } catch {}
  });
  await cdp.send('Network.enable',{});
  async function read(expression, connection = cdp) {
    ready();
    const r = await connection.send('Runtime.evaluate', { expression, returnByValue: true, throwOnSideEffect: true });
    if (r.exceptionDetails) throw Error('READ_FAILED');
    return r.result.value;
  }
  async function click(selector, label) {
    if (/발행하기|삭제/.test(label ?? '')) throw Error('FORBIDDEN_ACTION');
    if (!selector.startsWith('.sheet') && await read(`!!document.querySelector('.sheet')`)) throw Error('SHEET_MUST_CLOSE_FIRST');
    const p = await read(`(()=>{const es=[...document.querySelectorAll(${JSON.stringify(selector)})].filter(e=>!e.disabled&&e.getBoundingClientRect().height>0${label ? `&&e.textContent.trim()===${JSON.stringify(label)}` : ''});if(es.length!==1)return null;const r=es[0].getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    if (!p) throw Error('CONTROL_UNAVAILABLE');
    ready();
    for (const type of ['mousePressed','mouseReleased']) await cdp.send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});
  }
  async function wait(expression, ms = 60000) {
    const end = Date.now()+ms;
    while(Date.now()<end) { if(await read(expression)) return; await new Promise(r=>setTimeout(r,250)); }
    throw Error('WAIT_EXPIRED');
  }
  function capture(name) { ready(); writeFileSync(path.join(output, `${name}.png`), run(['exec-out','screencap','-p'])); }
  return { cdp, read, click, wait, capture, targets, connect, targetsNow: async () => (await fetch(`http://127.0.0.1:${port}/json/list`)).json(), close() { cdp.close(); run(['forward','--remove',`tcp:${port}`]); } };
}
if (process.argv.includes('--diagnose')) {
  const d = await attach();
  try {
    d.capture('before-fixes');
    for(const t of d.targets.filter(t=>['band.us','www.band.us'].includes(new URL(t.url).hostname))) {
      const c = await d.connect(t);
      console.log(JSON.stringify(await d.read(`(()=>({classes:[...document.body.children].map(e=>[e.tagName,e.className]),scriptCount:document.scripts.length,frames:document.querySelectorAll('iframe').length}))()`,c)));
      console.log(JSON.stringify(await d.read(`(()=>({home:location.pathname==='/',my:location.pathname==='/my/bands',legacy:!!document.querySelector('._myBandListWrap'),global:!!document.querySelector('.globalMyBandWrap'),myList:!!document.querySelector('.myBandGroupList'),all:!!document.querySelector('a._allMyBandList'),tiles:document.querySelectorAll('.myBandGroupList a.myBandGroupItem').length,links:document.querySelectorAll('a[href^="/band/"]').length,passwordField:!!document.querySelector('input[type=password]')}))()`,c)));
      console.log(JSON.stringify(await d.read(`(()=>({loginButtons:[...document.querySelectorAll('a,button')].filter(e=>/^(로그인|Log in|Sign in)$/i.test((e.textContent||'').trim())).map(e=>({w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height})),allButtons:[...document.querySelectorAll('a._allMyBandList')].map(e=>({text:e.textContent,x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y,w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height})),viewport:{w:innerWidth,h:innerHeight}}))()`,c)));
      if(process.argv.includes('--reload-readonly') && !await d.read(`!!document.querySelector('.globalMyBandWrap')`, c)) {
        const requests = new Map();
        c.on('Network.requestWillBeSent', e=>{const u=new URL(e.request.url);if(u.hostname.endsWith('band.us'))requests.set(e.requestId,{host:u.hostname,method:e.request.method,path:u.pathname.replace(/[0-9]{5,}/g,'ID')});});
        c.on('Network.loadingFailed', e=>console.log(JSON.stringify({request:requests.get(e.requestId),error:e.errorText})));
        await c.send('Network.enable',{}); ready(); await c.send('Page.reload',{});
        await new Promise(r=>setTimeout(r,18000));
        console.log(JSON.stringify({loaded:await d.read(`!!document.querySelector('.globalMyBandWrap')`,c)}));
      }
      c.close();
    }
  } finally { d.close(); }
}
if (process.argv.includes('--screens')) {
  const d = await attach();
  const back = async () => { ready(); run(['shell','input','keyevent','4']); await new Promise(r=>setTimeout(r,300)); };
  try {
    if(await d.read(`!!document.querySelector('.sheet')`)) await back();
    if(await d.read(`!!document.querySelector('.screen-preview')`)) {await back();await d.wait(`!!document.querySelector('.screen-home')`);}
    await d.wait(`document.querySelectorAll('.product-row').length>0`);
    await d.wait(`document.querySelector('.connections .chip:last-child')?.textContent.includes('연결됨')`,90000);
    d.capture('products');
    await d.click('.product-row:first-of-type');
    await d.wait(`!!document.querySelector('.converted-content')&&!document.querySelector('.bar .btn').disabled`);
    d.capture('preview-blog');
    await d.click('.seg button:nth-child(2)'); d.capture('preview-band');
    await d.click('.seg button:first-child');
    await d.click('.bar .secondary'); d.capture('draft-sheet');
    await back();
    if(await d.read(`!!document.querySelector('.sheet')||!document.querySelector('.screen-preview')`)) throw Error('DRAFT_BACK_FAILED');
    await d.click('.bar .primary'); d.capture('publish-loading');
    await d.wait(`!!document.querySelector('.inline-feedback')||(document.querySelectorAll('.sheet button.pick').length===2&&!document.querySelectorAll('.sheet button.pick')[1].disabled&&!document.body.textContent.includes('내 밴드를 확인하는 중'))`,90000);
    if(await d.read(`!!document.querySelector('.inline-feedback')`)) { d.capture('publish-list-failed'); throw Error('DEVICE_BAND_LIST_FAILED'); }
    await d.click('.sheet button.pick:nth-of-type(2)');
    d.capture('publish-sheet');
    console.log(JSON.stringify(await d.read(`(()=>({failed:!!document.querySelector('.inline-feedback'),choices:document.querySelectorAll('.sheet select option').length,errors:document.querySelectorAll('.error').length}))()`)));
    await back(); await back();
    if(!await d.read(`!!document.querySelector('.screen-home')`))throw Error('PREVIEW_BACK_FAILED');
    await d.click('.chip:first-child'); d.capture('connections'); await back();
    await d.click('.bottom-nav button','등록 기록');
    await d.wait(`!document.body.textContent.includes('등록 기록을 불러오는 중')`); d.capture('history');
    await back();
    await d.click('.bottom-nav button','설정'); d.capture('settings');
    await back();
    if(await d.read(`!!document.querySelector('.screen-preview')`))await back();
    await d.wait(`!!document.querySelector('.screen-home')`);
    console.log(JSON.stringify({screensCaptured:true,backPassed:true}));
  } finally { d.close(); }
}
if (process.argv.includes('--draft-once')) {
  const latch = path.join(output, 'fix-round-draft-attempted');
  if(existsSync(latch)) throw Error('FIX_ROUND_DRAFT_ALREADY_ATTEMPTED');
  const d = await attach();
  const samples = [];
  try {
    if(await d.read(`!!document.querySelector('.sheet')`)) {await d.click('.sheet .acts .quiet');await d.wait(`!document.querySelector('.sheet')`);}
    if(await d.read(`!!document.querySelector('.screen-preview')`)){await d.click('.back');await d.wait(`!!document.querySelector('.screen-home')`);}
    await d.click('.product-row:first-of-type');
    await d.wait(`!!document.querySelector('.converted-content')&&!document.querySelector('.bar .btn').disabled`);
    await d.click('.bar .secondary');
    writeFileSync(latch, 'Exactly one fix-round draft attempt reserved before input. Never rerun.');
    await d.click('.sheet button','블로그에 임시저장');
    await d.wait(`!!document.querySelector('.screen-progress')`);
    let n=0,lastShot=0,lastStage='',recoverySeen=false;
    const start=Date.now();
    while(Date.now()-start<20*60*1000) {
      const state=await d.read(`(()=>({live:!!document.querySelector('.live-progress'),sheet:document.querySelector('.sheet')?.getAttribute('aria-label')||'',done:[...document.querySelectorAll('h1')].some(e=>e.textContent==='블로그에 임시저장했습니다'),failed:[...document.querySelectorAll('h1')].some(e=>e.textContent==='끝까지 옮기지 못했습니다'),headline:document.querySelector('.progress-headline')?.textContent||'',percent:Number(document.querySelector('.overall')?.value||0),elapsed:document.querySelector('.live-progress>.row-label:last-child span')?.textContent||'',chars:document.querySelector('.paper-content')?.textContent.length||0,photos:document.querySelectorAll('.live-photo img').length,pills:document.querySelectorAll('.check-pills .ok').length}))()`);
      const safe={...state,at:Date.now()-start}; delete safe.sheet;
      samples.push(safe);
      if(Date.now()-lastShot>=5000 || state.headline!==lastStage || state.done || state.failed) {d.capture(`prog-${String(n++).padStart(2,'0')}`);lastShot=Date.now();lastStage=state.headline;}
      if(state.sheet==='네이버에 쓰다 만 글이 있습니다'&&!recoverySeen){d.capture('unfinished-post-sheet');recoverySeen=true;console.log(JSON.stringify({recoveryConsentRequired:true}));}
      if(state.done||state.failed||!state.live&&!state.sheet) {d.capture(state.done?'draft-complete':'draft-ended');console.log(JSON.stringify({done:state.done,failed:state.failed,samples:samples.length,screenshots:n,recoverySeen}));break;}
      writeFileSync(path.join(output,'progress-metrics.json'),JSON.stringify(samples));
      await new Promise(r=>setTimeout(r,750));
    }
    writeFileSync(path.join(output,'progress-metrics.json'),JSON.stringify(samples));
  } finally {d.close();}
}
