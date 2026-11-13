import type { Product } from '@goltou/api-client';
import { makePreview } from '../../src/preparation';

/** Invented content only. Mirrors observed structure, never a copied product or account. */
export function realEnding(files: readonly { url: string }[], withTags: boolean) {
  const photo = (i: number) => `<img src="${files[i]!.url}">`;
  const paragraphs = Array.from({ length: 44 }, (_, i) => i === 42
    ? '<p><a href="https://example.invalid/detail">예시 링크</a></p>'
    : `<p><font>안내 ${i + 1}</font> <del>이전 안내</del> <u>확인</u> <i>예시</i></p>`).join('');
  const product: Product = { productNo: 1, title: '[골투오토 실험] 로컬 끝 구조', country: '', region: '',
    contentsHtml: '', images: files.map((f, i) => ({ order: i + 1, url: f.url })),
    departures: [], golfCourses: ['끝글'], productUrl: 'https://example.invalid/product', updatedAt: '', contentHash: 'local-ending' };
  const options = { closing: false, linkCard: false, hashtags: withTags ? ['예시'] : [] };
  const html = (padding: string) => photo(0) + `<p>${padding}첫 안내</p>` + paragraphs + files.slice(1).map((_, i) => photo(i + 1)).join('');
  product.contentsHtml = html('');
  const characters = makePreview(product, options).blog.steps.reduce((n, s) => n + (s.kind === 'text' && s.role !== 'hashtags' ? Array.from(s.text).length : 0), 0);
  product.contentsHtml = html('가'.repeat(1509 - characters));
  return makePreview(product, options);
}
