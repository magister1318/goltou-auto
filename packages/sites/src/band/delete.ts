import { traceStep, trace, reasonCode } from '@goltou/surface/telemetry';
import type { Surface, SurfaceHost } from '@goltou/surface';
import { read, sleep } from '../dom';
import { requestFields } from '../naver-blog/request-fields';
import { bandMobileUA } from './plan';
import { dismissBandAppPrompt } from './app-prompt';

export type BandDeleteResult = {
  status: 'deleted' | 'not_started' | 'uncertain';
  alreadyAbsent?: boolean;
};
export function bandPostIdentity(value: string) {
  try {
    const u = new URL(value);
    const m = u.pathname.match(/^\/band\/(\d+)\/post\/(\d+)\/?$/);
    if (
      u.protocol !== 'https:' ||
      !['band.us', 'www.band.us'].includes(u.hostname) ||
      u.username ||
      u.password ||
      u.port ||
      u.search ||
      u.hash ||
      !m
    )
      return null;
    return {
      band: m[1]!,
      post: m[2]!,
      url: `https://band.us/band/${m[1]}/post/${m[2]}`,
    };
  } catch {
    return null;
  }
}
export const bandDeleteSelectors = {
  post: '.postView[data-band-key][data-post-key][data-is-owner="true"]',
  body: '.postTextView',
  permalink: 'a._postPermalink',
  menuButton: 'button._btnPostMore[aria-label="게시글 메뉴"]',
  menu: '.postMenu[role="menu"]',
  remove: 'button._btnPostDelete[role="menuitem"]',
  dialog: '.deletePostDialog[role="alertdialog"]',
  confirm: 'button._confirmDelete',
  gone: '.postDeleted[data-band-key][data-post-key]',
} as const;
const sameUrl = (a: string, b: string) => bandPostIdentity(a)?.url === b;
/** Deliberately conservative fixture contract. Unknown real markup stops before input. */
export async function deleteRecordedBandPost(
  host: SurfaceHost,
  target: { url: string; title: string },
  timeoutMs = 10000,
): Promise<BandDeleteResult> {
    return traceStep('sites.band.delete.deleteRecordedBandPost', async () => {
  const identity = bandPostIdentity(target.url);
  if (!identity || !target.title.trim()) return { status: 'not_started' };
  let surface: Surface | undefined,
    attempted = false,
    armed = false,
    sent = false;
  try {
    surface = await host.create('band');
    const s = surface;
    if (!s.guardRequests || !s.readClickTarget || !s.readAppFocus)
      return { status: 'not_started' };
    await s.guardRequests(
      [{ hostname: '*', pathname: '/', prefix: true }],
      (request) => {
        const u = new URL(request.url);
        if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return true;
        if (
          !armed ||
          sent ||
          request.method !== 'POST' ||
          u.protocol !== 'https:' ||
          !['band.us', 'api-kr.band.us'].includes(u.hostname) ||
          !/^\/v[\d.]+\/band\/post\/delete$/.test(u.pathname) ||
          !request.postDataComplete
        )
          return false;
        try {
          const fields = requestFields(request).fields;
          const values = (key: string) =>
            fields.filter(([k]) => k === key).map(([, v]) => String(v.value));
          if (
            JSON.stringify(values('band_key')) !==
              JSON.stringify([identity.band]) ||
            JSON.stringify(values('post_key')) !==
              JSON.stringify([identity.post])
          )
            return false;
        } catch { trace('sites.band.delete.deleteRecordedBandPost', 'fail', { reason: 'CAUGHT_FAILURE' });
          return false;
        }
        armed = false;
        sent = true;
        return true;
      },
      () => {},
    );
    const open = async () => {
      await s.open({
        url: identity.url,
        session: 'band',
        width: 1280,
        height: 900,
        userAgent: bandMobileUA,
      });
      await dismissBandAppPrompt(s, identity.url);
    };
    const location = async () =>
      sameUrl((await s.readState()).url, identity.url);
    const gone = async () =>
      (await location()) &&
      read<boolean>(
        s,
        `return !docs.some(({d})=>d.querySelector('.postView')) && docs.some(({d})=>Array.from(d.querySelectorAll(${JSON.stringify(bandDeleteSelectors.gone)})).some(e=>visible(e)&&e.getAttribute('data-band-key')===${JSON.stringify(identity.band)}&&e.getAttribute('data-post-key')===${JSON.stringify(identity.post)}&&(e.textContent||'').trim()==='삭제된 게시글입니다.'));`,
      );
    const verifyIdentity = async () => {
      if (
        !(await location()) ||
        (await s.readDialog?.()) ||
        (await s.readAppFocus?.()) === false
      )
        throw Error('BAND_DELETE_IDENTITY');
      const verified = await read<boolean>(
        s,
        `const posts=docs.flatMap(({d})=>Array.from(d.querySelectorAll('.postView'))).filter(visible);const p=posts[0];
        if(posts.length!==1||!p||p.getAttribute('data-is-owner')!=='true'||p.getAttribute('data-band-key')!==${JSON.stringify(identity.band)}||p.getAttribute('data-post-key')!==${JSON.stringify(identity.post)})return false;
        const body=p.querySelectorAll(${JSON.stringify(bandDeleteSelectors.body)}), links=p.querySelectorAll(${JSON.stringify(bandDeleteSelectors.permalink)});
        return body.length===1&&(body[0].innerText||'').trim().split('\\n')[0].trim()===${JSON.stringify(target.title)}&&links.length===1&&links[0].href.replace('https://www.band.us/','https://band.us/').replace(/\\/$/,'')===${JSON.stringify(identity.url)};`,
      );
      if (!verified) throw Error('BAND_DELETE_IDENTITY');
    };
    // Read a unique control, prove identity and geometry twice, then hit-test again
    // in Surface's beforePress callback. No script changes the service document.
    const press = async (
      selector: string,
      label: string,
      destructive = false,
      extraCheck: () => Promise<boolean> = async () => true,
    ) => {
      const geometry = () =>
        read<{ x: number; y: number; width: number; height: number }[]>(
          s,
          `return docs.flatMap(({d,x,y})=>Array.from(d.querySelectorAll(${JSON.stringify(selector)})).filter(e=>visible(e)&&!e.disabled&&(e.textContent||e.getAttribute('aria-label')||'').trim()===${JSON.stringify(label)}).map(e=>{const r=e.getBoundingClientRect();return {x:x+r.left+r.width/2,y:y+r.top+r.height/2,width:r.width,height:r.height};}));`,
        );
      await verifyIdentity();
      if (!(await extraCheck())) throw Error('BAND_DELETE_CONTROL');
      const a = await geometry();
      await sleep(300);
      const b = await geometry();
      if (
        a.length !== 1 ||
        JSON.stringify(a) !== JSON.stringify(b) ||
        !a[0] ||
        !(await s.readClickTarget!(a[0].x, a[0].y, selector))
      )
        throw Error('BAND_DELETE_CONTROL');
      await s.click(a[0].x, a[0].y, async () => {
        await verifyIdentity();
        if (!(await extraCheck())) throw Error('BAND_DELETE_CONTROL');
        if (
          JSON.stringify(await geometry()) !== JSON.stringify(a) ||
          !(await s.readClickTarget!(a[0]!.x, a[0]!.y, selector))
        )
          throw Error('BAND_DELETE_CONTROL');
        if (destructive) {
          attempted = true;
          armed = true;
        }
      });
    };
    await open();
    if (await gone()) return { status: 'deleted' };
    await verifyIdentity();
    const root = `${bandDeleteSelectors.post}[data-post-key="${identity.post}"][data-band-key="${identity.band}"]`;
    await press(`${root} ${bandDeleteSelectors.menuButton}`, '게시글 메뉴');
    const menu = `${bandDeleteSelectors.menu}[data-post-key="${identity.post}"][data-band-key="${identity.band}"]`;
    // Opening a menu is harmless; an unproven menu never yields a delete click.
    await press(`${menu} ${bandDeleteSelectors.remove}`, '삭제');
    const dialog = `${bandDeleteSelectors.dialog}[data-post-key="${identity.post}"][data-band-key="${identity.band}"]`;
    const confirmed = () =>
      read<boolean>(
        s,
        `const ds=docs.flatMap(({d})=>Array.from(d.querySelectorAll(${JSON.stringify(bandDeleteSelectors.dialog)}))).filter(visible);return ds.length===1&&ds[0].getAttribute('data-post-key')===${JSON.stringify(identity.post)}&&ds[0].getAttribute('data-band-key')===${JSON.stringify(identity.band)}&&ds[0].querySelector('h2')?.textContent==='게시글을 삭제할까요?';`,
      );
    if (!(await confirmed())) throw Error('BAND_DELETE_CONFIRM');
    await press(
      `${dialog} ${bandDeleteSelectors.confirm}`,
      '삭제',
      true,
      confirmed,
    );
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (sent && (await gone())) {
        await open();
        if (await gone()) return { status: 'deleted' };
        break;
      }
      await sleep(250);
    }
    return { status: 'uncertain' };
  } catch (error) { trace('sites.band.delete.deleteRecordedBandPost', 'fail', { reason: reasonCode(error) });
    return { status: attempted ? 'uncertain' : 'not_started' };
  } finally {
    armed = false;
    if (surface) await host.destroy(surface).catch(() => {});
  }

    });
  }
