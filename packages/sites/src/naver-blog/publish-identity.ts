import type { GuardedResponse } from '@goltou/surface';
import { jsonNode, type RequestNode } from './request-fields';
import { postIdentity, type PublishedPost } from './publish-safety';

export interface ResponseIdentity { post: PublishedPost | null; postId: string | null }
const empty = (): ResponseIdentity => ({ post: null, postId: null });
/** Only the previously supported response schema is understood. Unknown bodies
 * remain unknown; they cannot veto independent, unambiguous page evidence. */
export function parsePublishIdentity(response: GuardedResponse): ResponseIdentity {
  if (response.status !== 200) throw new Error('BLOG_PUBLISH_RESPONSE_REJECTED');
  let node: RequestNode;
  try { node = jsonNode(response.body); } catch { return empty(); }
  const unique = (n: RequestNode): void => {
    if (!n.entries) return;
    if (new Set(n.entries.map(([k]) => k)).size !== n.entries.length) throw new Error('BLOG_PUBLISH_ID_AMBIGUOUS');
    n.entries.forEach(([, value]) => unique(value));
  };
  unique(node);
  const root = node.value as Record<string, unknown> | null;
  if (!root || typeof root !== 'object' || Array.isArray(root)) return empty();
  if (root.isSuccess === false) throw new Error('BLOG_PUBLISH_RESPONSE_REJECTED');
  const values = [root, root.result].filter((v): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v));
  const ids = new Set<string>(), posts = new Map<string, PublishedPost>();
  for (const v of values) {
    if (typeof v.logNo === 'string' && /^\d+$/.test(v.logNo)) ids.add(v.logNo);
    else if (typeof v.logNo === 'number' && Number.isSafeInteger(v.logNo) && v.logNo >= 0) ids.add(String(v.logNo));
    else if (v.logNo !== undefined) return empty();
    for (const key of ['postUrl', 'url']) {
      if (v[key] === undefined) continue;
      const post = typeof v[key] === 'string' ? postIdentity(v[key]) : null;
      if (!post) return empty();
      ids.add(post.postId); posts.set(post.url, post);
    }
  }
  if (ids.size > 1 || posts.size > 1) throw new Error('BLOG_PUBLISH_ID_AMBIGUOUS');
  return { post: [...posts.values()][0] ?? null, postId: [...ids][0] ?? null };
}
export interface PublishedPage { url: string; titles: string[] }
export function resolvePublishIdentity(response: ResponseIdentity, navigationUrls: string[], pages: PublishedPage[], title: string): PublishedPost | null {
  const source = (urls: string[]) => {
    const posts = new Map(urls.map(postIdentity).filter((p): p is PublishedPost => !!p).map(p => [p.url, p]));
    if (posts.size > 1) throw new Error('BLOG_PUBLISH_ID_AMBIGUOUS');
    return [...posts.values()][0];
  };
  const matching = pages.filter(p => p.titles.includes(title));
  if (matching.some(p => p.titles.length !== 1)) throw new Error('BLOG_PUBLISH_ID_AMBIGUOUS');
  const candidates = [response.post, source(navigationUrls), source(matching.map(p => p.url))].filter((p): p is PublishedPost => !!p);
  if (new Set(candidates.map(p => p.url)).size > 1 || response.postId && candidates.some(p => p.postId !== response.postId)) throw new Error('BLOG_PUBLISH_ID_AMBIGUOUS');
  return candidates[0] ?? null;
}
