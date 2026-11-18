import type { Surface } from '@goltou/surface';
import { read } from '../dom';

export interface BandListRow { key: string; name: string; writable?: boolean }
export function isBandListEndpoint(url: URL) {
  return url.protocol === 'https:' && (url.hostname === 'band.us' || url.hostname.endsWith('.band.us')) &&
    /^\/v\d+(?:\.\d+)*\/get_band_list$/.test(url.pathname);
}
/** Only the already-observed membership response is read. Never issue an API request. */
export function parseBandList(body: string): BandListRow[] | undefined {
  try {
    const value = JSON.parse(body);
    if (!value || typeof value !== 'object' || value.result_code !== undefined && value.result_code !== 1) return;
    const root = value.result_data ?? value.result ?? value;
    const rows = new Map<string, BandListRow>();
    let visited = 0, foundList = Array.isArray(root), truncated = false;
    const walk = (node: unknown, depth: number) => {
      if (!node || typeof node !== 'object') return;
      if (++visited > 20000 || depth > 10) { truncated = true; return; }
      if (Array.isArray(node)) { for (const child of node) walk(child, depth + 1); return; }
      const item = node as Record<string, unknown>;
      const band = item.band && typeof item.band === 'object' ? item.band as Record<string, unknown> : item;
      const key = band.band_no ?? band.band_key;
      const name = band.band_name ?? band.name;
      if ((typeof key === 'string' && /^\d+$/.test(key) || typeof key === 'number' && Number.isSafeInteger(key) && key > 0) && typeof name === 'string' && name.trim()) {
        const permissions = item.permissions && typeof item.permissions === 'object' ? item.permissions as Record<string, unknown> : {};
        const flags = [band.can_write_post, band.can_write, band.is_writable, band.writable, item.can_write_post, item.can_write, item.is_writable, item.writable, permissions.can_write_post, permissions.write_post];
        const permission = flags.map(flag => flag === true || flag === 1 || flag === 'true' || flag === '1' ? true
          : flag === false || flag === 0 || flag === 'false' || flag === '0' ? false : undefined);
        const writable = permission.includes(false) ? false : permission.includes(true) ? true : undefined;
        const row: BandListRow = { key: String(key), name: name.trim().slice(0, 100), ...(writable === undefined ? {} : { writable }) };
        const previous = rows.get(row.key);
        rows.set(row.key, previous?.writable === false || previous?.writable !== undefined && row.writable === undefined ? previous : row);
      }
      for (const [field, child] of Object.entries(item)) {
        if (['bands', 'band_list', 'items', 'bandList'].includes(field) && Array.isArray(child)) foundList = true;
        walk(child, depth + 1);
      }
    };
    walk(root, 0);
    return !truncated && (rows.size || foundList) ? [...rows.values()] : undefined;
  } catch { return undefined; }
}

/** Structural markers only: no page text or attributes are returned. */
export function bandListMarkers(surface: Surface) {
  return read<{ legacy: boolean; home: boolean; my: boolean; loginForm: boolean; tileCount: number }>(surface, `
    const has=selector=>docs.some(({d})=>!!d.querySelector(selector));
    return {legacy:has('._myBandListWrap'),home:has('.globalMyBandWrap'),my:has('.myBandGroupList'),
      loginForm:has('input[type="password"]')||docs.some(({d})=>Array.from(d.querySelectorAll('a,button')).some(n=>visible(n)&&/^(로그인|Log in|Sign in)$/i.test((n.textContent||'').trim()))),
      tileCount:docs.reduce((n,{d})=>n+Array.from(d.querySelectorAll('._myBandListWrap a.bandCover:not(._adBandCover),.myBandGroupList a.myBandGroupItem')).filter(e=>!e.querySelector('.adBox,.aNewFolder,.aNewFolderBox')).length,0)};`);
}
