/** A local editor responds to real input; only this fixture changes its own DOM. */
export function blogFixture(mode = '') {
  return `<!doctype html><meta charset="utf-8"><style>
  body{font:16px sans-serif;margin:0}header{position:sticky;top:0;background:white;z-index:2;height:45px}button{min-width:65px;height:35px}
  .se-main-container{min-height:500px;padding:10px}.se-component{margin:5px 0}.se-text-paragraph{min-height:25px;margin:5px 0;outline:none}
  .se-documentTitle{margin:5px 10px}.se-image-resource{width:90px;height:50px}td{border:1px solid #aaa;width:150px;height:28px}
  .se-popup-alert-confirm{position:fixed;top:100px;background:white;border:1px solid;z-index:4}
  </style><header><button data-click-area="tpb.save">저장</button><button data-click-area="tpb*s.count">0</button><button data-click-area="tpb.publish">발행</button><button data-name="image">사진</button>${mode === 'fallback' ? '' : '<button data-name="table">표</button>'}<input type="file" multiple hidden></header>
  <div class="se-documentTitle"><p class="se-text-paragraph" contenteditable="true"></p></div>
  <div class="se-main-container" contenteditable="true"><div class="se-component se-text"><p class="se-text-paragraph"><br></p></div></div>
  ${mode === 'missing-tags' ? '' : '<input placeholder="태그 입력">'}<div class="tag_list"></div><ul aria-label="임시저장된 글" hidden></ul>
  <script>
  const mode=${JSON.stringify(mode)}, main=document.querySelector('.se-main-container'), title=document.querySelector('.se-documentTitle p');
  const empty=()=>{const e=document.createElement('div');e.className='se-component se-text';e.innerHTML='<p class="se-text-paragraph"><br></p>';return e};
  const focus=e=>{e.focus();const r=document.createRange();r.selectNodeContents(e);r.collapse(false);const s=getSelection();s.removeAllRanges();s.addRange(r)};
  const component=()=>{let n=getSelection()?.anchorNode;while(n&&!n.classList?.contains('se-component'))n=n.parentElement;return n};
  let cursor=null, tableUndo=null;
  document.querySelector('[data-name=image]').onmousedown=e=>{cursor=component();e.preventDefault()};
  document.querySelector('input[type=file]').onchange=e=>{
    const saved=cursor;let after=saved;const frag=document.createDocumentFragment();
    for(const f of e.target.files){const image=document.createElement('div');image.className='se-component se-image';const img=document.createElement('img');img.className='se-image-resource';img.src='/photos/'+f.name;image.append(img);frag.append(image)}
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
    e.preventDefault();tableUndo=main.innerHTML;const at=component();const t=document.createElement('div');t.className='se-component se-table';
    t.innerHTML='<table>'+Array.from({length:2},()=>'<tr>'+Array.from({length:mode==='bad-table'?3:2},()=>'<td><p class="se-text-paragraph"><br></p></td>').join('')+'</tr>').join('')+'</table>';
    const next=empty();if(at)at.after(t,next);else main.append(t,next);focus(t.querySelector('p'));
  };
  const tags=document.querySelector('input[placeholder]');if(tags)tags.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();const t=document.createElement('span');t.className='tag';t.textContent=tags.value;document.querySelector('.tag_list').append(t);tags.value=''}};
  const store=()=>JSON.parse(localStorage.getItem('drafts')||'[]');
  document.querySelector('[data-click-area="tpb.save"]').onclick=()=>{
    const drafts=store();drafts.push({title:title.textContent,html:main.innerHTML,tags:document.querySelector('.tag_list').innerHTML});
    if(mode==='duplicate')drafts.push(drafts[drafts.length-1]);localStorage.setItem('drafts',JSON.stringify(drafts));
    localStorage.setItem('saves',String(Number(localStorage.getItem('saves')||0)+1));
    if(mode!=='ambiguous')document.querySelector('[data-click-area="tpb*s.count"]').textContent=drafts.length;
    if(mode==='dialog')confirm('로컬 저장 확인');
  };
  document.querySelector('[data-click-area="tpb*s.count"]').onclick=()=>{
    const list=document.querySelector('ul');list.replaceChildren();for(const draft of store()){
      const li=document.createElement('li'), b=document.createElement('button'), strong=document.createElement('strong');
      b.dataset.clickArea='tpb*s.tlist';strong.textContent=draft.title;b.append(strong);li.append(b);list.append(li);
      b.onclick=()=>{title.textContent=draft.title;main.innerHTML=draft.html;document.querySelector('.tag_list').innerHTML=draft.tags;list.hidden=true};
    }list.hidden=false;
  };
  document.querySelector('[data-click-area="tpb.publish"]').onclick=()=>{localStorage.setItem('publishes',String(Number(localStorage.getItem('publishes')||0)+1));location.href='/published/local'};
  if(mode==='restore'&&!sessionStorage.getItem('declined')){
    const prompt=document.createElement('div');prompt.className='se-popup-alert-confirm';prompt.innerHTML='작성 중인 글이 있습니다. 이어서 작성하시겠습니까?<button class="se-popup-button-cancel">취소</button>';
    prompt.querySelector('button').onclick=()=>{sessionStorage.setItem('declined','yes');prompt.remove()};document.body.append(prompt);
  }
  </script>`;
}
