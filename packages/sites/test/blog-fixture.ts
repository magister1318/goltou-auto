/** A local editor responds to real input; only this fixture changes its own DOM. */
export function blogFixture(mode = '') {
  const metadata = mode.startsWith('metadata-');
  return `<!doctype html><meta charset="utf-8"><style>
  body{font:16px sans-serif;margin:0}header{position:sticky;top:0;background:white;z-index:2;height:45px}button{min-width:65px;height:35px}
  .se-main-container{min-height:500px;padding:10px}.se-component{margin:5px 0}.se-text-paragraph{white-space:pre-wrap;min-height:25px;margin:5px 0;outline:none}
  .se-documentTitle{margin:5px 10px}.se-image-resource{width:90px;height:50px}td{border:1px solid #aaa;width:150px;height:28px}
  .se-popup-alert-confirm{position:fixed;top:100px;background:white;border:1px solid;z-index:4}
  .rich-toolbar{position:sticky;top:45px;background:white;z-index:2}
  ${mode === 'metadata-heavy' ? '.se-image-resource{height:450px}.se-main-container{height:650px;overflow:auto}' : ''}
  </style><header><button data-click-area="tpb.save">저장</button><button data-click-area="tpb*s.count">0</button><button data-click-area="tpb.publish">발행</button><button data-name="image">사진</button>${mode === 'fallback' ? '' : '<button data-name="table">표</button>'}<input type="file" multiple hidden></header>
  <div class="rich-toolbar"><button data-name="bold" data-type="toggle" class="se-bold-toolbar-button se-property-toolbar-toggle-button">굵게</button><button data-name="text-link">링크</button></div>
  <div class="se-documentTitle"><p class="se-text-paragraph" contenteditable="true"></p></div>
  <div class="se-main-container" contenteditable="true"><div class="se-component se-text"><p class="se-text-paragraph"><br></p></div></div>
  ${mode === 'missing-tags' || metadata ? '' : '<input placeholder="태그 입력">'}<div class="tag_list"></div><ul aria-label="임시저장된 글" hidden></ul>
  <script>
  const mode=${JSON.stringify(mode)}, main=document.querySelector('.se-main-container'), title=document.querySelector('.se-documentTitle p');
  const empty=()=>{const e=document.createElement('div');e.className='se-component se-text';e.innerHTML='<p class="se-text-paragraph"><br></p>';return e};
  const focus=e=>{e.focus();const r=document.createRange();r.selectNodeContents(e);r.collapse(false);const s=getSelection();s.removeAllRanges();s.addRange(r)};
  // Only the synthetic editor owns DOM/Selection writes. Production calls real keys/clicks.
  const bold=document.querySelector('[data-name=bold]');
  const boldState=()=>bold.classList.toggle('se-is-selected',document.queryCommandState('bold'));
  document.addEventListener('selectionchange',boldState);
  bold.onmousedown=e=>e.preventDefault();
  bold.onclick=()=>{if(mode!=='bold-stuck')document.execCommand('bold');boldState()};
  document.addEventListener('keydown',e=>{if(e.ctrlKey&&e.key.toLowerCase()==='b'){e.preventDefault();if(mode!=='bold-stuck')document.execCommand('bold');boldState()}});
  document.addEventListener('keydown',e=>{if(mode==='link-end-stuck'&&e.ctrlKey&&e.key==='End'&&!getSelection()?.isCollapsed)e.preventDefault()});
  document.addEventListener('keydown',e=>{if(mode==='link-collapse-stuck'&&e.key==='ArrowRight'&&!getSelection()?.isCollapsed)e.preventDefault()});
  const link=document.querySelector('[data-name=text-link]');let linkRange=null;
  link.onmousedown=e=>{e.preventDefault();linkRange=getSelection()?.rangeCount?getSelection().getRangeAt(0).cloneRange():null};
  link.onclick=()=>{
    window.linkDialogOpens=(window.linkDialogOpens||0)+1;
    const panel=document.createElement('div');panel.className='se-custom-layer-option-link';panel.style.cssText='position:fixed;top:130px;left:100px;background:white;z-index:8';
    panel.innerHTML='<input class="se-custom-layer-link-input" aria-label="링크 주소"><button class="se-custom-layer-link-apply-button">확인</button><button class="se-popup-button-cancel">취소</button>';
    const restore=()=>{main.focus();if(linkRange){const selection=getSelection();selection.removeAllRanges();selection.addRange(linkRange)}};
    panel.querySelector('.se-custom-layer-link-apply-button').onclick=()=>{const value=panel.querySelector('input').value;panel.remove();restore();if(mode!=='link-cancelled')document.execCommand('createLink',false,mode==='link-broken'?'https://example.invalid/broken':value);boldState()};
    panel.querySelector('.se-popup-button-cancel').onclick=()=>{panel.remove();restore()};document.body.append(panel);
    if(mode==='table-popup-move'){panel.style.top='190px';setTimeout(()=>{panel.style.top='210px'},200);const toast=document.createElement('p');toast.className='se-toast-popup-message';toast.style.cssText='position:fixed;top:180px;left:90px;width:500px;height:100px;background:white;z-index:20';document.body.append(toast);setTimeout(()=>toast.remove(),1000);}
  };
  const component=()=>{let n=getSelection()?.anchorNode;while(n&&!n.classList?.contains('se-component'))n=n.parentElement;return n};
  let cursor=null, tableUndo=null;window.attachmentSizes=[];
  document.querySelector('[data-name=image]').onmousedown=e=>{cursor=component();e.preventDefault()};
  document.querySelector('input[type=file]').onchange=e=>{
    window.attachmentSizes.push(e.target.files.length);
    const saved=cursor;let after=saved;const frag=document.createDocumentFragment();
    for(const f of e.target.files){const image=document.createElement('div');image.className='se-component se-image';const img=document.createElement('img');img.className='se-image-resource';img.src='/photos/'+(mode==='metadata-tags'?f.name.replace(/\\.[^.]+$/,'.png'):f.name);image.append(img);frag.append(image)}
    const next=empty();frag.append(next);if(after)after.after(frag);else main.append(frag);focus(next.querySelector('p'));
    e.target.value='';
  };
  document.addEventListener('keydown',e=>{
    if(e.ctrlKey&&e.key==='z'&&tableUndo!==null){e.preventDefault();main.innerHTML=tableUndo;tableUndo=null;focus(main.lastElementChild.querySelector('p'));return}
    if(e.key==='Enter'&&e.target.closest('.se-main-container')&&!e.target.closest('td,th')){
      e.preventDefault();let p=getSelection()?.anchorNode;while(p&&p.tagName!=='P')p=p.parentElement;if(!p)return;
      const next=document.createElement('p');next.className='se-text-paragraph';next.innerHTML='<br>';p.after(next);focus(next);
    }
  });
  const table=document.querySelector('[data-name=table]');if(table)table.onmousedown=e=>{
    e.preventDefault();tableUndo=main.innerHTML;const at=component();const t=document.createElement('div');t.className='se-component se-table';t.id='fixture-table-'+(window.tableCount=(window.tableCount||0)+1);
    t.innerHTML='<button class="se-component-edge-button-bottom">다음 문단</button><div class="se-table-control se-is-on"><button class="se-cell-select-all-button">전체 셀</button></div><div class="se-cell-context-menu"><button class="se-cell-context-menu-button se-context-menu-button-delete">셀 삭제</button></div><table>'+Array.from({length:mode.startsWith('table-')?3:2},()=>'<tr>'+Array.from({length:mode.startsWith('table-')||mode.startsWith('bad-table')?3:2},()=>'<td><p class="se-text-paragraph"><br></p></td>').join('')+'</tr>').join('')+'</table>';
    const next=empty();if(at)at.after(t,next);else main.append(t,next);focus(t.querySelector('p'));
    if(mode==='table-moving-no-next'){t.style.transform='translateY(80px)';let moved=false;t.addEventListener('mousemove',()=>{if(!moved){moved=true;t.style.transform='';window.tableMovedOnHover=true}});next.remove()}
    if(mode==='bad-table-remove-anchor'&&at?.classList.contains('se-text')&&!at.textContent)at.remove();
    t.querySelector('.se-component-edge-button-bottom').onclick=()=>focus(next.querySelector('p'));
    let selected='all';
    t.querySelector('.se-cell-select-all-button').onclick=()=>{selected='all'};
    t.querySelector('.se-context-menu-button-delete').onclick=()=>{
      if(mode==='table-cleanup-failed')return;
      if(selected==='column')for(const row of t.querySelectorAll('tr'))row.lastElementChild.remove();
      else if(selected==='row')t.querySelector('tr:last-child').remove();
      else {t.remove();if(mode==='bad-table-remove-anchor')next.remove();else focus(next.querySelector('p'))}
    };
    const refresh=()=>{
      if(mode.startsWith('bad-table'))return;
      const control=t.querySelector('.se-table-control');control.querySelectorAll('ul').forEach(e=>e.remove());
      for(const axis of ['column','row']){
        const bar=document.createElement('ul');bar.className='se-cell-controlbar-'+axis;bar.style.cssText='display:flex;list-style:none;margin:0;padding:0';
        const count=axis==='column'?t.querySelector('tr').cells.length:t.querySelectorAll('tr').length;
        for(let i=0;i<count;i++){
          const li=document.createElement('li');li.innerHTML='<button class="se-cell-select-button">선택</button><button class="se-cell-add-button">추가</button>';
          li.querySelector('.se-cell-select-button').onclick=()=>{selected=axis};
          li.querySelector('.se-cell-add-button').onclick=()=>{
            if(axis==='column')for(const row of t.querySelectorAll('tr')){const cell=row.cells[0].cloneNode(true);cell.innerHTML='<p class="se-text-paragraph"><br></p>';row.append(cell)}
            else {const row=t.querySelector('tr').cloneNode(true);for(const cell of row.cells)cell.innerHTML='<p class="se-text-paragraph"><br></p>';t.querySelector('tbody').append(row)}
            refresh();
          };bar.append(li);
        }control.append(bar);
      }
    };refresh();
    if(mode==='table-cell-drop')main.addEventListener('input',()=>{const p=getSelection()?.anchorNode?.parentElement?.closest('p');if(p&&t.contains(p)&&p.textContent)p.textContent='변경'});
    const deleteCell=t.querySelector('.se-context-menu-button-delete'),remove=deleteCell.onclick;deleteCell.onclick=()=>{remove();if(t.isConnected)refresh()};
  };
  if(mode==='bad-table-remove-anchor'||mode==='table-moving-no-next'){
    const bottom=document.createElement('button');bottom.className='se-canvas-bottom-button';bottom.textContent='다음 입력';main.after(bottom);
    bottom.style.height='320px';const cover=document.createElement('div');cover.style.cssText='position:fixed;bottom:0;left:0;width:100%;height:130px;background:white;z-index:3';document.body.append(cover);
    document.querySelector('[aria-label="임시저장된 글"]').style.cssText='position:fixed;top:150px;left:20px;background:white;z-index:10';
    bottom.onclick=()=>{window.bottomClicks=(window.bottomClicks||0)+1;const p=empty();main.append(p);focus(p.querySelector('p'))};
  }
  const tags=document.querySelector('input[placeholder]');if(tags)tags.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();const t=document.createElement('span');t.className='tag';t.textContent=tags.value;document.querySelector('.tag_list').append(t);tags.value=''}};
  let metadataTags=[];
  const tagPanel=()=>{
    const open=document.querySelector('[data-metadata-panel]');if(open){if(mode!=='metadata-stuck'){open.remove();document.querySelector('[data-metadata-cover]')?.remove()}return}
    if(mode==='metadata-body-tags'){
      // Independent synthetic reproduction of the observed service merge.
      const bodyTags=[...main.querySelectorAll('.se-text-paragraph')].flatMap(p=>(p.textContent.match(/(?:^|\\s)#([가-힣A-Za-z0-9_]+)/g)||[]).map(t=>t.trim().slice(1)));
      metadataTags=[...new Set([...metadataTags,...bodyTags])];
    }
    const cover=document.createElement('div');cover.dataset.metadataCover='';cover.style.cssText='position:fixed;top:0;left:0;right:0;height:45px;z-index:5';document.body.append(cover);
    const panel=document.createElement('div');panel.dataset.metadataPanel='';panel.style.cssText='position:fixed;right:0;top:60px;background:white;z-index:3';
    panel.innerHTML='<div class="tag_textarea__fixture"><span><input id="tag-input" role="combobox" placeholder="태그 입력 (최대 30개)"></span></div><button data-click-area="tpb*i.publish">발행</button>';
    const input=panel.querySelector('input'),area=panel.querySelector('div');
    const render=()=>{area.querySelectorAll('[aria-label]').forEach(e=>e.remove());for(const tag of metadataTags){const chip=document.createElement('span');chip.className='tag__fixture';chip.setAttribute('aria-label',tag);chip.textContent='#'+tag;area.insertBefore(chip,input.parentElement)}};
    input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();if(!metadataTags.includes(input.value))metadataTags.push(input.value);input.value='';render()}};
    panel.onkeydown=e=>{if(e.key==='Escape'&&e.target===input&&mode!=='metadata-stuck'){panel.remove();cover.remove()}};
    if(mode==='metadata-focus-lost')input.oninput=()=>panel.querySelector('button').focus();
    panel.querySelector('button').onclick=()=>localStorage.setItem('publishes',String(Number(localStorage.getItem('publishes')||0)+1));
    document.body.append(panel);render();
  };
  const store=()=>JSON.parse(localStorage.getItem('drafts')||'[]');
  if(mode==='existing-duplicates'&&!store().length)localStorage.setItem('drafts',JSON.stringify([1,2].map(n=>({title:'[골투오토 실험] WP5 로컬',stamp:'2026.01.01. 00:0'+n,html:'older content',tags:''}))));
  document.querySelector('[data-click-area="tpb*s.count"]').textContent=store().length;
  document.querySelector('[data-click-area="tpb.save"]').onclick=async()=>{
    const drafts=store();if(mode!=='list-unchanged')drafts.push({title:title.textContent,stamp:new Date().toISOString(),html:main.innerHTML,tags:document.querySelector('.tag_list').innerHTML,metadataTags});
    if(mode==='duplicate')drafts.push(drafts[drafts.length-1]);localStorage.setItem('drafts',JSON.stringify(drafts));
    if(mode==='autosave-readback')localStorage.removeItem('leftover');
    localStorage.setItem('saves',String(Number(localStorage.getItem('saves')||0)+1));
    if(mode==='body-change-after-save')main.querySelector('.se-text-paragraph').remove();
    if(mode==='small-change-after-save')main.querySelector('.se-text-paragraph').textContent=main.querySelector('.se-text-paragraph').textContent.replace('합성','합싱');
    if(mode==='format-drop-after-save')for(const e of main.querySelectorAll('b,strong,a'))e.replaceWith(...e.childNodes);
    if(mode!=='ambiguous')document.querySelector('[data-click-area="tpb*s.count"]').textContent=drafts.length;
    if(mode==='dialog')confirm('로컬 저장 확인');
    await fetch('/RabbitTempPostWrite.naver',{method:'POST',body:mode});
  };
  document.querySelector('[data-click-area="tpb*s.count"]').onclick=()=>{
    const list=document.querySelector('[aria-label="임시저장된 글"]');list.replaceChildren();for(const draft of store()){
      const li=document.createElement('li'), b=document.createElement('button'), strong=document.createElement('strong');
      b.dataset.clickArea='tpb*s.tlist';strong.textContent=draft.title;b.append(strong);const date=document.createElement('span');date.className='date__fixture';date.textContent=draft.stamp||'';b.append(date);li.append(b);list.append(li);
      b.onclick=()=>{title.textContent=draft.title;main.innerHTML=draft.html;document.querySelector('.tag_list').innerHTML=draft.tags;metadataTags=draft.metadataTags||[];list.hidden=true;
        if(mode==='small-change-after-save')main.querySelector('.se-text-paragraph').textContent=main.querySelector('.se-text-paragraph').textContent.replace('합성','합싱');
        if(mode==='format-drop-reopen')for(const e of main.querySelectorAll('b,strong,a'))e.replaceWith(...e.childNodes);
        if(mode==='autosave-readback')setTimeout(()=>{
          localStorage.setItem('autosaveAttempted','yes');
          fetch('https://blog.naver.com/RabbitAutoSaveWrite.naver',{method:'POST',mode:'no-cors',body:'fixture'}).then(()=>localStorage.setItem('leftover','yes')).catch(()=>localStorage.setItem('autosaveBlocked','yes'));
        },3000);
        if(mode==='metadata-tags'||mode==='metadata-heavy')for(const img of main.querySelectorAll('img')){img.dataset.lazySource=img.getAttribute('src');img.src='data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>'}
      };
    }list.hidden=false;
    if(!document.querySelector('[data-click-area="tpb*s.close"]')){const close=document.createElement('button');close.dataset.clickArea='tpb*s.close';close.textContent='닫기';close.onclick=()=>{list.hidden=true;close.remove()};document.querySelector('header').append(close)}
  };
  document.querySelector('[data-click-area="tpb.publish"]').onclick=()=>{localStorage.setItem('publishes',String(Number(localStorage.getItem('publishes')||0)+1));location.href='/published/local'};
  if(${metadata}){
    const toggle=document.querySelector('[data-click-area="tpb.publish"]');toggle.className='publish_btn__fixture';toggle.onclick=tagPanel;
    // Model SmartEditor's expansion when a selector arrives after its base.
    document.addEventListener('beforeinput',e=>{if(e.data==='\uFE0F'&&e.target.closest('.se-main-container')){e.preventDefault();document.execCommand('insertText',false,'✈️')}});
    const reveal=()=>{for(const img of main.querySelectorAll('img[data-lazy-source]')){const b=img.getBoundingClientRect();if(mode!=='metadata-heavy'||(b.top<innerHeight&&b.bottom>45)){img.src=img.dataset.lazySource;delete img.dataset.lazySource}}};
    document.addEventListener('keydown',e=>{if(['Home','PageDown'].includes(e.key)&&e.target.closest('.se-main-container,.se-documentTitle'))setTimeout(reveal,50)});
  }
  if(mode==='restore'&&!localStorage.getItem('declined')||mode==='autosave-readback'&&localStorage.getItem('leftover')){
    const prompt=document.createElement('div');prompt.className='se-popup-alert-confirm';prompt.innerHTML='작성 중인 글이 있습니다. 이어서 작성하시겠습니까?<button class="se-popup-button-cancel">취소</button>';
    prompt.querySelector('button').onclick=()=>{localStorage.setItem('declined','yes');prompt.remove()};document.body.append(prompt);
  }

    if(mode==='auto-list' || mode==='auto-list-undo-fails')document.addEventListener('beforeinput',e=>{
      if(e.inputType!=='insertText'||(mode==='auto-list'&&e.data!==' '))return;
      const anchor=getSelection()?.anchorNode;
      const p=(anchor?.nodeType===1?anchor:anchor?.parentElement)?.closest('.se-text-paragraph');
      if(!p?.closest('.se-main-container')||!/^(?:[0-9]+[.)]|[-*+>])\\s/.test(p.textContent+e.data))return;
      e.preventDefault();
      const list=document.createElement('ol'),item=document.createElement('li');
      p.before(list);list.append(item);item.append(p);p.replaceChildren();
      const range=document.createRange();range.selectNodeContents(p);range.collapse();
      const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
      window.markerConversions=(window.markerConversions??0)+1;
    });
    if(mode==='auto-list-undo-fails')document.addEventListener('keydown',e=>{if(e.ctrlKey&&e.key.toLowerCase()==='z')e.preventDefault()});
  </script>`;
}
