import { afterEach, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import type { Surface } from '@goltou/surface';
import type { SurfaceHost, GuardedRequest, GuardedResponse } from '@goltou/surface';
import { BandDirectory } from '../src/band/plan';
import { createdBandPosts, normalizedBandBody, readFullBandPost, verifyFullBandPost } from '../src/band/posted';

let browser: Browser | undefined;
afterEach(async () => { await browser?.close(); });
const title = '합성 시험 제목';
const post = (extra = {}) => ({ content: title + '\n본문\n<band:hashtag>#합성</band:hashtag>', band: { band_no: 111 }, post_no: 9001, web_url: 'https://band.us/band/111/post/9001', created_at: 1700000000000, author: { me: true }, photo_count: 10, ...extra });
describe('immediate publication proof from the posting context', () => {
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
  it('rereads the actual full-post DOM, 158 breaks, 29 ordered images, 2 tags and 2 links', async () => {
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    const context = await browser.newContext(); await context.route('**/*', route => route.abort());
    const page = await context.newPage();
    const text = Array.from({ length: 159 }, (_, i) => i === 158 ? '#합성 #태그 https://example.invalid/a https://example.invalid/b' : `합성 줄 ${i}`).join('\n');
    const photos = Array.from({ length: 29 }, (_, i) => `https://photos.invalid/synthetic-${i}.jpg`);
    await page.setContent('<div class="postsDetailArea"><div class="_contentListRegion"><p class="txtBody" style="white-space:pre-wrap"></p>' + photos.map(url => `<img class="mediaImg" src="${url}">`).join('') + '</div></div>');
    await page.locator('p').evaluate((element, value) => { element.textContent = value; element.innerHTML = element.innerHTML.replace(/#합성|#태그/g, '<button class="hashTag">$&</button>').replace(/https:\/\/example.invalid\/[ab]/g, '<a href="$&">$&</a>'); }, text);
    const surface = { evaluateReadOnly: <T>(expression: string) => page.evaluate<T>(expression) } as Surface;
    const actual = await readFullBandPost(surface); expect(actual).toMatchObject({ body: text, lineBreaks: 158, hashtags: 2, links: 2 });
    expect(() => verifyFullBandPost(text, photos, actual!)).not.toThrow();
    for (const changed of [{ ...actual!, body: text.replace('합성 줄 2', '바뀐 줄 2') }, { ...actual!, lineBreaks: 157 }, { ...actual!, photos: [...photos].reverse() }, { ...actual!, photos: photos.slice(1) }, { ...actual!, hashtags: 1 }, { ...actual!, links: 1 }]) expect(() => verifyFullBandPost(text, photos, changed)).toThrow('BAND_PUBLISHED_READBACK_MISMATCH');
    expect(normalizedBandBody(text + '\n')).toBe(text);
  });
});
