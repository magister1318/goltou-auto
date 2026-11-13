import type { ApiClient, Product } from '@goltou/api-client';
import { ApiError } from '@goltou/api-client';
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import { parseContents, assemble, type InputPlan } from './convert';
import { observePlan, verifyPlan } from './verify';
import { observePlanSource, observeSource } from './verify/source';

export interface ConversionMetric {
  productNo: number;
  blocks: { paragraph: number; image: number; table: number; rule: number; link: number };
  tables: number; tablesWithImages: number; photos: number;
  textFallbackElements: string[]; bodyCharacters: number;
  blog: PlanMetric | null; band: PlanMetric | null;
  failureCode: 'CONVERSION_FAILED' | 'PRODUCT_READ_FAILED' | 'SOURCE_MISMATCH' | null;
}
interface PlanMetric {
  characters: number; photos: number; sourceMatches: boolean;
  numbersPreserved: boolean; pricesPreserved: boolean; datesPreserved: boolean;
  // No site opens are allowed here. Limits must be independently observed, never guessed.
  textLimit: number | null; photoLimit: number | null;
  textLimitExceeded: boolean | null; photoLimitExceeded: boolean | null;
}
export interface ConversionAudit { items: ConversionMetric[]; completed: boolean; failureCode: 'AUDIT_STOPPED' | 'API_FAILED' | null }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const numbers = (text: string) => text.match(/[0-9]+/g) ?? [];
function empty(productNo: number): ConversionMetric {
  return { productNo, blocks: { paragraph: 0, image: 0, table: 0, rule: 0, link: 0 }, tables: 0, tablesWithImages: 0, photos: 0, textFallbackElements: [], bodyCharacters: 0, blog: null, band: null, failureCode: null };
}
export function conversionMetric(product: Product, limits: { text: number | null; photos: number | null } = { text: null, photos: null }): ConversionMetric {
  const result = empty(product.productNo);
  try {
    const parsed = parseContents(product.contentsHtml);
    for (const block of parsed.blocks) result.blocks[block.kind]++;
    type Node = DefaultTreeAdapterMap['node'];
    const ignored = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'input', 'meta', 'link']);
    const supported = new Set(['p', 'div', 'section', 'article', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'pre', 'ul', 'ol', 'figure', 'figcaption', 'img', 'br', 'hr', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'a', 'b', 'strong', 'span']);
    const fallbacks = new Set<string>();
    const hasImage = (node: Node): boolean => 'tagName' in node && !ignored.has(node.tagName) && (node.tagName === 'img' || node.childNodes.some(hasImage));
    const hasText = (node: Node): boolean => node.nodeName === '#text' && 'value' in node ? !!node.value.trim() : 'childNodes' in node && node.childNodes.some(hasText);
    function walk(node: Node) {
      if (!('tagName' in node) || ignored.has(node.tagName)) return;
      if (node.tagName === 'table') { result.tables++; if (hasImage(node)) result.tablesWithImages++; }
      if (!supported.has(node.tagName) && hasText(node)) fallbacks.add(/^[a-z][a-z0-9-]{0,31}$/.test(node.tagName) ? node.tagName : 'other');
      for (const child of node.childNodes) walk(child);
    }
    for (const node of parseFragment(product.contentsHtml).childNodes) walk(node);
    result.textFallbackElements = [...fallbacks].sort();
    const source = observeSource(product.contentsHtml);
    result.bodyCharacters = source.text.length;
    const leading = [...product.images].sort((a, b) => a.order - b.order).filter(i => !source.photos.includes(i.url)).map(i => i.url);
    const summarize = (plan: InputPlan): PlanMetric => {
      const actual = observePlan(plan);
      const body = observePlanSource(plan, leading);
      // Same text serialization as bandText, without importing any site executor.
      const characters = plan.steps.flatMap(s => s.kind === 'text' ? [s.text] : s.kind === 'table' ? s.rows.map(r => r.join(' | ')) : []).join('\n\n').length;
      const textLimit = plan.channel === 'band' ? limits.text : null, photoLimit = plan.channel === 'band' ? limits.photos : null;
      return { characters, photos: actual.photos.length, sourceMatches: verifyPlan(product, plan, {}, parsed).matches,
        numbersPreserved: same(numbers(source.text), numbers(body.text)),
        pricesPreserved: same(actual.prices, product.departures.map(d => String(d.price))),
        datesPreserved: same(actual.departures, product.departures.map(d => d.date)),
        textLimit, photoLimit, textLimitExceeded: textLimit === null ? null : characters > textLimit,
        photoLimitExceeded: photoLimit === null ? null : actual.photos.length > photoLimit };
    };
    result.blog = summarize(assemble(product, 'blog', {}, parsed));
    result.band = summarize(assemble(product, 'band', {}, parsed));
    result.photos = result.blog.photos;
    if (!result.blog.sourceMatches || !result.band.sourceMatches) result.failureCode = 'SOURCE_MISMATCH';
  } catch { result.failureCode = 'CONVERSION_FAILED'; }
  return result;
}

/** Debug-only caller supplies an authenticated session. At most 60 products, no writes/sites. */
export async function auditConversions(api: ApiClient, token: string, persist: (result: ConversionAudit) => Promise<void>, check: () => void,
  wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms))): Promise<ConversionAudit> {
  const result: ConversionAudit = { items: [], completed: false, failureCode: null };
  let first = true;
  async function request<P extends '/auto/products/list' | '/auto/products/get'>(route: P, input: import('@goltou/api-client').ApiRoutes[P]['input']) {
    check(); if (!first) { await wait(1000); check(); } first = false;
    return api.request(route, input, token);
  }
  try {
    const seen = new Set<number>();
    for (let page = 1; page <= 2; page++) {
      const products = await request('/auto/products/list', { sort: 'recent', page, pageSize: 30 });
      for (const item of products.items.slice(0, 30)) {
        if (seen.has(item.productNo)) continue;
        seen.add(item.productNo);
        let product: Product;
        try { product = await request('/auto/products/get', { productNo: item.productNo }); }
        catch (error) {
          if (!(error instanceof ApiError) || error.code !== 'not_found') throw error;
          result.items.push({ ...empty(item.productNo), failureCode: 'PRODUCT_READ_FAILED' });
          await persist(result); continue;
        }
        result.items.push(conversionMetric(product));
        await persist(result);
      }
      if (products.items.length < 30 || page * 30 >= products.total) break;
    }
    result.completed = true;
  } catch (error) {
    result.failureCode = error instanceof ApiError ? 'API_FAILED' : 'AUDIT_STOPPED';
    await persist(result);
    throw error;
  }
  await persist(result); return result;
}
