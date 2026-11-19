import { matchesNavigation, type NavigationPolicy, type Surface } from '@goltou/surface';
import { detectLoginState } from './login';

export type LoginService = 'naver' | 'band';
export const serviceLoginUrls = {
  naver: 'https://nid.naver.com/nidlogin.login?svctype=262144&url=https%3A%2F%2Fm.blog.naver.com%2F',
  band: 'https://auth.band.us/login',
};
// Small account/home pages only: never open an editor to check authentication.
export const serviceCheckUrls = { naver: 'https://nid.naver.com/user2/help/myInfoV2?lang=ko_KR', band: 'https://band.us/' };
const hosts = (...names: string[]) => names.map(hostname => ({ hostname, pathname: '/', prefix: true }));
export function serviceNavigationPolicy(service: LoginService): NavigationPolicy {
  return {
    fallbackUrl: serviceLoginUrls[service],
    allowed: service === 'naver' ? hosts('nid.naver.com') : hosts('auth.band.us', 'nid.naver.com'),
    // These hosts may complete authentication, but their contents are never shown.
    landing: service === 'naver' ? hosts('m.blog.naver.com', 'blog.naver.com', 'm.naver.com', 'www.naver.com', 'naver.com')
      : hosts('band.us', 'www.band.us'),
  };
}
export function loginLocation(service: LoginService, url: string): 'auth' | 'landing' | 'blocked' {
  const policy = serviceNavigationPolicy(service);
  return matchesNavigation(url, policy.allowed) ? 'auth' : matchesNavigation(url, policy.landing) ? 'landing' : 'blocked';
}
/** Only a three-state indicator leaves the page, with no input values or page samples. */
export async function serviceLoginState(surface: Surface) {
  const state = await detectLoginState(surface);
  if (state !== 'unknown' || surface.session !== 'band') return state;
  return surface.evaluateReadOnly<'confirmed' | 'unknown'>(`(() => {
    if (!['band.us','www.band.us'].includes(location.hostname)) return 'unknown';
    return document.querySelector('._myBandListWrap,.globalMyBandWrap,.myBandGroupList') ? 'confirmed' : 'unknown';
  })()`);
}
