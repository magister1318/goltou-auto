import { describe, expect, it } from 'vitest';
import type { GuardedRequest, Surface } from '@goltou/surface';
import { blogDeleteFields, guardRecordedBlogDelete, inspectBlogDeleteRequest } from '../src/naver-blog/delete';
const target = 'https://blog.naver.com/synthetic/9001';
const form = () => new URLSearchParams(blogDeleteFields.map(key => [key, key === 'blogId' ? 'synthetic' : key === 'logNo' ? '9001' : '0']));
const request = (): GuardedRequest => ({url:'https://blog.naver.com/PostDelete.naver',method:'POST',contentType:'application/x-www-form-urlencoded; charset=UTF-8',postDataComplete:true,postData:form().toString()});
describe('observed blog deletion form', () => {
 it('consumes one decision and lets redirects be verified by page reads without fetching their bodies', async () => {
  let inspect!: (request: GuardedRequest) => boolean | Promise<boolean>;
  let observe!: (request: Pick<GuardedRequest, 'url' | 'method'>) => boolean;
  const surface = { guardRequests: async (rules, inspector, _response, observer) => {
   expect(rules).toEqual([{hostname:'blog.naver.com',pathname:'/PostDelete.naver'}]); inspect=inspector; observe=observer!;
  } } as Surface;
  await guardRecordedBlogDelete(surface,target);
  expect(await inspect(request())).toBe(true);
  expect(await inspect(request())).toBe(false);
  expect(observe(request())).toBe(false);
  await guardRecordedBlogDelete(surface,target);
  expect(await inspect({...request(),postDataComplete:false})).toBe(false);
  expect(await inspect(request())).toBe(false);
 });
 it('accepts only the complete form for the stored blog and post', () => { expect(inspectBlogDeleteRequest(request(),target)).toBe(true); });
 it.each(['blogId','logNo','duplicate','extra','missing','incomplete','method','route','query','type'] as const)('refuses %s changes', change => {
  const r=request(), f=form();
  if(change==='blogId'||change==='logNo')f.set(change,'different');
  if(change==='duplicate')f.append('logNo','9001');
  if(change==='extra')f.append('unknown','0');
  if(change==='missing')f.delete('sourceCode');
  r.postData=f.toString();
  if(change==='incomplete')r.postDataComplete=false;
  if(change==='method')r.method='GET';
  if(change==='route')r.url='https://blog.naver.com/other';
  if(change==='query')r.url+='?logNo=9001';
  if(change==='type')r.contentType='application/json';
  expect(inspectBlogDeleteRequest(r,target)).toBe(false);
 });
});
