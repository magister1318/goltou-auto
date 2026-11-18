import { afterEach, expect, it, vi } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import type { Surface, SurfaceHost } from '@goltou/surface';
import { CdpSurface, type CdpConnection } from '@goltou/surface/cdp';
import { createBlogExecution } from '../src/blog';
import type { InputPlan } from '../src/convert';
import { loggedFixture } from './log-fixture';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';

let browser: Browser | undefined;
afterEach(async()=>{await browser?.close();});
const executablePath = [process.env.CHROMIUM,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/chromium'].find(p=>p&&existsSync(p));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64');

async function viewer(missing = '', mobileProof = false, withTable = false) {
  browser = await chromium.launch({executablePath:executablePath!,headless:true,args:['--disable-background-networking','--no-first-run']});
  const context = await browser.newContext({viewport:{width:1280,height:900}});
  const url = 'https://blog.naver.com/synthetic_fixture/9001';
  const plan: InputPlan = {channel:'blog',discarded:[],notices:[],steps:[{kind:'text',role:'title',text:'합성 판독 제목'}]};
  // The full replay below owns the 99-paragraph/29-photo scrolling regression.
  // Keep the independent mobile visibility test small so it tests that second
  // live document without repeating a long lazy-load sweep under worker load.
  const shape = mobileProof || withTable || missing === 'bold' ? {paragraphs:3,photos:2,fillers:0} : {paragraphs:99,photos:29,fillers:58};
  const paragraphs = Array.from({length:shape.paragraphs},(_,i)=>`합성 문단 ${i+1}`);
  paragraphs.forEach((text,i)=>plan.steps.push({kind:'text',role:'body',text,runs:i===0?[{text,bold:true}]:i===1||i===2?[{text,href:`https://example.invalid/${i}`}]:[{text}]}));
  const files = Array.from({length:shape.photos},(_,i)=>({url:`https://example.invalid/photo/${i}`,path:`/synthetic/goltou-1234567890abcdef-${i+1}.png`}));
  plan.steps.push({kind:'photos',urls:files.map(f=>f.url)},{kind:'text',role:'hashtags',text:'#one #two'});
  if(withTable)plan.steps.splice(2,0,{kind:'table',role:'body',rows:[['a','b'],['','c']]});
  const body = paragraphs.map((text,i)=>`<div class="se-component se-text"><p class="se-text-paragraph"><span class="se-fs-fs15 se-ff-nanumgothic">${i===0?`<b>${text}</b>`:i===1||i===2?`<a href="https://example.invalid/${i}">${text}</a>`:text}</span></p></div>`).join('');
  // Observed real shape: 99 meaningful paragraphs plus 58 standalone U+200B
  // viewer fillers. All 29 final URLs can exist before their images load.
  const fillers = Array.from({length:shape.fillers},()=>'<div class="se-component se-text"><p class="se-text-paragraph"><span>\u200b</span></p></div>').join('');
  // The recorded viewer uses data-lazy-src, without native loading="lazy".
  // Adding both mechanisms makes background test tabs depend on Chromium's
  // unrelated native lazy-image activation heuristics.
  const images = files.map(f=>`<div class="se-component se-image"><img class="se-image-resource" width="90" height="50" data-lazy-src="/photos/${f.path.split('/').pop()}" alt="${f.path.split('/').pop()}" style="display:block;margin-top:50px"></div>`).join('');
  const html = `<div class="se-documentTitle"><p tabindex="0" class="se-text-paragraph"></p></div><div class="se-viewer"></div><div class="tag_list"></div><div class="post_visibility"></div><script>
    const missing=${JSON.stringify(missing)};
    setTimeout(()=>{if(missing!=='title')document.querySelector('.se-documentTitle p').textContent='합성 판독 제목'},100);
    setTimeout(()=>{document.querySelector('.se-viewer').innerHTML=${JSON.stringify(body.replace(/<\/?(?:b|a)\b[^>]*>/g,'')+fillers)}},250);
    setTimeout(()=>{const p=document.querySelectorAll('.se-viewer .se-text-paragraph');if(missing!=='bold')p[0].innerHTML='<b>합성 문단 1</b>';if(missing!=='links'){p[1].innerHTML='<a href="https://example.invalid/1">합성 문단 2</a>';p[2].innerHTML='<a href="https://example.invalid/2">합성 문단 3</a>'}},1800);
    setTimeout(()=>{if(missing!=='photos')document.querySelector('.se-viewer').insertAdjacentHTML('beforeend',${JSON.stringify(images)})},900);
    setTimeout(()=>{if(missing!=='tags')document.querySelector('.tag_list').innerHTML='<span class="tag">one</span><span class="tag">two</span>'},1500);
    setTimeout(()=>{if(missing!=='visibility')document.querySelector('.post_visibility').textContent='전체공개'},1200);
    if(${withTable})setTimeout(()=>{if(missing==='table-missing')return;const t=document.createElement('div');t.className='se-component se-table';t.innerHTML='<table><tr><td><p class="se-text-paragraph">a</p></td><td><p class="se-text-paragraph">'+(missing==='table-cell'?'wrong':'b')+'</p></td></tr><tr><td><p class="se-text-paragraph"></p></td><td><p class="se-text-paragraph">c</p></td></tr></table>';if(missing==='table-shape')t.querySelector('tr:last-child').remove();document.querySelector('.se-viewer').firstElementChild.after(t);},2100);
    document.addEventListener('keydown',e=>{if(e.key==='PageDown')for(const img of document.querySelectorAll('img[data-lazy-src]')){const r=img.getBoundingClientRect();if(r.top<innerHeight&&r.bottom>0){img.src=img.getAttribute('data-lazy-src');img.removeAttribute('data-lazy-src')}}});
  </script>`;
  let imageRequests=0;
  await context.route('**/*',async route=>{
    if(route.request().url()===url.replace('https://blog.','https://m.blog.'))return route.fulfill({contentType:'text/html; charset=utf-8',body:'<div class="se-documentTitle"><p class="se-text-paragraph">합성 판독 제목</p></div><script>setTimeout(()=>{window.openType=2},1600)</script>'});
    if(route.request().url()===url)return route.fulfill({contentType:'text/html; charset=utf-8',body:html});
    if(new URL(route.request().url()).pathname.startsWith('/photos/')){imageRequests++;await new Promise(r=>setTimeout(r,500));return route.fulfill({contentType:'image/png',body:png});}
    return route.abort();
  });
  async function makeSurface(){
    const page=await context.newPage(),session=await context.newCDPSession(page);
    const shim={send:(method:string,params:object)=>session.send(method as never,params as never),on:(method:string,listener:(params:Record<string,unknown>)=>void)=>{session.on(method as never,listener);return()=>session.off(method as never,listener);},isOpen:true,close:()=>{}};
    return {page,surface:new CdpSurface('naver',shim as unknown as CdpConnection,{setVisible:async()=>{},close:()=>page.close()},0)};
  }
  const {page,surface}=await makeSurface();
  const host={create:async()=>(await makeSurface()).surface,destroy:async(s:Surface)=>s.close(),clearSession:async()=>{}} as SurfaceHost;
  const execution=createBlogExecution(plan,files,{host,editorUrl:'http://127.0.0.1/editor',localPublish:!mobileProof,publishedSettleMs:missing && missing !== 'bold' ? 2500 : 20000},{mode:'publish',visibility:'public',beforeSave(){throw Error('NO_SAVE');},check(){},progress(){}});
  execution.surface=surface;execution.publishedPost={url,postId:'9001'};
  await surface.open({url,session:'naver',width:1280,height:900,userAgent:'synthetic fixture'});
  return {execution,surface,page,plan,files,imageRequests:()=>imageRequests};
}

it('replays late tags, late and lazy loaded photos and 58 filler paragraphs through the real published verifier',async()=>{
  const f=await viewer();
  const directory=await mkdtemp(path.join(os.tmpdir(),'goltou-settle-'));
  try{
    const verify=vi.spyOn(f.execution,'verifyPublished');
    const result=await loggedFixture(directory,'blog_publish',async()=>{
      const actual=await f.execution.verifyPublished();
      expect(actual.tokens.filter(t=>t.kind==='text')).toHaveLength(99);
      expect(actual.tokens.filter(t=>t.kind==='photo'&&t.loaded)).toHaveLength(29);
      expect(actual.tags).toEqual(['one','two']);
    },['sites.naver-blog.plan.BlogExecution.verifyPublished']);
    expect(f.execution.publishedVerified).toBe(true);expect(verify).toHaveBeenCalledTimes(1);
    expect(f.imageRequests()).toBe(29);
    expect(f.execution.readbackTimings[0]!.navigationKeys).toBeGreaterThan(1);
    expect(result.lines.filter(r=>r.step==='terminal').map(r=>r.result)).toEqual(['succeeded']);
    for(const check of ['title','paragraphs','bold','links','photos','hashtags','visibility'])expect(result.lines.some(r=>r.check===check&&r.counts?.expected!==undefined&&r.counts?.observed!==undefined&&typeof r.duration==='number')).toBe(true);
  }finally{await rm(directory,{recursive:true,force:true});}
},30000);

it.each(['title','photos','tags','visibility','links'])('retains the receipt and names permanently missing %s after the deadline',async missing=>{
  const f=await viewer(missing);
  await expect(f.execution.verifyPublished()).rejects.toMatchObject({issues:expect.arrayContaining([expect.objectContaining({field:missing==='tags'?'hashtags':missing==='links'?'href':missing==='photos'?'photo':missing})])});
  expect(f.execution.publishedVerified).toBe(false);
  expect(f.execution.creationState).toBe('published');
  expect(f.execution.publishedPost?.url).toBe('https://blog.naver.com/synthetic_fixture/9001');
},10000);

it('reads public openType from a separate live mobile post, independently of the requested visibility',async()=>{
  const f=await viewer('',true);
  const actual=await f.execution.verifyPublished();
  expect(actual.visibility).toBe('public');
  expect(actual.tokens.filter(t=>t.kind==='photo'&&t.loaded)).toHaveLength(2);
  expect(f.imageRequests()).toBe(2);
  expect(f.execution.publishedVerified).toBe(true);
},30000);

it('waits for a late real table in the published-page verifier and compares every row and cell',async()=>{
  const f=await viewer('',false,true);const actual=await f.execution.verifyPublished();
  expect(actual.tokens.slice(0,4).map(t=>t.kind)).toEqual(['text','table','text','text']);
  expect(actual.tokens[1]).toMatchObject({kind:'table',rows:[['a','b'],['','c']]});expect(f.execution.publishedVerified).toBe(true);
},15000);
it.each(['table-missing','table-shape'])('retains the published receipt and names %s as 표',async missing=>{
  const f=await viewer(missing,false,true);await expect(f.execution.verifyPublished()).rejects.toMatchObject({issues:expect.arrayContaining([{field:'table'}])});
  expect(f.execution.creationState).toBe('published');expect(f.execution.publishedVerified).toBe(false);
},12000);

it('verifies a published post whose bold styling was dropped', async () => {
  const f = await viewer('bold');
  await f.execution.verifyPublished();
  expect(f.execution.publishedVerified).toBe(true);
}, 12000);
