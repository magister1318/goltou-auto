// Owner-only raw evidence stays outside the repository. App UI input only.
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { attach, output } from './review-device-ux-v2.mjs';

const number = process.argv[2];
if (!['3', '4'].includes(number)) throw Error('RUN_3_OR_4_REQUIRED');
const latch = path.join(output, `run${number}-attempted`);
if (existsSync(latch)) throw Error('THIS_RUN_ALREADY_ATTEMPTED');
if (number === '4' && !existsSync(path.join(output, 'progress-metrics-3.json'))) throw Error('RUN_3_REQUIRED_FIRST');
const d = await attach();
const samples = [];
const save = () => writeFileSync(path.join(output, `progress-metrics-${number}.json`), JSON.stringify(samples, null, 2));
try {
  const resume = await d.read(`document.querySelector('.sheet')?.getAttribute('aria-label')==='네이버에 쓰다 만 글이 있습니다'`);
  if (!resume && await d.read(`[...document.querySelectorAll('h1')].some(e=>e.textContent==='블로그에 임시저장했습니다')`)) await d.click('.screen-progress button', '다른 상품 옮기기');
  if (!resume) {
  await d.wait(`!!document.querySelector('.screen-home')&&document.querySelectorAll('.product-row').length>1`);
  // A different product avoids selecting older drafts with the same title.
  const selector = await d.read(`(()=>{const row=document.querySelectorAll('.product-row')[${number === '4' ? 2 : 1}];return '.product-row:nth-child('+([...row.parentElement.children].indexOf(row)+1)+')'})()`);
  await d.click(selector);
  await d.wait(`!!document.querySelector('.converted-content')&&!document.querySelector('.bar .btn').disabled`);
  await d.click('.bar .secondary');
  }
  writeFileSync(latch, 'One authorized blog draft attempt reserved before input; never repeat this run.');
  const start = Date.now();
  if (!resume) await d.click('.sheet button', '블로그에 임시저장');
  await d.wait(`!!document.querySelector('.screen-progress')`);
  let shot = 0, lastShot = -5000, recoverySeen = false;
  for (let sample = 0; Date.now() - start < 20 * 60 * 1000; sample++) {
    const state = await d.read(`(()=>{
      const overall=document.querySelector('.overall');
      const label=document.querySelector('.live-progress>.row-label:last-child span')?.textContent||'';
      const sheet=document.querySelector('.sheet');
      return {live:!!document.querySelector('.live-progress'),paused:!!sheet,
        recovery:sheet?.getAttribute('aria-label')==='네이버에 쓰다 만 글이 있습니다',
        done:[...document.querySelectorAll('h1')].some(e=>e.textContent==='블로그에 임시저장했습니다'),
        failed:[...document.querySelectorAll('h1')].some(e=>e.textContent==='끝까지 옮기지 못했습니다'),
        headline:document.querySelector('.progress-headline')?.textContent||'',
        subtitle:document.querySelector('.live-progress>p.meta')?.textContent||'',
        percent:overall?Number(overall.getAttribute('value')):null,
        percentFinite:!!overall&&Number.isFinite(Number(overall.getAttribute('value')))&&Number.isFinite(Number(label.split('%')[0])),
        elapsed:label,remaining:document.querySelector('.live-progress>.row-label:last-child span:last-child')?.textContent||'',
        chars:[...document.querySelectorAll('.paper-content p:not(.meta)')].reduce((n,e)=>n+Array.from(e.textContent).length,0),
        photos:document.querySelectorAll('.photo-strip .ok').length,
        pills:document.querySelectorAll('.check-pills .ok').length};})()`);
    const at = Date.now() - start;
    samples.push({ ...state, at, startedAt: start, resumed: resume }); save();
    if (at - lastShot >= 4900 || state.done || state.failed) {
      d.capture(`run${number}-${String(shot++).padStart(2, '0')}`); lastShot = at;
    }
    if (state.recovery && !recoverySeen) {
      recoverySeen = true; console.log(JSON.stringify({ recoverySeen: true, run: number }));
      // Owner authorized this exact app path for both attempts in this session.
      await d.click('.sheet button', '버리고 새로 쓰기');
    }
    if (state.done || state.failed || !state.live && !state.paused) {
      d.capture(`run${number}-${state.done ? 'done' : 'ended'}`);
      console.log(JSON.stringify({ run: number, done: state.done, failed: state.failed, samples: samples.length, screenshots: shot, milliseconds: at, recoverySeen }));
      break;
    }
    // Use a one-second schedule; screenshot time does not accumulate as drift.
    await new Promise(resolve => setTimeout(resolve, Math.max(0, start + (sample + 1) * 1000 - Date.now())));
  }
} finally { save(); d.close(); }
