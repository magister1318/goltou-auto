import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import type { Surface } from '@goltou/surface';
import { loginLocation, serviceLoginState, serviceLoginUrls } from '../src/service-login';

describe('WP15 authentication routes', () => {
  it.each([
    ['naver', serviceLoginUrls.naver, 'auth'], ['naver', 'https://nid.naver.com/login/ext/deviceConfirm.nhn', 'auth'],
    ['naver', 'https://nid.naver.com/oauth2.0/authorize', 'auth'], ['naver', 'https://m.blog.naver.com/', 'landing'],
    ['naver', 'https://m.blog.naver.com/Recommendation.naver', 'landing'],
    ['naver', 'https://nid.naver.com/user2/help/myInfo?lang=ko_KR', 'auth'],
    ['naver', 'https://nid.naver.com/user2/help/myInfoV2?lang=ko_KR', 'auth'],
    ['naver', 'https://nid.naver.com/login/ext/deviceConfirm', 'auth'],
    ['naver', 'https://nid.naver.com/captcha/new-step', 'auth'],
    ['naver', 'https://m.naver.com/', 'landing'], ['naver', 'https://www.naver.com/next', 'landing'],
    ['naver', 'https://naver.com/', 'landing'], ['naver', 'https://blog.naver.com/someid', 'landing'],
    ['naver', 'https://m.blog.naver.com/next', 'landing'],
    ['band', serviceLoginUrls.band, 'auth'], ['band', 'https://auth.band.us/email_login', 'auth'],
    ['band', 'https://auth.band.us/phone_login', 'auth'], ['band', 'https://auth.band.us/verify/otp', 'auth'],
    ['band', 'https://auth.band.us/consent', 'auth'], ['band', serviceLoginUrls.naver, 'auth'], ['band', 'https://band.us/', 'landing'],
    ['band', 'https://www.band.us/about/kr/intro', 'landing'],
    ['band', 'https://auth.band.us/external_account_login', 'auth'],
    ['band', 'https://auth.band.us/naver/callback', 'auth'],
    ['band', 'https://nid.naver.com/login/ext/deviceConfirm', 'auth'],
    ['band', 'https://band.us/band/123/post', 'landing'],
    ['band', 'https://www.band.us/next', 'landing'],
    ['naver', 'https://auth.band.us/login', 'blocked'], ['naver', 'https://band.us/', 'blocked'],
    ['band', 'https://m.naver.com/', 'blocked'],
  ] as const)('%s %s is %s', (service, url, location) => { expect(loginLocation(service, url)).toBe(location); });
  it.each(['about:blank', 'javascript:alert(1)', 'intent://band.us/', 'market://details', 'https://play.google.com/store',
    'http://auth.band.us/login', 'https://auth.band.us:8443/login', 'https://user@auth.band.us/login',
    'https://auth.band.us.evil.test/login', 'https://nid.naver.com.evil.test/nidlogin.login',
    'https://example.com/', 'https://naver.com.evil.test/', 'https://band.us.evil.test/',
  ])('blocks %s for both login surfaces', url => { expect(loginLocation('naver', url)).toBe('blocked'); expect(loginLocation('band', url)).toBe('blocked'); });
});
describe('WP15 read-only login indicators', () => {
  it.each([
    ['naver', 'https://m.blog.naver.com/', '<a href="/logout">로그아웃</a>', 'confirmed'],
    ['naver', serviceLoginUrls.naver, '<input type="password">', 'expired'],
    ['naver', 'https://m.blog.naver.com/', '<p>no signal</p>', 'unknown'],
    ['band', 'https://band.us/', '<div class="globalMyBandWrap"></div>', 'confirmed'],
    ['band', 'https://band.us/', '<div class="_myBandListWrap"></div>', 'confirmed'],
    ['band', serviceLoginUrls.band, '<input type="password">', 'expired'],
    ['band', 'https://example.com/', '<a href="/logout">로그아웃</a>', 'unknown'],
  ] as const)('returns only %s signal at %s (%s)', async (session, url, html, expected) => {
    const dom = new JSDOM(html + '<input value="SECRET_ACCOUNT"><input type="password" value="SECRET_PASSWORD">', { url, runScripts: 'outside-only' });
    Object.defineProperty(dom.window.HTMLInputElement.prototype, 'value', { get() { throw Error('CREDENTIAL_READ'); } });
    const expressions: string[] = [];
    const surface = { session, evaluateReadOnly: async (expression: string) => { expressions.push(expression); return dom.window.eval(expression); } } as Surface;
    expect(await serviceLoginState(surface)).toBe(expected);
    expect(expressions.join(' ')).not.toMatch(/\.value|document\.cookie|localStorage|sessionStorage/);
    dom.window.close();
  });
});
