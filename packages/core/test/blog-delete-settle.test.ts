import { afterEach, expect, it, vi } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { CdpSurface, type CdpConnection } from '@goltou/surface/cdp';
import type { SurfaceHost } from '@goltou/surface';
import type { Post } from '@goltou/api-client';
import { removeRecordedBlogPost } from '../src/post-delete';
import { verifyPostAbsentFromList } from '@goltou/sites';

let browser: Browser | undefined;
afterEach(async()=>{await browser?.close();});
const post={postNo:1,productNo:1,productTitle:'합성 삭제 제목',channel:'blog',mode:'publish',status:'published',step:7,postUrl:'https://blog.naver.com/synthetic/9001',productChanged:false} as Post;
async function fixture(mode='late') {
  browser=await chromium.launch({executablePath:process.env.CHROMIUM||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const context=await browser.newContext();let mutations=0;
  await context.route('**/*',route=>{
    if(route.request().method()!=='GET'){mutations++;return route.abort();}
    const u=new URL(route.request().url());
    if(u.pathname==='/PostList.naver')return route.fulfill({contentType:'text/html; charset=utf-8',body:`<main data-post-list style="min-height:100px"></main><script>
      const root=document.querySelector('main');
      setTimeout(()=>{root.innerHTML=${JSON.stringify(mode==='empty'?'<p data-post-list-empty>등록된 글이 없습니다.</p>':'<a href="/synthetic/9002">다른 합성 글</a>') }+${JSON.stringify(mode==='present'?'<a href="/synthetic/9001">합성 삭제 제목</a>':'')};},1500);
    </script>`});
    return route.fulfill({contentType:'text/html; charset=utf-8',body:'<div data-post-deleted>삭제된 글입니다</div>'});
  });
  const page=await context.newPage(),session=await context.newCDPSession(page);
  const shim={send:(m:string,p:object)=>session.send(m as never,p as never),on:(m:string,f:(p:Record<string,unknown>)=>void)=>{session.on(m as never,f);return()=>session.off(m as never,f);},isOpen:true,close:()=>{}};
  const surface=new CdpSurface('naver',shim as unknown as CdpConnection,{setVisible:async()=>{},close:()=>page.close()},0);
  const click=vi.spyOn(surface,'click'),key=vi.spyOn(surface,'pressKey');
  const host={create:async()=>surface,destroy:async()=>{},clearSession:async()=>{}} as SurfaceHost;
  return {surface,host,click,key,mutations:()=>mutations};
}
it.each(['late','empty'])('waits for list hydration before completing the already-deleted record path (%s)',async mode=>{
  const f=await fixture(mode),started=Date.now();
  await removeRecordedBlogPost(f.host,post);
  expect(Date.now()-started).toBeGreaterThanOrEqual(1500);
  expect(f.click).not.toHaveBeenCalled();expect(f.key).not.toHaveBeenCalled();expect(f.mutations()).toBe(0);
},10000);
it('never declares absence while the target is still linked in the settled list',async()=>{
  const f=await fixture('present');
  await expect(verifyPostAbsentFromList(f.surface,post.postUrl,post.productTitle,2500)).rejects.toThrow('BLOG_POST_DELETE_LIST_UNCONFIRMED');
  expect(f.click).not.toHaveBeenCalled();expect(f.mutations()).toBe(0);
},10000);
