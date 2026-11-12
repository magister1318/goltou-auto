import type { Product } from '@goltou/api-client';
export const fixtureCases = [
  { name: 'table', label: '표', photos: 0, paragraphs: 2, tables: 1 },
  { name: 'photos-only', label: '사진만', photos: 3, paragraphs: 0, tables: 0 },
  { name: 'interleaved', label: '사진·글 교차', photos: 3, paragraphs: 3, tables: 0 },
  { name: 'messy', label: '붙여넣기 흔적', photos: 1, paragraphs: 2, tables: 0 },
  { name: 'long', label: '장문', photos: 0, paragraphs: 40, tables: 0 },
  { name: 'empty', label: '빈 문단', photos: 0, paragraphs: 1, tables: 0 },
  { name: 'links-bold', label: '링크·강조', photos: 0, paragraphs: 2, tables: 0 },
  { name: 'broken', label: '깨진 태그', photos: 1, paragraphs: 3, tables: 0 },
] as const;
export function fixtureProduct(contentsHtml: string, photos: number): Product {
  return { productNo: 4, title: 'WP4 가상 상품', country: '예시 국가', region: '예시 지역', contentsHtml,
    images: Array.from({ length: photos }, (_, i) => ({ order: i + 1, url: `http://127.0.0.1:19004/photo-${i + 1}.png` })),
    departures: [{ date: '2026-12-03', price: 1190000 }, { date: '2026-12-10', price: 1250000 }],
    golfCourses: ['예시CC'], productUrl: 'https://example.invalid/product/4', contentHash: 'synthetic-wp4', updatedAt: '2026-11-12T00:00:00Z' };
}
