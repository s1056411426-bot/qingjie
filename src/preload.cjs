const {contextBridge,ipcRenderer}=require('electron');
const methods=['init','capture','cancelCapture','selectCapture','listWindows','captureWindow','importImage','pasteImage','copyImage','saveImage','pinImage','pinClipboard','pinControl','history','openHistory','deleteHistory','commitDocument','settings','ocr','readQR','copyText','finishScroll','cancelScroll','close','minimize','quit','openPrivacy'];
const api={};
for(const method of methods) api[method]=(...args)=>ipcRenderer.invoke('qingjie:'+method,...args).then(r=>{if(!r.ok)throw Error(r.error);return r.value;});
api.on=(event,callback)=>{
  if(!['document','historyChanged','ocrProgress','scrollProgress','error'].includes(event))throw Error('未知事件');
  const handler=(_,data)=>callback(data);ipcRenderer.on('qingjie:'+event,handler);
  return ()=>ipcRenderer.removeListener('qingjie:'+event,handler);
};
contextBridge.exposeInMainWorld('qingjie',api);
