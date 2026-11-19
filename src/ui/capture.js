import{icon}from'./icons.js';
import{toast,run}from'./app.js';
export async function openCapture(root,state){
  const api=window.qingjie;root.innerHTML=`<div class="capture"><canvas id="screen-canvas"></canvas><div class="capture-hint">${state.mode==='color'?'移动鼠标取色 · 点击复制 HEX · Esc 取消':'拖动框选 · 选区可移动 / 拉伸 · Enter 编辑 · Esc 取消'}</div><div class="capture-size" hidden></div><div class="capture-bar" hidden></div><div class="magnifier"><canvas width="110" height="110"></canvas><span></span></div></div>`;
  const canvas=document.querySelector('#screen-canvas'),ctx=canvas.getContext('2d'),bar=document.querySelector('.capture-bar'),size=document.querySelector('.capture-size'),mag=document.querySelector('.magnifier'),magCanvas=mag.querySelector('canvas'),magCtx=magCanvas.getContext('2d');
  const image=new Image();image.src=state.data;await image.decode();
  // The captured frame is native-resolution, but windows are laid out in
  // device-independent pixels. A CSS-sized canvas would first downscale the
  // screenshot and the compositor would then stretch it back up, so on 125% /
  // 150% / 200% displays the selection preview looked soft. Size the backing
  // store in device pixels and draw through a matching transform instead.
  const viewW=state.display?.width||innerWidth,viewH=state.display?.height||innerHeight,dpr=window.devicePixelRatio||1;
  canvas.width=Math.round(viewW*dpr);canvas.height=Math.round(viewH*dpr);
  canvas.style.width=viewW+'px';canvas.style.height=viewH+'px';
  const scaleX=canvas.width/viewW,scaleY=canvas.height/viewH;
  ctx.setTransform(scaleX,0,0,scaleY,0,0);
  const source=document.createElement('canvas');source.width=image.naturalWidth;source.height=image.naturalHeight;source.getContext('2d').drawImage(image,0,0);const sourceCtx=source.getContext('2d',{willReadFrequently:true});
  let rect=null,drag=null,start=null,original=null,hoverColor='#000000',pending=false;
  const point=e=>({x:Math.max(0,Math.min(viewW,e.clientX)),y:Math.max(0,Math.min(viewH,e.clientY))});
  const normalize=(a,b)=>({x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(a.x-b.x),height:Math.abs(a.y-b.y)});
  function handleAt(p){if(!rect)return null;const r=rect,points={nw:[r.x,r.y],ne:[r.x+r.width,r.y],sw:[r.x,r.y+r.height],se:[r.x+r.width,r.y+r.height]};for(const[k,v]of Object.entries(points))if(Math.hypot(p.x-v[0],p.y-v[1])<10)return k;if(p.x>r.x&&p.x<r.x+r.width&&p.y>r.y&&p.y<r.y+r.height)return'move';return null;}
  function draw(){ctx.drawImage(image,0,0,viewW,viewH);if(state.mode==='color')return;ctx.fillStyle='#071a2490';ctx.fillRect(0,0,viewW,viewH);if(!rect)return;
    // Sample whole source pixels and place them 1:1 on the device-pixel canvas so the
    // highlight shows exactly the pixels that will be cropped, with no resampling blur.
    const r=rect,sx=source.width/viewW,sy=source.height/viewH;
    const ax=Math.max(0,Math.min(source.width-1,Math.round(r.x*sx))),ay=Math.max(0,Math.min(source.height-1,Math.round(r.y*sy)));
    const ax2=Math.max(ax+1,Math.min(source.width,Math.round((r.x+r.width)*sx))),ay2=Math.max(ay+1,Math.min(source.height,Math.round((r.y+r.height)*sy)));
    const aw=ax2-ax,ah=ay2-ay;
    ctx.drawImage(image,ax,ay,aw,ah,ax/scaleX,ay/scaleY,aw/scaleX,ah/scaleY);
    ctx.strokeStyle='#64e2b5';ctx.lineWidth=1.5;ctx.strokeRect(r.x+.5,r.y+.5,r.width,r.height);
    for(const[x,y]of[[r.x,r.y],[r.x+r.width,r.y],[r.x,r.y+r.height],[r.x+r.width,r.y+r.height]]){ctx.fillStyle='#fff';ctx.fillRect(x-3,y-3,6,6);ctx.strokeRect(x-3,y-3,6,6);}
    size.hidden=false;size.textContent=`${aw} × ${ah}`;size.style.left=Math.min(innerWidth-120,Math.max(4,r.x))+'px';size.style.top=Math.max(4,r.y-31)+'px';}
  async function finish(action){if(!rect||pending)return;pending=true;try{await api.selectCapture({rect,action});}catch(e){pending=false;toast(e.message);}}
  function toolbar(){if(!rect||rect.width<2||rect.height<2){bar.hidden=true;return;}bar.hidden=false;bar.innerHTML=`<button data-action="edit" title="标注编辑 (Enter)">${icon('pen',17)}</button><button data-action="ocr" title="提取文字">${icon('scan',17)}</button><button data-action="scroll" title="长截图">${icon('down',17)}</button><button data-action="pin" title="贴图 (Ctrl/⌘+T)">${icon('pin',17)}</button><button data-action="save" title="保存 (Ctrl/⌘+S)">${icon('save',17)}</button><button data-action="copy" class="primary" title="复制 (Ctrl/⌘+C)">${icon('copy',17)}</button><button id="capture-cancel" title="取消">${icon('close',17)}</button>`;bar.style.left=Math.max(5,Math.min(innerWidth-bar.offsetWidth-5,rect.x+rect.width-bar.offsetWidth))+'px';bar.style.top=(rect.y+rect.height+bar.offsetHeight+13<innerHeight?rect.y+rect.height+10:Math.max(5,rect.y-bar.offsetHeight-10))+'px';bar.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>finish(b.dataset.action));bar.querySelector('#capture-cancel').onclick=run(()=>api.cancelCapture());}
  function magnify(p){const x=Math.min(source.width-1,Math.round(p.x*source.width/viewW)),y=Math.min(source.height-1,Math.round(p.y*source.height/viewH));const pixel=sourceCtx.getImageData(x,y,1,1).data;hoverColor='#'+[...pixel].slice(0,3).map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase();mag.hidden=false;mag.style.display='block';mag.style.left=Math.min(innerWidth-135,p.x+22)+'px';mag.style.top=Math.min(innerHeight-155,p.y+22)+'px';magCtx.imageSmoothingEnabled=false;magCtx.clearRect(0,0,110,110);magCtx.drawImage(source,x-5,y-5,11,11,0,0,110,110);magCtx.strokeStyle='#fff';magCtx.strokeRect(50,50,10,10);magCtx.strokeStyle='#000';magCtx.strokeRect(49,49,12,12);mag.querySelector('span').textContent=hoverColor;}
  canvas.onpointerdown=run(async e=>{if(e.button!==0)return;const p=point(e);if(state.mode==='color'){magnify(p);await api.copyText(hoverColor);await api.cancelCapture();return;}canvas.setPointerCapture(e.pointerId);start=p;original=rect?{...rect}:null;drag=handleAt(p)||'new';if(drag==='new')rect={x:p.x,y:p.y,width:0,height:0};bar.hidden=true;draw();});
  canvas.onpointermove=e=>{const p=point(e);if(state.mode==='color'){magnify(p);return;}if(!drag){canvas.style.cursor=handleAt(p)==='move'?'move':handleAt(p)?'nwse-resize':'crosshair';return;}if(drag==='new')rect=normalize(start,p);else if(drag==='move'){rect={...original,x:Math.max(0,Math.min(viewW-original.width,original.x+p.x-start.x)),y:Math.max(0,Math.min(viewH-original.height,original.y+p.y-start.y))};}else{const opposite={x:drag.includes('w')?original.x+original.width:original.x,y:drag.includes('n')?original.y+original.height:original.y};rect=normalize(opposite,p);}draw();};
  canvas.onpointerup=()=>{if(!drag)return;drag=null;if(!rect||rect.width<2||rect.height<2){rect=null;size.hidden=true;draw();return;}if(state.mode==='ocr')finish('ocr');else if(state.mode==='scroll')finish('scroll');else toolbar();};
  canvas.ondblclick=()=>finish('copy');canvas.oncontextmenu=e=>{e.preventDefault();if(rect){rect=null;bar.hidden=true;size.hidden=true;draw();}else api.cancelCapture();};
  document.addEventListener('keydown',run(async e=>{if(e.key==='Escape'){await api.cancelCapture();return;}if(!rect)return;if(e.key==='Enter'){await finish('edit');return;}if((e.ctrlKey||e.metaKey)&&['c','s','t'].includes(e.key.toLowerCase())){e.preventDefault();await finish({c:'copy',s:'save',t:'pin'}[e.key.toLowerCase()]);return;}if(e.key.startsWith('Arrow')){e.preventDefault();const dx=e.key==='ArrowLeft'?-1:e.key==='ArrowRight'?1:0,dy=e.key==='ArrowUp'?-1:e.key==='ArrowDown'?1:0;if(e.shiftKey){rect.width=Math.max(2,Math.min(viewW-rect.x,rect.width+dx));rect.height=Math.max(2,Math.min(viewH-rect.y,rect.height+dy));}else{rect.x=Math.max(0,Math.min(viewW-rect.width,rect.x+dx));rect.y=Math.max(0,Math.min(viewH-rect.height,rect.y+dy));}draw();toolbar();}}));draw();
}
