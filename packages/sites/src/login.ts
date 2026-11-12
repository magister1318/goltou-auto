// Reference: ../refs/DAF/daf3/modules/helper/src/workflow/{naver,naver-page}.ts (visible-page and write-redirect signals; cookie reading excluded).
import type { Surface } from '@goltou/surface';
import { read } from './dom';

export type LoginState = 'confirmed' | 'expired' | 'unknown';
export const loginUrls = { naver: 'https://nid.naver.com/nidlogin.login', band: 'https://auth.band.us/login' };
export const probeUrls = { naver: 'https://blog.naver.com/GoBlogWrite.naver', band: 'https://band.us/' };
export async function loginState(surface: Surface): Promise<LoginState> {
  // Return a three-state decision only, never cookie names/values, body samples, account names or identifiers.
  return read<LoginState>(surface, `
    const host=location.hostname, path=location.pathname;
    if ((host==='nid.naver.com' && /nidlogin/i.test(path)) || (host==='auth.band.us' && /login/i.test(path))) return 'expired';
    if (!(/(^|\\.)naver\\.com$/.test(host) || /(^|\\.)band\\.us$/.test(host))) return 'unknown';
    const links=docs.flatMap(({d})=>Array.from(d.querySelectorAll('a,button')));
    if (links.some(e=>/로그아웃|log\\s*out/i.test(e.textContent||'') || /logout/i.test(e.getAttribute('href')||''))) return 'confirmed';
    if (surfaceSession==='naver' && docs.some(({d})=>d.querySelector('.se-documentTitle')) && /GoBlogWrite|PostWriteForm/i.test(path)) return 'confirmed';
    const password=docs.some(({d})=>Array.from(d.querySelectorAll('input[type="password"]')).some(visible));
    if (password || (surfaceSession==='band' && links.some(e=>visible(e) && /^(로그인|Log in|Sign in)$/i.test((e.textContent||'').trim())))) return 'expired';
    return 'unknown';
  `.replaceAll('surfaceSession', JSON.stringify(surface.session)));
}
