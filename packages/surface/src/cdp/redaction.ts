/** Read-only CSS viewport geometry. Same-origin frames keep layout visible;
 * inaccessible frames are masked in full. No page content leaves this reader. */
export const redactionGeometry = `(() => {
  const masks=[],sensitive=[];
  const visit=(d,x,y,sx,sy,clip)=>{
    sensitive.push(['nid.naver.com','auth.band.us'].includes(d.location.hostname)||!!d.querySelector('input[type="password"]'));
    const mask=r=>{const b=[Math.max(clip[0],x+r.left*sx),Math.max(clip[1],y+r.top*sy),Math.min(clip[2],x+r.right*sx),Math.min(clip[3],y+r.bottom*sy)];if(b[2]>b[0]&&b[3]>b[1])masks.push(b);};
    for(const e of d.querySelectorAll('*')){
      const tag=e.tagName.toLowerCase(),r=e.getBoundingClientRect();
      if(!r.width||!r.height||['script','style','head','link','meta'].includes(tag))continue;
      if(tag==='iframe'){
        try{const child=e.contentDocument;if(child?.documentElement){
          const fx=sx*r.width/e.offsetWidth,fy=sy*r.height/e.offsetHeight;
          const cx=x+r.left*sx+e.clientLeft*fx,cy=y+r.top*sy+e.clientTop*fy;
          visit(child,cx,cy,fx,fy,[Math.max(clip[0],cx),Math.max(clip[1],cy),Math.min(clip[2],cx+e.clientWidth*fx),Math.min(clip[3],cy+e.clientHeight*fy)]);continue;
        }}catch{} mask(r);continue;
      }
      if(['input','textarea','select','img','svg','canvas','video','object','embed'].includes(tag)||d.defaultView.getComputedStyle(e).backgroundImage!=='none'||Array.from(e.childNodes).some(n=>n.nodeType===3&&(n.textContent||'').trim()))mask(r);
    }
  };
  visit(document,0,0,1,1,[0,0,innerWidth,innerHeight]);
  return {sensitive:sensitive.some(v=>v),viewportWidth:innerWidth,viewportHeight:innerHeight,masks};
})()`;
