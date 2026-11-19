'use strict';
const {app,BrowserWindow,ipcMain,screen,desktopCapturer,clipboard,nativeImage,dialog,globalShortcut,Tray,Menu,shell,systemPreferences,session}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const {fileURLToPath}=require('node:url');
const {randomUUID}=require('node:crypto');
const {PNG}=require('pngjs');
const {cropRect,findShift,appendFrame,safeImage}=require('./core.cjs');
const imageClipboard=require('./clipboard.cjs');
const isTest=process.env.QINGJIE_TEST==='1';
// Keep the ICO outside ASAR so Windows can load its native size variants.
const windowsIcon=app.isPackaged?path.join(process.resourcesPath,'icon.ico'):path.join(__dirname,'../assets/icon.ico');
const appIcon=process.platform==='win32'?windowsIcon:path.join(__dirname,'../assets/icon.png');
if(process.env.QINGJIE_DATA_DIR)app.setPath('userData',path.resolve(process.env.QINGJIE_DATA_DIR));
app.setName('轻截');
let home,tray,quitting=false,capturing=false,scrollSession=null,workerPromise=null,ocrBusy=false;
const windows=new Map(),overlays=new Map(),pins=new Set();
const dataDir=app.getPath('userData'),historyDir=path.join(dataDir,'history');
fs.mkdirSync(historyDir,{recursive:true});
function readJson(file,fallback){try{return JSON.parse(fs.readFileSync(path.join(dataDir,file),'utf8'));}catch{return fallback;}}
function writeJson(file,data){const dest=path.join(dataDir,file);fs.writeFileSync(dest+'.tmp',JSON.stringify(data,null,2));fs.renameSync(dest+'.tmp',dest);}
let prefs={captureShortcut:'CommandOrControl+Shift+A',pinShortcut:'CommandOrControl+Shift+P',finishShortcut:'CommandOrControl+Shift+L',keepHistory:true,historyLimit:100,closeToTray:true,...readJson('settings.json',{})};
let records=readJson('history.json',[]);if(!Array.isArray(records))records=[];
records=records.filter(x=>x&&/^[\w-]+$/.test(x.id)&&fs.existsSync(path.join(historyDir,x.id+'.png')));
const emit=(win,event,data)=>{if(win&&!win.isDestroyed())win.webContents.send('qingjie:'+event,data);};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function makeWindow(role,options={},payload={}){
  const win=new BrowserWindow({width:1180,height:800,minWidth:900,minHeight:620,show:false,backgroundColor:'#f5f7f8',title:'轻截',autoHideMenuBar:true,icon:appIcon,...options,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
  windows.set(win.webContents.id,{role,win,payload});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',e=>e.preventDefault());
  const contentsId=win.webContents.id;
  win.on('closed',()=>windows.delete(contentsId));
  win.loadFile(path.join(__dirname,'ui/index.html'),{query:{role}});
  win.once('ready-to-show',()=>{if(role==='capture'){win.showInactive();}else win.show();});
  return win;
}
function showHome(){if(!home||home.isDestroyed()){
  home=makeWindow('home');
  home.on('close',e=>{if(!quitting&&prefs.closeToTray&&!isTest){e.preventDefault();home.hide();}});
}else{home.show();home.focus();}return home;}
function notifyError(error){const msg=error?.message||String(error);showHome();emit(home,'error',msg);console.error(msg);}
function metadataImage(image){const size=image.getSize();if(image.isEmpty()||size.width*size.height>60000000)throw Error('无法读取图片或图片过大');return{data:image.toDataURL(),width:size.width,height:size.height};}
function documentFrom(image,name='截图'){return{id:randomUUID(),name,...metadataImage(image),createdAt:new Date().toISOString()};}
function trimHistory(){while(records.length>prefs.historyLimit){const old=records.pop();for(const suffix of ['.png','.thumb.png'])try{fs.unlinkSync(path.join(historyDir,old.id+suffix));}catch{}}}
function remember(doc){
  if(!prefs.keepHistory)return;
  const bytes=safeImage(doc.data),image=nativeImage.createFromBuffer(bytes);
  fs.writeFileSync(path.join(historyDir,doc.id+'.png'),bytes);
  fs.writeFileSync(path.join(historyDir,doc.id+'.thumb.png'),image.resize({width:360}).toPNG());
  records=records.filter(x=>x.id!==doc.id);const{data,...meta}=doc;records.unshift(meta);trimHistory();writeJson('history.json',records);emit(home,'historyChanged');
}
function openDocument(doc,ocr=false){remember(doc);const win=showHome();windows.get(win.webContents.id).payload.document=doc;emit(win,'document',{...doc,ocr});}
function imageFrom(data){const image=nativeImage.createFromBuffer(safeImage(data));if(image.isEmpty())throw Error('图片解码失败');return image;}
async function saveImage(data,owner){const image=imageFrom(data);const result=await dialog.showSaveDialog(owner,{title:'保存截图',defaultPath:path.join(app.getPath('pictures'),`轻截-${new Date().toISOString().replace(/[:.]/g,'-')}.png`),filters:[{name:'PNG 图片',extensions:['png']},{name:'JPEG 图片',extensions:['jpg','jpeg']}]});if(result.canceled)return false;fs.writeFileSync(result.filePath,/\.jpe?g$/i.test(result.filePath)?image.toJPEG(95):image.toPNG());return true;}
function pinImage(data,text){const image=data?imageFrom(data):null;const size=image?image.getSize():{width:360,height:240};const area=screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;const scale=Math.min(1,(area.width*.6)/size.width,(area.height*.7)/size.height);
  const win=makeWindow('pin',{width:Math.max(180,Math.round(size.width*scale)),height:Math.max(120,Math.round(size.height*scale)+36),minWidth:120,minHeight:80,frame:false,alwaysOnTop:true,skipTaskbar:true,resizable:true,backgroundColor:'#ffffff'},{data,text});
  win.setAlwaysOnTop(true,'floating');win.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true});pins.add(win);win.on('closed',()=>pins.delete(win));return true;
}
async function pinClipboard(){const image=await imageClipboard.readImage();if(!image.isEmpty())return pinImage(image.toDataURL());const text=await clipboard.readText();if(text.trim())return pinImage(null,text.slice(0,100000));throw Error('剪贴板里没有图片或文字');}
function bindShortcuts(next){
  const old=prefs;globalShortcut.unregisterAll();
  const entries=[[next.captureShortcut,()=>startCapture('region').catch(notifyError)],[next.pinShortcut,()=>pinClipboard().catch(notifyError)],[next.finishShortcut,()=>{if(scrollSession)finishScroll().catch(notifyError);}]];
  try{for(const[key,cb]of entries){if(typeof key!=='string'||key.length>80||!globalShortcut.register(key,cb))throw Error(`快捷键 ${key} 不可用或被占用`);}}
  catch(e){globalShortcut.unregisterAll();if(next!==old){try{bindShortcuts(old);}catch{}}throw e;}
}
async function captureSources(types=['screen']){
  if(process.platform==='darwin'&&systemPreferences.getMediaAccessStatus('screen')==='denied')throw Error('请在系统设置 → 隐私与安全性 → 屏幕与系统音频录制中允许轻截访问屏幕，然后重启轻截。');
  const displays=screen.getAllDisplays();const width=Math.max(...displays.map(d=>Math.round(d.size.width*d.scaleFactor))),height=Math.max(...displays.map(d=>Math.round(d.size.height*d.scaleFactor)));
  const sources=await desktopCapturer.getSources({types,thumbnailSize:{width,height},fetchWindowIcons:false});
  if(!sources.length)throw Error('未获取到屏幕，请检查系统屏幕访问权限');return sources;
}
function closeOverlays(){for(const {win}of overlays.values())if(!win.isDestroyed())win.close();overlays.clear();capturing=false;}
async function startCapture(mode='region',seconds=0){
  if(capturing||scrollSession)throw Error('请先完成当前截图');
  if(!['region','full','scroll','ocr','color'].includes(mode))throw Error('未知截图模式');
  capturing=true;const wasVisible=home?.isVisible();if(home)home.hide();
  try{
    await delay(Math.max(200,Math.min(10,Number(seconds)||0)*1000));
    const sources=await captureSources();
    if(mode==='full'){
      const display=screen.getDisplayNearestPoint(screen.getCursorScreenPoint());const source=sources.find(s=>s.display_id===String(display.id))||(sources.length===1?sources[0]:null);if(!source)throw Error('无法匹配当前显示器');
      capturing=false;openDocument(documentFrom(source.thumbnail,'全屏截图'));return;
    }
    for(const display of screen.getAllDisplays()){
      const source=sources.find(s=>s.display_id===String(display.id))||(sources.length===1?sources[0]:null);if(!source||source.thumbnail.isEmpty())continue;
      const payload={...metadataImage(source.thumbnail),display:{id:display.id,...display.bounds},mode};
      const win=makeWindow('capture',{...display.bounds,minWidth:1,minHeight:1,frame:false,alwaysOnTop:true,skipTaskbar:true,resizable:false,movable:false,enableLargerThanScreen:true},payload);
      win.setAlwaysOnTop(true,'screen-saver');win.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true});if(process.platform==='darwin')win.setFullScreenable(false);
      overlays.set(win.webContents.id,{win,display,source});
    }
    if(!overlays.size)throw Error('没有可截图的显示器');
    const focused=[...overlays.values()].find(o=>o.display.id===screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id)||[...overlays.values()][0];focused.win.once('ready-to-show',()=>focused.win.focus());
  }catch(e){closeOverlays();if(wasVisible)showHome();throw e;}
}
async function selectCapture(sender,{rect,action='edit'}){
  const item=overlays.get(sender.id);if(!item)throw Error('截图已结束');
  if(!['edit','copy','save','pin','ocr','scroll'].includes(action))throw Error('未知截图操作');
  const {source,display}=item;const pixelRect=cropRect(rect,display.size,source.thumbnail.getSize());
  const image=source.thumbnail.crop(pixelRect);closeOverlays();
  if(action==='scroll'){await beginScroll(source,display,pixelRect,image,rect);return;}
  const doc=documentFrom(image);
  if(action==='edit'||action==='ocr'){openDocument(doc,action==='ocr');return;}
  remember(doc);if(action==='copy')await imageClipboard.writeImage(image);if(action==='pin')pinImage(doc.data);if(action==='save')await saveImage(doc.data,showHome());
}
async function beginScroll(source,display,rect,image,logicalRect){
  if(rect.height<100||rect.width<80)throw Error('长截图选区至少需要 80 × 100 像素');
  const s={sourceId:source.id,displayId:display.id,rect,last:PNG.sync.read(image.toPNG()),combined:PNG.sync.read(image.toPNG()),busy:false,stopped:false,count:1,controller:null};scrollSession=s;
  const bounds=display.bounds,globalRect={x:bounds.x+logicalRect.x,y:bounds.y+logicalRect.y,width:logicalRect.width,height:logicalRect.height};
  const candidates=[{x:bounds.x+18,y:bounds.y+18},{x:bounds.x+bounds.width-338,y:bounds.y+18},{x:bounds.x+18,y:bounds.y+bounds.height-198},{x:bounds.x+bounds.width-338,y:bounds.y+bounds.height-198}];
  const pos=candidates.find(p=>p.x+320<globalRect.x||p.x>globalRect.x+globalRect.width||p.y+180<globalRect.y||p.y>globalRect.y+globalRect.height);
  if(pos){s.controller=makeWindow('scroll',{...pos,width:320,height:180,minWidth:320,minHeight:180,frame:false,alwaysOnTop:true,resizable:false,skipTaskbar:true},{shortcut:prefs.finishShortcut});s.controller.on('closed',()=>{if(!s.stopped)finishScroll().catch(notifyError);});}
  else {await dialog.showMessageBox({type:'info',message:'长截图已开始',detail:`请缓慢向下滚动，每次不超过半屏。完成后按 ${prefs.finishShortcut}。工具栏因选区过大已隐藏。`});}
  async function tick(){if(s.stopped)return;s.busy=true;
    try{
      const sources=await captureSources();if(s.stopped)return;const src=sources.find(x=>x.id===s.sourceId||x.display_id===String(s.displayId));if(!src)throw Error('显示器已断开');
      const next=PNG.sync.read(src.thumbnail.crop(s.rect).toPNG()),match=findShift(s.last,next);let status='等待向下滚动…';
      if(match.kind==='append'){s.combined=appendFrame(s.combined,next,match.shift);s.last=next;s.count++;status=`已拼接 ${s.count} 屏 · ${s.combined.width} × ${s.combined.height}`;}
      else if(match.kind!=='same')status='未匹配：请往回滚动到上次位置，再慢慢向下滚动';
      emit(s.controller,'scrollProgress',{status,height:s.combined.height,count:s.count});
    }catch(e){emit(s.controller,'scrollProgress',{status:e.message});if(!s.controller)notifyError(e);}
    finally{s.busy=false;if(!s.stopped)s.timer=setTimeout(tick,850);}
  }
  s.timer=setTimeout(tick,1000);
}
async function finishScroll(){const s=scrollSession;if(!s||s.stopped)return;s.stopped=true;clearTimeout(s.timer);if(s.controller&&!s.controller.isDestroyed())s.controller.close();scrollSession=null;openDocument(documentFrom(nativeImage.createFromBuffer(PNG.sync.write(s.combined)),'长截图'));}
function cancelScroll(){const s=scrollSession;if(!s)return;s.stopped=true;clearTimeout(s.timer);s.controller?.close();scrollSession=null;showHome();}
async function recognize(data,owner){if(ocrBusy)throw Error('文字识别正在进行，请稍候');ocrBusy=true;
  try{const bytes=safeImage(data);if(!workerPromise){const{createWorker}=require('tesseract.js');const langPath=app.isPackaged?path.join(process.resourcesPath,'ocr'):path.join(__dirname,'../assets/ocr');for(const lang of ['eng','chi_sim'])if(!fs.existsSync(path.join(langPath,lang+'.traineddata.gz')))throw Error('缺少离线识别模型，请先运行 npm run assets');
    workerPromise=createWorker(['eng','chi_sim'],1,{langPath,cacheMethod:'none',gzip:true,workerPath:require.resolve('tesseract.js/src/worker-script/node/index.js').replace('app.asar','app.asar.unpacked'),logger:m=>emit(owner,'ocrProgress',{status:m.status,progress:m.progress}),errorHandler:e=>console.error('OCR:',String(e))}).catch(e=>{workerPromise=null;throw e;});}
    const worker=await workerPromise;const {data:result}=await worker.recognize(bytes);return{text:result.text.replace(/(\p{Script=Han})[ \t]+(?=\p{Script=Han})/gu,'$1'),confidence:result.confidence};
  }finally{ocrBusy=false;}
}
const api={
  init:(_,ctx)=>({role:ctx.role,platform:process.platform,prefs,...ctx.payload,version:app.getVersion()}),
  capture:(_,ctx,mode,seconds)=>startCapture(mode,seconds),
  cancelCapture:()=>{closeOverlays();showHome();},
  selectCapture:(e,ctx,input)=>selectCapture(e.sender,input),
  listWindows:async()=>{const sources=await desktopCapturer.getSources({types:['window'],thumbnailSize:{width:400,height:260}});return sources.filter(s=>!s.name.startsWith('轻截')&&!s.thumbnail.isEmpty()).map(s=>({id:s.id,name:s.name,data:s.thumbnail.toDataURL()}));},
  captureWindow:async(_,ctx,id)=>{if(typeof id!=='string'||!id.startsWith('window:'))throw Error('无效窗口');home?.hide();try{await delay(200);const sources=await captureSources(['window']);const src=sources.find(s=>s.id===id);if(!src)throw Error('窗口已关闭');openDocument(documentFrom(src.thumbnail,'窗口截图'));}catch(e){showHome();throw e;}},
  importImage:async(_,ctx)=>{const result=await dialog.showOpenDialog(ctx.win,{properties:['openFile'],filters:[{name:'图片',extensions:['png','jpg','jpeg','webp','bmp']}]});if(result.canceled)return;const file=result.filePaths[0];if(fs.statSync(file).size>80*1024*1024)throw Error('图片文件过大');const doc=documentFrom(nativeImage.createFromPath(file),path.basename(file));openDocument(doc);},
  pasteImage:async()=>{const image=await imageClipboard.readImage();if(image.isEmpty())throw Error('剪贴板里没有图片');openDocument(documentFrom(image,'剪贴板图片'));},
  copyImage:async(_,ctx,data)=>{await imageClipboard.writeImage(imageFrom(data));return true;},
  saveImage:(_,ctx,data)=>saveImage(data,ctx.win),
  pinImage:(_,ctx,data)=>pinImage(data),pinClipboard:()=>pinClipboard(),
  pinControl:(_,ctx,action,value)=>{if(action==='opacity')ctx.win.setOpacity(Math.max(.2,Math.min(1,Number(value)||1)));if(action==='zoom'){const[w,h]=ctx.win.getSize(),f=Number(value)>0?1.1:1/1.1;const area=screen.getDisplayMatching(ctx.win.getBounds()).workArea;ctx.win.setSize(Math.round(Math.max(120,Math.min(area.width,w*f))),Math.round(Math.max(80,Math.min(area.height,(h-36)*f+36))))}},
  history:()=>records.map(r=>({...r,thumbnail:fs.existsSync(path.join(historyDir,r.id+'.thumb.png'))?nativeImage.createFromPath(path.join(historyDir,r.id+'.thumb.png')).toDataURL():''})),
  commitDocument:(_,ctx,input)=>{const current=ctx.payload.document;if(!current||current.id!==input?.id)throw Error('当前文档已变更');const updated={...current,...metadataImage(imageFrom(input.data))};ctx.payload.document=updated;remember(updated);return true;},
  openHistory:(_,ctx,id)=>{const item=records.find(r=>r.id===id);if(!item)throw Error('记录不存在');const doc={...item,data:nativeImage.createFromPath(path.join(historyDir,id+'.png')).toDataURL()};windows.get(showHome().webContents.id).payload.document=doc;emit(home,'document',doc);},
  deleteHistory:(_,ctx,id)=>{const item=records.find(r=>r.id===id);if(!item)throw Error('记录不存在');for(const suffix of ['.png','.thumb.png'])try{fs.unlinkSync(path.join(historyDir,id+suffix));}catch{}records=records.filter(r=>r.id!==id);writeJson('history.json',records);emit(home,'historyChanged');},
  settings:(_,ctx,next)=>{if(!next||typeof next!=='object')throw Error('设置格式错误');const updated={...prefs};for(const key of ['captureShortcut','pinShortcut'])if(key in next)updated[key]=next[key];for(const key of ['keepHistory','closeToTray'])if(key in next)updated[key]=!!next[key];if('historyLimit'in next){const n=Number(next.historyLimit);if(!Number.isInteger(n)||n<10||n>500)throw Error('历史记录数量应为 10–500');updated.historyLimit=n;}bindShortcuts(updated);prefs=updated;writeJson('settings.json',prefs);trimHistory();writeJson('history.json',records);return prefs;},
  ocr:(_,ctx,data)=>recognize(data,ctx.win),
  readQR:(_,ctx,data)=>{const png=PNG.sync.read(safeImage(data));const result=require('jsqr')(new Uint8ClampedArray(png.data),png.width,png.height);if(!result)throw Error('未识别到二维码，请选择清晰完整的二维码');return result.data;},
  copyText:async(_,ctx,text)=>{if(typeof text!=='string'||text.length>1000000)throw Error('文本过长');await clipboard.writeText(text);},
  finishScroll:()=>finishScroll(),cancelScroll:()=>cancelScroll(),
  close:(_,ctx)=>ctx.win.close(),minimize:(_,ctx)=>ctx.win.minimize(),quit:()=>{quitting=true;app.quit();},
  openPrivacy:()=>{if(process.platform==='darwin')return shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');}
};
const allowed={home:['init','capture','listWindows','captureWindow','importImage','pasteImage','copyImage','saveImage','pinImage','pinClipboard','history','openHistory','deleteHistory','commitDocument','settings','ocr','readQR','copyText','close','minimize','quit','openPrivacy'],capture:['init','cancelCapture','selectCapture','copyText'],pin:['init','pinControl','copyImage','saveImage','copyText','close'],scroll:['init','finishScroll','cancelScroll']};
function trustedPage(url,role){
  try{const parsed=new URL(url);if(parsed.protocol!=='file:'||(parsed.hostname&&parsed.hostname!=='localhost')||parsed.searchParams.get('role')!==role)return false;
    const actual=fs.realpathSync(fileURLToPath(parsed)),expected=fs.realpathSync(path.join(__dirname,'ui/index.html'));
    return process.platform==='win32'?actual.toLowerCase()===expected.toLowerCase():actual===expected;
  }catch{return false;}
}
for(const[method,handler]of Object.entries(api))ipcMain.handle('qingjie:'+method,async(e,...args)=>{try{const ctx=windows.get(e.sender.id);if(!ctx||!allowed[ctx.role].includes(method)||e.senderFrame!==e.sender.mainFrame||!trustedPage(e.senderFrame.url,ctx.role))throw Error('无效调用来源');return{ok:true,value:await handler(e,ctx,...args)};}catch(err){return{ok:false,error:err.message||String(err)};}});
if(!isTest&&!app.requestSingleInstanceLock())app.quit();
else app.whenReady().then(()=>{
  Menu.setApplicationMenu(process.platform==='darwin'?Menu.buildFromTemplate([{role:'appMenu'},{role:'editMenu'},{role:'windowMenu'}]):null);session.defaultSession.setPermissionRequestHandler((_,__,cb)=>cb(false));session.defaultSession.setPermissionCheckHandler(()=>false);
  // All product assets are local. OCR never sends image content over the network.
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_,cb)=>cb({cancel:true}));
  showHome();if(!isTest){tray=new Tray(process.platform==='win32'?windowsIcon:nativeImage.createFromPath(appIcon).resize({width:20,height:20}));tray.setToolTip('轻截 · 截图随手，灵感常在');tray.setContextMenu(Menu.buildFromTemplate([{label:'开始截图',click:()=>startCapture().catch(notifyError)},{label:'剪贴板贴图',click:()=>pinClipboard().catch(notifyError)},{label:'打开轻截',click:showHome},{type:'separator'},{label:'退出',click:()=>{quitting=true;app.quit();}}]));tray.on('double-click',showHome);try{bindShortcuts(prefs);}catch(e){home.webContents.once('did-finish-load',()=>emit(home,'error',e.message));}}
});
app.on('second-instance',showHome);app.on('activate',showHome);app.on('window-all-closed',()=>{if(isTest||quitting||!prefs.closeToTray)app.quit();});
app.on('before-quit',()=>{quitting=true;globalShortcut.unregisterAll();if(scrollSession){scrollSession.stopped=true;clearTimeout(scrollSession.timer);}if(workerPromise)workerPromise.then(w=>w.terminate()).catch(()=>{});});
