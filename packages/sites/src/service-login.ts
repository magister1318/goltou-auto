import { matchesNavigation, type NavigationPolicy, type Surface } from '@goltou/surface';
import { detectLoginState } from './login';

export type LoginService = 'naver' | 'band';
export const serviceLoginUrls = {
  naver: 'https://nid.naver.com/nidlogin.login?svctype=262144&url=https%3A%2F%2Fm.blog.naver.com%2F',
  band: 'https://auth.band.us/login',
};
// Small account/home pages only: never open an editor to check authentication.
export const serviceCheckUrls = { naver: 'https://nid.naver.com/user2/help/myInfoV2?lang=ko_KR', band: 'https://band.us/' };
const naverAuth = [
  { hostname: 'nid.naver.com', pathname: '/nidlogin.login' },
  { hostname: 'nid.naver.com', pathname: '/login/', prefix: true },
  { hostname: 'nid.naver.com', pathname: '/oauth2.0/authorize' },
  { hostname: 'nid.naver.com', pathname: '/oauth2.0/authorize.nhn' },
];
export function serviceNavigationPolicy(service: LoginService): NavigationPolicy {
  return {
    fallbackUrl: serviceLoginUrls[service],
    allowed: service === 'naver' ? naverAuth : [
      ...naverAuth, // BAND's NAVER ID authentication option.
      ...['/login', '/email_login', '/phone_login', '/verify', '/auth', '/oauth', '/consent', '/callback', '/two_step', '/two_factor', '/captcha']
        .flatMap(pathname => [{ hostname: 'auth.band.us', pathname }, { hostname: 'auth.band.us', pathname: `${pathname}/`, prefix: true }]),
    ],
    landing: service === 'naver' ? [{ hostname: 'nid.naver.com', pathname: '/user2/help/myInfo' }, { hostname: 'nid.naver.com', pathname: '/user2/help/myInfoV2' },
      { hostname: 'm.blog.naver.com', pathname: '/' }, { hostname: 'm.blog.naver.com', pathname: '/Recommendation.naver' }]
      : [{ hostname: 'band.us', pathname: '/' }, { hostname: 'www.band.us', pathname: '/' }],
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
