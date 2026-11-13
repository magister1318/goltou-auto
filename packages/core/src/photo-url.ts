/** Shared by original-file downloads and the browser's display-only photos. */
export function goltouPhotoUrl(url: URL): boolean {
  return url.protocol === 'https:' && !url.port && !url.username && !url.password && (url.hostname === 'goltou.kr' || url.hostname.endsWith('.goltou.kr'));
}
