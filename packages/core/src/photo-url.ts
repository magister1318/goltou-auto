/** Shared by original-file downloads and the browser's display-only photos. */
const sourcePhotoHosts = ['coresos-phinf.pstatic.net'];
export const photoCspSources = ['https://goltou.kr', 'https://*.goltou.kr', ...sourcePhotoHosts.map(host => `https://${host}`)].join(' ');

export function goltouPhotoUrl(url: URL): boolean {
  return url.protocol === 'https:' && !url.port && !url.username && !url.password &&
    (url.hostname === 'goltou.kr' || url.hostname.endsWith('.goltou.kr') || sourcePhotoHosts.includes(url.hostname));
}
