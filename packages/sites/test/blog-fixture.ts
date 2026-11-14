/** A local editor responds to real input; only this fixture changes its own DOM. */
export function blogFixture(mode = '') {
  const metadata = mode.startsWith('metadata-');
  return `<!doctype html><meta charset="utf-8"><style>
  body{font:16px sans-serif;margin:0}header{position:sticky;top:0;background:white;z-index:2;height:45px}button{min-width:65px;height:35px}
  .se-main-container{min-height:500px;padding:10px}.se-component{margin:5px 0}.se-text-paragraph{min-height:25px;margin:5px 0;outline:none}
  .se-documentTitle{margin:5px 10px}.se-image-resource{width:90px;height:50px}td{border:1px solid #aaa;width:150px;height:28px}
  .se-popup-alert-confirm{position:fixed;top:100px;background:white;border:1px solid;z-index:4}
  ${mode === 'metadata-heavy' ? '.se-image-resource{height:450px}.se-main-container{height:650px;overflow:auto}' : ''}
  </style><header><button data-click-area="tpb.save">저장</button><button data-click-area="tpb*s.count">0</button><button data-click-area="tpb.publish">발행</button><button data-name="image">사진</button>${mode === 'fallback' ? '' : '<button data-name="table">표</button>'}<input type="file" multiple hidden></header>
  <div class="se-documentTitle"><p class="se-text-paragraph" contenteditable="true"></p></div>
  <div class="se-main-container" contenteditable="true"><div class="se-component se-text"><p class="se-text-paragraph"><br></p></div></div>
  ${mode === 'missing-tags' || metadata ? '' : '<input placeholder="태그 입력">'}<div class="tag_list"></div><ul aria-label="임시저장된 글" hidden></ul>
  <script>
  const mode=${JSON.stringify(mode)}, main=document.querySelector('.se-main-container'), title=document.querySelector('.se-documentTitle p');
  const empty=()=>{const e=document.createElement('div');e.className='se-component se-text';e.innerHTML='<p class="se-text-paragraph"><br></p>';return e};
  const focus=e=>{e.focus();const r=document.createRange();r.selectNodeContents(e);r.collapse(false);const s=getSelection();s.removeAllRanges();s.addRange(r)};
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
    e.preventDefault();tableUndo=main.innerHTML;const at=component();const t=document.createElement('div');t.className='se-component se-table';
    t.innerHTML='<table>'+Array.from({length:2},()=>'<tr>'+Array.from({length:mode==='bad-table'?3:2},()=>'<td><p class="se-text-paragraph"><br></p></td>').join('')+'</tr>').join('')+'</table>';
    const next=empty();if(at)at.after(t,next);else main.append(t,next);focus(t.querySelector('p'));
  };
  const tags=document.querySelector('input[placeholder]');if(tags)tags.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();const t=document.createElement('span');t.className='tag';t.textContent=tags.value;document.querySelector('.tag_list').append(t);tags.value=''}};
  let metadataTags=[];
  const tagPanel=()=>{
    const open=document.querySelector('[data-metadata-panel]');if(open){if(mode!=='metadata-stuck'){open.remove();document.querySelector('[data-metadata-cover]')?.remove()}return}
    const cover=document.createElement('div');cover.dataset.metadataCover='';cover.style.cssText='position:fixed;top:0;left:0;right:0;height:45px;z-index:5';document.body.append(cover);
    const panel=document.createElement('div');panel.dataset.metadataPanel='';panel.style.cssText='position:fixed;right:0;top:60px;background:white;z-index:3';
    panel.innerHTML='<div class="tag_textarea__fixture"><span><input id="tag-input" role="combobox" placeholder="태그 입력 (최대 30개)"></span></div><button data-click-area="tpb*i.publish">발행</button>';
    const input=panel.querySelector('input'),area=panel.querySelector('div');
    const render=()=>{area.querySelectorAll('[aria-label]').forEach(e=>e.remove());for(const tag of metadataTags){const chip=document.createElement('span');chip.className='tag__fixture';chip.setAttribute('aria-label',tag);chip.textContent='#'+tag;area.insertBefore(chip,input.parentElement)}};
    input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();metadataTags.push(input.value);input.value='';render()}};
    panel.onkeydown=e=>{if(e.key==='Escape'&&e.target===input&&mode!=='metadata-stuck'){panel.remove();cover.remove()}};
    if(mode==='metadata-focus-lost')input.oninput=()=>panel.querySelector('button').focus();
    panel.querySelector('button').onclick=()=>localStorage.setItem('publishes',String(Number(localStorage.getItem('publishes')||0)+1));
    document.body.append(panel);render();
  };
  const store=()=>JSON.parse(localStorage.getItem('drafts')||'[]');
  document.querySelector('[data-click-area="tpb.save"]').onclick=()=>{
    const drafts=store();drafts.push({title:title.textContent,html:main.innerHTML,tags:document.querySelector('.tag_list').innerHTML,metadataTags});
    if(mode==='duplicate')drafts.push(drafts[drafts.length-1]);localStorage.setItem('drafts',JSON.stringify(drafts));
    localStorage.setItem('saves',String(Number(localStorage.getItem('saves')||0)+1));
    if(mode!=='ambiguous')document.querySelector('[data-click-area="tpb*s.count"]').textContent=drafts.length;
    if(mode==='dialog')confirm('로컬 저장 확인');
  };
  document.querySelector('[data-click-area="tpb*s.count"]').onclick=()=>{
    const list=document.querySelector('ul');list.replaceChildren();for(const draft of store()){
      const li=document.createElement('li'), b=document.createElement('button'), strong=document.createElement('strong');
      b.dataset.clickArea='tpb*s.tlist';strong.textContent=draft.title;b.append(strong);li.append(b);list.append(li);
      b.onclick=()=>{title.textContent=draft.title;main.innerHTML=draft.html;document.querySelector('.tag_list').innerHTML=draft.tags;metadataTags=draft.metadataTags||[];list.hidden=true;
        if(mode==='metadata-tags'||mode==='metadata-heavy')for(const img of main.querySelectorAll('img')){img.dataset.lazySource=img.getAttribute('src');img.src='data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>'}
      };
    }list.hidden=false;
  };
  document.querySelector('[data-click-area="tpb.publish"]').onclick=()=>{localStorage.setItem('publishes',String(Number(localStorage.getItem('publishes')||0)+1));location.href='/published/local'};
  if(${metadata}){
    const toggle=document.querySelector('[data-click-area="tpb.publish"]');toggle.className='publish_btn__fixture';toggle.onclick=tagPanel;
    // Model SmartEditor's expansion when a selector arrives after its base.
    document.addEventListener('beforeinput',e=>{if(e.data==='\uFE0F'&&e.target.closest('.se-main-container')){e.preventDefault();document.execCommand('insertText',false,'✈️')}});
    const reveal=()=>{for(const img of main.querySelectorAll('img[data-lazy-source]')){const b=img.getBoundingClientRect();if(mode!=='metadata-heavy'||(b.top<innerHeight&&b.bottom>45)){img.src=img.dataset.lazySource;delete img.dataset.lazySource}}};
    document.addEventListener('keydown',e=>{if(['Home','PageDown'].includes(e.key)&&e.target.closest('.se-main-container,.se-documentTitle'))setTimeout(reveal,50)});
  }
  if(mode==='restore'&&!localStorage.getItem('declined')){
    const prompt=document.createElement('div');prompt.className='se-popup-alert-confirm';prompt.innerHTML='작성 중인 글이 있습니다. 이어서 작성하시겠습니까?<button class="se-popup-button-cancel">취소</button>';
    prompt.querySelector('button').onclick=()=>{localStorage.setItem('declined','yes');prompt.remove()};document.body.append(prompt);
  }
  </script>`;
}
