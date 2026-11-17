// @vitest-environment jsdom
import {expect,it} from 'vitest';
import {createElement}from'react';
import{renderToStaticMarkup}from'react-dom/server';
import{ConversionPreview}from'../src/ConversionPreview';
import{TableNotice}from'../src/TableNotice';
import{jobMessage}from'../src/job-message';
it('renders Blog preview cells without adding a header or bold, retaining cell links and newlines',()=>{const host=document.createElement('div');host.innerHTML=renderToStaticMarkup(createElement(ConversionPreview,{expanded:true,droppedStruckCharacters:0,plan:{channel:'blog',discarded:[],notices:[],steps:[{kind:'table',role:'body',rows:[['일반','굵게\n문의'],['','끝']],cellRuns:[[[{text:'일반'}],[{text:'굵게',bold:true},{text:'\n문의',href:'https://example.invalid/link'}]],[[],[{text:'끝'}]]]}]}}));expect(host.querySelectorAll('table')).toHaveLength(1);expect(host.querySelectorAll('tr')).toHaveLength(2);expect(host.querySelectorAll('td')).toHaveLength(4);expect(host.querySelectorAll('th')).toHaveLength(0);expect(host.querySelectorAll('table strong')).toHaveLength(1);expect(host.querySelector('a')!.textContent).toBe('\n문의');expect([...host.querySelectorAll('td')].map(e=>e.textContent)).toEqual(['일반','굵게\n문의','','끝']);});
it('shows the same plain fallback notice for results and persistent history',()=>{expect(renderToStaticMarkup(createElement(TableNotice,{fallback:true}))).toContain('표를 넣지 못해 같은 내용을 글자 행으로 옮겼습니다.');expect(renderToStaticMarkup(createElement(TableNotice,{fallback:false}))).toBe('');expect(jobMessage({readbackIssues:[{field:'table'}]} as never)[0]).toContain('표가 계획과 다릅니다.');});
