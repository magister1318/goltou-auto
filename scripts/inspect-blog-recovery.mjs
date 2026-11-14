// Static loaded editor code only. No page input values, browser storage or cookies.
import { attach, output } from './review-device-ux-v2.mjs';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
const d = await attach();
try {
  for(const t of d.targets.filter(t=>{try{return new URL(t.url).hostname==='blog.naver.com';}catch{return false;}})) {
    const c=await d.connect(t), scripts=[];
    c.on('Debugger.scriptParsed',e=>{try{const u=new URL(e.url);if(u.hostname.endsWith('.pstatic.net')&&u.pathname.endsWith('.js'))scripts.push(e.scriptId);}catch{}});
    await c.send('Debugger.enable',{});
    await new Promise(r=>setTimeout(r,300));
    const snippets=[];
    for(const id of scripts) {
      const {scriptSource:s}=await c.send('Debugger.getScriptSource',{scriptId:id});
      for(const match of s.matchAll(/작성 중인 글이 있습니다|declineAutoSave|cancelAutoSave|removeAutoSave|deleteAutoSave|loadAutoSave|restoreAutoSave|autoSaveDocument|autoSaveDelete|AUTO_SAVE_EXIST|LOAD_AUTO_SAVE|autoSave|autoSaved|removeAuto|AutoSave/g)) snippets.push(s.slice(Math.max(0,match.index-350),match.index+600));
    }
    writeFileSync(path.join(output,'recovery-static-snippets.txt'),snippets.join('\n\n'));
    console.log(JSON.stringify({staticScripts:scripts.length,recoverySnippets:snippets.length}));
    await c.send('Debugger.disable',{});c.close();
  }
} finally {d.close();}
