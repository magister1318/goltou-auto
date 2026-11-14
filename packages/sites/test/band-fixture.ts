/** Synthetic Band pages change their own DOM in response to real input commands. */
export function bandFixture(mode = 'mobile') {
  const desktop = mode === 'desktop';
  return `<!doctype html><meta charset="utf-8"><style>
    body{margin:12px;font:16px sans-serif}button{min-width:70px;height:40px}textarea,.cke_editable{display:block;width:95%;height:500px;border:1px solid #888;white-space:pre-wrap}.mediaImg{width:40px;height:30px}section.lyWrap,.modalLayerView{position:fixed;top:40px;left:50px;background:white;border:1px solid #aaa;z-index:9}
    </style><button>로그아웃</button><div class="_myBandListWrap">
    <a class="bandCover" href="/band/111/post"><span class="bandName">밴드 A</span></a>
    <a class="bandCover" href="/band/222/post"><span class="bandName">밴드 B</span></a>
    <a class="bandCover _adBandCover" href="/band/333/post">광고</a><a class="bandCover" href="/band/111/post">중복</a></div>
    <div class="recommended"><a class="bandCover" href="/band/444/post">추천</a></div>
    <button class="${desktop ? '_btnOpenWriteLayer' : 'uFloatingButton _btnPostWrite'}" aria-label="글쓰기">${desktop ? '글쓰기' : '+'}</button><div id="view"></div>
    <script>
    const mode=${JSON.stringify(mode)}, desktop=${desktop}, view=document.querySelector('#view');
    const count=k=>localStorage.setItem(k,String(Number(localStorage.getItem(k)||0)+1));
    const text=()=>{const e=view.querySelector('textarea,.cke_editable');return e?.value??e?.innerText??''};
    let sequence=0;
    const upload=files=>{
      const root=desktop?view.querySelector('.cke_editable'):view.querySelector('._mediaListWrap');
      if(mode==='drop'&&sequence===1)return;
      for(const f of files){sequence++;const img=document.createElement('img');img.className='mediaImg';img.src='/photos/'+f.name;img.alt=f.name;
        if(mode==='encoded-photos'){img.src='/photos/renamed';img.alt='';const li=document.createElement('li');li.setAttribute('data-file',btoa(JSON.stringify({originalName:f.name})));li.append(img);root.append(li);continue}
        if(['anonymous-photos','cropped','ratio-mismatch'].includes(mode)){img.src='/photos/renamed-'+sequence;img.alt=''}
        if(desktop){const n=document.createElement('band:attachment');n.setAttribute('contenteditable','false');n.append(img);root.append(n)}else if(mode==='reorder')root.prepend(img);else root.append(img);
        if(mode==='double'){const extra=img.cloneNode();extra.src='/photos/extra-'+sequence;root.append(extra)}
      }
    };
    const compose=()=>{
      count('opens'); view.innerHTML=${JSON.stringify(desktop ? '<div class="cke_editable" contenteditable="true" role="textbox"></div>' : '<textarea class="_postTextArea" placeholder="글을 남겨 주세요"></textarea>')}+
        '<div class="postAttachItem"><div class="_mediaListWrap"></div></div><input type="file" accept="image/*" multiple '+(mode==='limit'?'data-max-count="2"':'')+' hidden><span class="photoLimit">'+(mode==='limit'?'최대 2장':'')+'</span><button class="buttonClose _closeBtn">이전</button><button class="_btnPostSubmit">'+(desktop?'게시':'완료')+'</button>';
      view.querySelector('input').onchange=e=>{
        const files=Array.from(e.target.files);
        localStorage.setItem('attachSizes',JSON.stringify([...JSON.parse(localStorage.getItem('attachSizes')||'[]'),files.length]));
        if(!desktop){upload(files);return}
        const dialog=document.createElement('section');dialog.className='lyWrap';dialog.innerHTML='<h1>사진 올리기</h1>'+files.map(()=>'<div class="_itemDraggable">사진</div>').join('')+'<button class="_submitBtn">첨부하기</button>';
        dialog.querySelector('button').onclick=()=>{upload(files);dialog.remove()};view.append(dialog);
      };
      view.querySelector('._closeBtn').onclick=()=>{
        if(mode==='native-dialog'){if(confirm('글 작성을 취소하시겠습니까?')){count('discards');view.replaceChildren()}return}
        const dialog=document.createElement('div');dialog.className='modalLayerView';dialog.innerHTML='<h1>글 작성을 취소하시겠습니까?</h1><button class="_confirmBtn">확인</button><button class="cancel">취소</button>';
        dialog.querySelector('._confirmBtn').onclick=()=>{count('discards');view.replaceChildren()};dialog.querySelector('.cancel').onclick=()=>dialog.remove();view.append(dialog);
      };
      view.querySelector('._btnPostSubmit').onclick=async ()=>{
        count('postPresses');
        const result=await fetch('/band-post-create',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({band_key:location.pathname.split('/')[2]})});
        if(!result.ok)return;
        count('posts');const body=text();const photos=Array.from(view.querySelectorAll('img')).map(n=>n.alt);localStorage.setItem('lastPost',JSON.stringify({body,photos}));
        location.href=location.pathname.replace(/\\/$/,'')+'/'+(1000+Number(localStorage.getItem('posts')));
      };
    };
    document.querySelector('._btnPostWrite,._btnOpenWriteLayer').onclick=compose;
    if(/[/]post[/][0-9]+$/.test(location.pathname)){
      const saved=JSON.parse(localStorage.getItem('lastPost')||'{"body":"","photos":[]}');const root=document.createElement('div');root.className='postView';
      const body=document.createElement('div');body.className='postTextView';body.style.whiteSpace='pre-wrap';body.textContent=saved.body;root.append(body);
      for(const name of saved.photos){const img=document.createElement('img');img.className='mediaImg';img.alt=name;img.src='/photos/'+name;root.append(img)}view.append(root);
    }
    </script>`;
}
