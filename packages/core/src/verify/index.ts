import type { Product } from '@goltou/api-client';
import { assemble, parseContents, type ConvertOptions, type InputPlan, type ParsedContent } from '../convert';

/** Editors can supply this same observation after saving and reopening. No platform APIs. */
export interface Observation {
  title: string; text: string; paragraphs: string[]; photos: string[];
  prices: string[]; departures: string[]; golfCourses: string[];
}
export interface Difference { field: keyof Observation | 'characters' | 'paragraphCount'; message: string }
export interface Verification { matches: boolean; message: string; differences: Difference[]; counts: { characters: number; paragraphs: number; photos: number; prices: number; departures: number } }
export const compact = (text: string) => text.replace(/[\s\u200b-\u200d\ufeff]+/gu, '');
export function observePlan(plan: InputPlan): Observation {
  const result: Observation = { title: '', text: '', paragraphs: [], photos: [], prices: [], departures: [], golfCourses: [] };
  const all: string[] = [];
  for (const step of plan.steps) {
    if (step.kind === 'photos') { result.photos.push(...step.urls); continue; }
    if (step.kind === 'break') continue;
    const lines = step.kind === 'table' ? step.rows.map(row => row.join(' | ')) : [step.text];
    all.push(...lines);
    if (step.role === 'title') result.title = lines.join('\n');
    if (step.role === 'body') result.paragraphs.push(...lines);
    if (step.role === 'courses') result.golfCourses.push(...lines);
    if (step.role === 'departures') for (const line of lines) {
      result.departures.push(line.match(/^([^|]+)\s*\|/)?.[1]?.trim() ?? '');
      result.prices.push(line.match(/\|\s*(.*)원$/)?.[1]?.trim() ?? '');
    }
  }
  result.text = all.join('\n'); return result;
}
export function compareDocuments(expected: Observation, actual: Observation): Verification {
  const differences: Difference[] = [];
  const names: Record<keyof Observation, string> = { title: '제목', text: '본문 글자', paragraphs: '문단 내용·순서', photos: '사진 수·순서', prices: '가격 개수·값', departures: '출발일 개수·값', golfCourses: '골프장 이름' };
  for (const field of Object.keys(names) as (keyof Observation)[]) {
    const a = expected[field], b = actual[field];
    const same = typeof a === 'string' && typeof b === 'string' ? compact(a) === compact(b) : Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => field === 'photos' ? v === b[i] : compact(v) === compact(b[i] ?? ''));
    if (!same) differences.push({ field, message: `${names[field]} 항목이 원문과 다릅니다.` });
  }
  if (compact(expected.text).length !== compact(actual.text).length) differences.push({ field: 'characters', message: '공백을 정리한 글자 수가 다릅니다.' });
  if (expected.paragraphs.length !== actual.paragraphs.length) differences.push({ field: 'paragraphCount', message: '문단 수가 다릅니다.' });
  const counts = { characters: compact(actual.text).length, paragraphs: actual.paragraphs.length, photos: actual.photos.length, prices: actual.prices.length, departures: actual.departures.length };
  return { matches: !differences.length, differences, counts, message: differences.length ? differences.map(d => d.message).join(' ') : `원문과 일치합니다. 가격 ${counts.prices}, 출발일 ${counts.departures}, 사진 ${counts.photos}` };
}
export function verifyPlan(product: Product, plan: InputPlan, options: ConvertOptions = {}, approvedContent: ParsedContent = parseContents(product.contentsHtml)): Verification {
  const expected = observePlan(assemble(product, plan.channel, options, approvedContent));
  // Authoritative API arrays, rather than plan metadata, determine facts and image order.
  expected.photos = [...product.images].sort((a, b) => a.order - b.order).map(i => i.url);
  expected.prices = product.departures.map(d => String(d.price));
  expected.departures = product.departures.map(d => d.date);
  expected.golfCourses = [...product.golfCourses];
  const result = compareDocuments(expected, observePlan(plan));
  if (plan.discarded.some(d => d.reason.startsWith('unsupported-layout:'))) {
    result.matches = false; result.differences.push({ field: 'photos', message: '표 안의 사진 위치를 보존할 수 없어 등록을 멈춥니다.' });
    result.message = result.differences.map(d => d.message).join(' ');
  }
  return result;
}
