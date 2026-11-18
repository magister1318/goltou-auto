import { afterEach, describe, expect, it, vi } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import type { Surface } from '@goltou/surface';
import type { SurfaceHost, GuardedRequest, GuardedResponse } from '@goltou/surface';
import { BandDirectory } from '../src/band/plan';
import { createdBandPosts, normalizedBandBody, readFullBandPost, verifyFullBandPost, settleFullBandPost } from '../src/band/posted';

let browser: Browser | undefined;
afterEach(async () => { await browser?.close(); });
const title = '합성 시험 제목';
const post = (extra = {}) => ({ content: title + '\n본문\n<band:hashtag>#합성</band:hashtag>', band: { band_no: 111 }, post_no: 9001, web_url: 'https://band.us/band/111/post/9001', created_at: 1700000000000, author: { me: true }, photo_count: 10, ...extra });
describe('immediate publication proof from the posting context', () => {
  it('settles live delayed Band text, tags, links and photo slots before exact comparison',async()=>{
    browser=await chromium.launch({executablePath:process.env.CHROMIUM||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
    const context=await browser.newContext();
    await context.route('**/*',async route=>{await new Promise(r=>setTimeout(r,1000));return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64')});});
    const page=await context.newPage();
    const text='합성 제목\n본문 #합성 https://example.invalid/guide',photo='https://photos.invalid/one.png';
    await page.setContent(`<div class="postsDetailArea"><div class="_contentListRegion"><p class="txtBody" style="white-space:pre-wrap"></p></div></div><script>
      const root=document.querySelector('._contentListRegion'),p=root.querySelector('p');
      setTimeout(()=>p.textContent=${JSON.stringify(text)},200);
      setTimeout(()=>root.insertAdjacentHTML('beforeend','<img class="mediaImg" src="${photo}">'),900);
      setTimeout(()=>p.innerHTML=p.innerHTML.replace('#합성','<button class="hashTag">#합성</button>').replace('https://example.invalid/guide','<a href="https://example.invalid/guide">https://example.invalid/guide</a>'),1600);
    </script>`);
    const cdp=await context.newCDPSession(page);
    const surface={evaluateReadOnly:async<T>(expression:string)=>{const r=await cdp.send('Runtime.evaluate',{expression,returnByValue:true,throwOnSideEffect:true});if(r.exceptionDetails)throw Error('READ_FAILED');return r.result.value as T;},pressKey:async()=>{await page.keyboard.press('PageDown');}} as unknown as Surface;
    const value=await settleFullBandPost(surface,text,[photo],()=>{},6000);
    expect(value).toMatchObject({body:text,hashtags:1,links:1});
    expect(value.photos).toEqual([photo]);
  },10000);
  it.each([
    ['참고 (https://example.invalid/guide)', 'https://example.invalid/guide'],
    ['참고 (https://example.invalid/guide_(part))', 'https://example.invalid/guide_(part)'],
    ['https://example.invalid/guide_%28part%29', 'https://example.invalid/guide_%28part%29'],
  ])('verifies an autolink while retaining surrounding punctuation in the full text: %s', (body, url) => {
    const actual = { body, photos: [], lineBreaks: 0, hashtags: 0, links: 1, tagTexts: [], linkUrls: [url], tagTokens: [], linkTokens: [{text:url,href:url,start:body.replace(/\s/g,'').indexOf(url)}] };
    expect(() => verifyFullBandPost(body, [], actual)).not.toThrow();
    expect(() => verifyFullBandPost(body, [], { ...actual, linkUrls: ['https://example.invalid/changed'] })).toThrow('BAND_PUBLISHED_READBACK_MISMATCH');
    expect(() => verifyFullBandPost(body, [], { ...actual, body: body + ' changed' })).not.toThrow();
  });
  it.each(['#태그',' #태그 '])('reads service token positions and separates hashtag navigation from destinations (%s)', async label => {
    browser = await chromium.launch({executablePath:process.env.CHROMIUM || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
    const context=await browser.newContext();await context.route('**/*',route=>route.abort());
    const page=await context.newPage();
    await page.setContent(`<div class="postsDetailArea"><div class="_contentListRegion"><p class="txtBody" style="white-space:pre-wrap">참고 (<a href="https://example.invalid/guide">https://example.invalid/guide</a>)에서\n<a class="hashTag" href="https://example.invalid/tag">${label}</a>,다음</p></div></div>`);
    const cdp=await context.newCDPSession(page);
    const surface={evaluateReadOnly:async(expression:string)=>{
      const reply=await cdp.send('Runtime.evaluate',{expression,returnByValue:true,throwOnSideEffect:true});
      if(reply.exceptionDetails)throw Error('READ_FAILED');return reply.result.value;
    }} as Surface;
    const actual=await readFullBandPost(surface);
    expect(actual).toMatchObject({links:1,hashtags:1,linkTokens:[{text:'https://example.invalid/guide',start:3}],tagTokens:[{text:'#태그',start:35}]});
    expect(()=>verifyFullBandPost(`참고 (https://example.invalid/guide)에서\n${label},다음`,[],actual!)).not.toThrow();
    await context.close();
  });
  it('handles a successful response without an ID and binds only one recent owned feed identity', async () => {
    let inspect!: (request: GuardedRequest) => boolean | Promise<boolean>;
    let response!: (response: GuardedResponse) => void;
    const surface = { guardRequests: async (_rules: unknown, i: typeof inspect, r: typeof response) => { inspect = i; response = r; } } as Surface;
    const host: SurfaceHost = { create: async () => surface, destroy: async () => {}, clearSession: async () => {} };
    const directory = new BandDirectory(host);
    await directory.getSurface(); directory.arm('111');
    expect(await inspect({ url: 'https://api-kr.band.us/v2.0.2/create_post', method: 'POST', contentType: 'application/x-www-form-urlencoded', postData: 'band_no=111&content=synthetic', postDataComplete: true })).toBe(true);
    response({ url: 'https://api-kr.band.us/v2.0.2/create_post', method: 'POST', status: 200, body: '{"result_code":1,"result_data":{}}' });
    expect(directory.submitted('111')).toBe(true);
    const now = Date.now(), feed = (posts: ReturnType<typeof post>[]) => response({ url: 'https://api-kr.band.us/v2.0.0/get_posts_and_announcements?band_no=111', method: 'GET', status: 200, body: JSON.stringify({ result_code: 1, result_data: { items: posts.map(post => ({ post })) } }) });
    feed([post({ created_at: now, author: { me: false } })]); expect(directory.createdPost(title, now)).toBeUndefined();
    feed([post({ created_at: now - 10000 })]); expect(directory.createdPost(title, now)).toBeUndefined();
    feed([post({ created_at: now }), post({ created_at: now })]); expect(directory.createdPost(title, now)).toBeUndefined();
    feed([post({ created_at: now })]); expect(directory.createdPost(title, now)?.url).toBe('https://band.us/band/111/post/9001');
    expect(directory.matchesPost('https://band.us/band/111/post/9001')).toBe(true);
    expect(directory.matchesPost('https://band.us/band/111/post/9002')).toBe(false);
  });
  it('accepts a partial feed as identity evidence, retaining its exact body and ownership', () => {
    const result = createdBandPosts(JSON.stringify({ result_code: 1, result_data: { items: [{ post: post() }] } }), '111');
    expect(result).toEqual([{ url: 'https://band.us/band/111/post/9001', body: title + '\n본문\n#합성', owned: true, createdAt: 1700000000000, photoCount: 10 }]);
    expect(createdBandPosts(JSON.stringify({ result_code: 1, result_data: { items: [{ post: post({ web_url: 'https://band.us/band/222/post/9001' }) }] } }), '111')).toEqual([]);
    expect(() => createdBandPosts('{"result_code":0}', '111')).toThrow('BAND_RECORD_READ_RESPONSE');
  });
  it.each(['expanded', 'direct', 'observed-expanded'])('rereads the %s full-post DOM, 158 breaks, 29 ordered images, 2 tags and 2 links', async layout => {
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    const context = await browser.newContext(); await context.route('**/*', route => route.abort());
    const page = await context.newPage();
    const text = Array.from({ length: 159 }, (_, i) => i === 158 ? '#합성 #태그 https://example.invalid/a https://example.invalid/b' : `합성 줄 ${i}`).join('\n');
    const photos = Array.from({ length: 29 }, (_, i) => `https://photos.invalid/synthetic-${i}.jpg`);
    await page.setContent((layout === 'direct' ? '<div class="postWrap -postDetailPage"><div class="cContentsCard"><div class="postBody"><div class="dPostTextView"><div class="postText" style="white-space:pre-wrap"></div></div>' : '<div class="postsDetailArea"><div class="_contentListRegion"><p class="txtBody" style="white-space:pre-wrap"></p>') + photos.map(url => `<img class="mediaImg" src="${url}">`).join('') + (layout === 'direct' ? '</div></div></div>' : '</div></div>'));
    if (layout === 'observed-expanded') await page.locator('p').evaluate(element => { const box = document.createElement('div'); box.className = 'postTextBox'; const text = document.createElement('div'); text.className = 'postText _postTxt'; text.style.whiteSpace = 'pre-wrap'; box.append(text); element.replaceWith(box); });
    await page.locator(layout === 'expanded' ? 'p' : '.postText').evaluate((element, value) => { element.textContent = value; element.innerHTML = element.innerHTML.replace(/#합성|#태그/g, '<button class="hashTag">$&</button>').replace(/https:\/\/example.invalid\/[ab]/g, '<a href="$&">$&</a>'); }, text);
    const cdp = await context.newCDPSession(page);
    const surface = { evaluateReadOnly: async <T>(expression: string) => {
      const reply = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, throwOnSideEffect: true });
      if (reply.exceptionDetails) throw Error(reply.exceptionDetails.exception?.description ?? 'READ_FAILED');
      return reply.result.value as T;
    } } as Surface;
    const actual = await readFullBandPost(surface); expect(actual).toMatchObject({ body: text, lineBreaks: 158, hashtags: 2, links: 2 });
    expect(() => verifyFullBandPost(text, photos, actual!)).not.toThrow();
    for (const changed of [{ ...actual!, body: text.replace('합성 줄 2\n', '') }, { ...actual!, photos: [...photos].reverse() }, { ...actual!, photos: photos.slice(1) }, { ...actual!, hashtags: 1 }, { ...actual!, links: 1 }]) expect(() => verifyFullBandPost(text, photos, changed)).toThrow('BAND_PUBLISHED_READBACK_MISMATCH');
    for (const changed of [{ ...actual!, tagTexts: ['#다른태그', '#태그'] }, { ...actual!, linkUrls: ['https://example.invalid/changed', 'https://example.invalid/b'] }]) expect(() => verifyFullBandPost(text, photos, changed)).toThrow('BAND_PUBLISHED_READBACK_MISMATCH');
    expect(normalizedBandBody(text + '\n')).toBe(text);
  });
});

it('replays a nested mobile post with 66 lazy photo slots and four tags, then reports a partial count', async () => {
  browser = await chromium.launch({executablePath:process.env.CHROMIUM || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const context = await browser.newContext();
  await context.route('**/*', route=>route.abort());
  const page = await context.newPage();
  const photos = Array.from({length:66}, (_, i)=>`https://photos.invalid/${i}.jpg`);
  const paragraphs = Array.from({length:19}, (_, i)=>`합성 안내 ${i+1}`);
  const tags = ['#지역','#나라','#코스','#골프'];
  const expected = ['합성 제목', ...paragraphs, tags.join(' ')].join('\n\n');
  const html = `<section class="postCard"><div class="postView"><div class="postTextView"><p class="postText" style="white-space:pre-wrap">${['합성 제목', ...paragraphs.map((text,i)=> i < 17 ? text.replace('안내','  안내') : text), tags.map(tag=>`<button class="hashTag">${tag}</button>`).join(' ')].join('\n\n')}</p></div>
    <div class="postWriterInfo"><img class="mediaImg" src="https://profile.invalid/user.png"></div>
    <div class="_photoListRegion">${photos.map((url,i)=>i%3===0 ? `<div data-photo-url="${url}" data-photo-key="${i}"><img class="mediaImg"></div>` :
      i%3===1 ? `<img class="mediaImg" data-lazy-src="${url}" src="/placeholder.gif">` : `<div class="photoPlaceholder" data-original="${url}"></div>`).join('')}</div></div></section>`;
  await page.setContent(html);
  const cdp = await context.newCDPSession(page);
  const pressKey = vi.fn(async () => { throw Error('CDP_KEY_FAILURE'); });
  const s = { pressKey, evaluateReadOnly:async (expression:string) => {
    const r = await cdp.send('Runtime.evaluate',{expression,returnByValue:true,throwOnSideEffect:true});
    if (r.exceptionDetails) throw Error('READ_FAILED');
    return r.result.value;
  } } as unknown as Surface;
  const full = await settleFullBandPost(s, expected, photos, ()=>{}, 2500);
  expect(full.photos).toEqual(photos); expect(full.hashtags).toBe(4);
  await page.locator('._photoListRegion').evaluate(root => Array.from(root.children).slice(43).forEach(node=>node.remove()));
  await expect(settleFullBandPost(s,expected,photos,()=>{},1000)).rejects.toMatchObject({
    issues:[{field:'photo',expected:66,observed:43}],
  });
  await page.locator('section.postCard').evaluate(root=>root.setAttribute('data-photo-count','43'));
  await expect(settleFullBandPost(s,expected,photos,()=>{},1500)).rejects.toMatchObject({
    issues:[{field:'photo',expected:66,observed:43,missing:true}],
  });
  expect(pressKey).not.toHaveBeenCalled();
}, 15000);
