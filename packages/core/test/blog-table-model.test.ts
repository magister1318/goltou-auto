import { expect, it } from 'vitest';
import { parseContents, assemble } from '../src/convert';
import type { Product } from '@goltou/api-client';

it('preserves source table dimensions, empty cells, newlines and cell bold/link runs in the Blog model', () => {
  const parsed = parseContents('<p>앞</p><table><tr><td><b>가  나</b></td><td><a href="https://example.invalid/a%2Fb?x=1&amp;y=2">문의</a><p>다음</p></td></tr><tr><td></td><td>끝</td></tr></table><p>뒤</p>');
  const table = parsed.blocks.find(b=>b.kind==='table')!;
  expect(table).toMatchObject({rows:[['가 나','문의\n다음'],['','끝']],cellRuns:[[[{text:'가 나',bold:true}],[{text:'문의',href:'https://example.invalid/a%2Fb?x=1&y=2'},{text:'\n'},{text:'다음'}]],[[],[{text:'끝'}]]]});
  const product = {title:'합성',images:[],departures:[{date:'2027-01-02',price:123}],golfCourses:[]} as unknown as Product;
  const plan=assemble(product,'blog',{},parsed);
  expect(plan.steps.filter(s=>s.kind==='table')).toEqual([{kind:'table',role:'body',rows:table.rows,cellRuns:table.cellRuns},{kind:'table',role:'departures',rows:[['2027-01-02','123원']]}]);
});
