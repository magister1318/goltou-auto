import { describe, expect, it } from 'vitest';
import { compareBlogFormatting, sameServiceBlogTags, type BlogPlan } from '../src';
import { verifyFullBandPost, type FullBandPost } from '../src/band/posted';
import { compareReadbackText, numberFacts, tokenText } from '../src/readback-checks';

const url='https://example.invalid/guide';
const band=(body:string,label=url,href=url):FullBandPost=>({body,photos:[],lineBreaks:(body.match(/\n/g)??[]).length,hashtags:0,links:1,tagTexts:[],linkUrls:[href],tagTokens:[],linkTokens:[{text:label,href,start:tokenText(body).indexOf(tokenText(label))}]});
const plan=(text:string):BlogPlan=>({channel:'blog',steps:[{kind:'text',role:'body',text}]});
describe('service-owned autolink and hashtag boundaries',()=>{
  it.each([')',']','.',',','!','?','"',"'",'에서','을','\n다음 줄'])('accepts the service URL prefix before %s while retaining all body text',suffix=>{
    const body=`참고 (${url}${suffix}`;
    expect(()=>verifyFullBandPost(body,[],band(body))).not.toThrow();
    const blog=plan(body);
    expect(compareBlogFormatting(blog,{title:'',tags:[],tokens:body.split('\n').map((text,index)=>({kind:'text',text,runs:index===0?[{text:'참고 ('},{text:url,href:url},...(suffix.startsWith('\n')?[]:[{text:suffix}])]:[{text}]}))})).toEqual([]);
  });
  it('accepts a URL at line end, encoded Korean and balanced URL parentheses',()=>{
    for(const value of [url+'\n다음 줄','https://example.invalid/한글','https://example.invalid/guide_(part)']) {
      const label=value.split('\n')[0]!;
      expect(()=>verifyFullBandPost(value,[],band(value,label,new URL(label).href))).not.toThrow();
    }
  });
  it('does not invent required derived counts when the complete body matches',()=>{
    const body=`${url}에서 #태그,다음 #다른태그!`;
    const actual={...band(body),links:0,linkUrls:[],linkTokens:[],hashtags:1,tagTexts:['#태그'],tagTokens:[{text:'#태그',start:tokenText(body).indexOf('#태그')}]};
    expect(()=>verifyFullBandPost(body,[],actual)).not.toThrow();
    expect(sameServiceBlogTags(plan(body),['태그'])).toBe(true);
    expect(sameServiceBlogTags(plan(body),['태그,다음','다른태그'])).toBe(true);
    for(const tags of [['외부'],['태그','태그']]) expect(sameServiceBlogTags(plan(body),tags)).toBe(false);
    expect(sameServiceBlogTags({...plan(body),steps:[...plan(body).steps,{kind:'text',role:'hashtags',text:'#명시태그'}]},['태그'])).toBe(false);
  });
  it('rejects a destination from another position even if it appears elsewhere in the plan',()=>{
    const other='https://example.invalid/other',body=`${url} ${other}`,actual=band(body);
    const changed={...actual,linkUrls:[other],linkTokens:[{...actual.linkTokens[0]!,href:other}]};
    expect(()=>verifyFullBandPost(body,[],changed)).toThrowError(expect.objectContaining({issues:[{field:'href',index:1}]}));
    expect(compareBlogFormatting(plan(body),{title:'',tags:[],tokens:[{kind:'text',text:body,runs:[{text:url,href:other},{text:' '+other}]}]})).toContainEqual({paragraph:1,fields:['href']});
  });
  it.each(['공 백','공\n\n백','ＡＢＣ','✈️','👩‍💻','가'.normalize('NFD')])('does not treat typography or whitespace differences as missing paragraphs (%s)',body=>{
    const changed=body==='공 백'?'공백':body==='공\n\n백'?'공\n백':body==='ＡＢＣ'?'ABC':body==='✈️'?'✈':body==='👩‍💻'?'👩💻':'가';
    expect(()=>verifyFullBandPost(body,[],{...band(changed),links:0,linkUrls:[],linkTokens:[]})).not.toThrow();
    const issues=compareBlogFormatting(plan(body),{title:'',tags:[],tokens:changed.split('\n').filter(Boolean).map(text=>({kind:'text',text,runs:[{text}]}))});
    expect(issues).toEqual([]);
  });
});

it('records only whitespace or changes up to three per paragraph and one percent as tolerated', () => {
  const first = '가'.repeat(300), second = '나'.repeat(100);
  expect(compareReadbackText([first, second], [first + ' \n' + second])).toMatchObject({ tolerated: true, changed: 0 });
  expect(compareReadbackText([first, second], ['다다다' + first.slice(3), '라' + second.slice(1)])).toMatchObject({ tolerated: true, changed: 4 });
  expect(compareReadbackText([first, second], ['다다다다' + first.slice(4), second])).toMatchObject({ tolerated: false });
  expect(compareReadbackText([first, second], ['다다다' + first.slice(3), '라라' + second.slice(2)])).toMatchObject({ tolerated: false });
  expect(compareReadbackText([first, '중요', second], [first + second])).toMatchObject({ tolerated: false, missing: [2] });
});
it('rejects price/date changes, whole-paragraph omission and href loss independently', () => {
  const body = ['가'.repeat(400), '2026-12-03 | 1,190,000원', '둘째 문단', url].join('\n');
  expect(numberFacts('2026-12-03 | 1,190,000원')).toEqual(numberFacts('2026 - 12 - 03 | 1,190,000 원'));
  expect(() => verifyFullBandPost(body, [], band(body.replace('12-03','12-04')))).toThrow('number');
  expect(() => verifyFullBandPost(body, [], band(body.replace('1,190,000','1,190,001')))).toThrow('number');
  expect(() => verifyFullBandPost(body, [], band(body.replace('둘째 문단\n','')))).toThrow('text');
  expect(() => verifyFullBandPost(body, [], band(body, url, url + '/changed'))).toThrow('href');
});
