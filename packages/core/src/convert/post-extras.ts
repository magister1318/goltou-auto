import type { MyText, Product, User } from '@goltou/api-client';
import { cleanBlogTag } from '@goltou/sites';

export interface ProductTag { text: string; kind: 'country' | 'region' | 'course' | 'word' }
export function productTags(product: Pick<Product, 'country' | 'region' | 'golfCourses'>, words: readonly string[]): ProductTag[] {
  const seen = new Set<string>();
  const candidates: ProductTag[] = [
    { text: product.country, kind: 'country' }, { text: product.region, kind: 'region' },
    ...product.golfCourses.map(text => ({ text, kind: 'course' as const })),
    ...words.map(text => ({ text, kind: 'word' as const })),
  ];
  return candidates.flatMap(({ text, kind }) => {
    const tag = cleanBlogTag(text);
    if (!tag || seen.has(tag)) return [];
    seen.add(tag);
    return [{ text: tag, kind }];
  });
}

export function fillMyText(text: string, user: Pick<User, 'name' | 'nickname' | 'phone'>): string {
  const phone = user.phone ?? '';
  const template = phone ? text : text.replace(/[ \u00a0]?\{휴대폰\}[ \u00a0]?/g, match => /^[ \u00a0]/.test(match) && /[ \u00a0]$/.test(match) ? match.slice(-1) : '');
  return template.replace(/\{(닉네임|휴대폰)\}/g, (_, key) => key === '닉네임' ? user.nickname || user.name : phone);
}

export function validMyText(value: MyText): boolean {
  return !!value && typeof value.prefix === 'string' && [...value.prefix].length <= 500 &&
    typeof value.closing === 'string' && [...value.closing].length <= 1000 && typeof value.closingOn === 'boolean';
}
