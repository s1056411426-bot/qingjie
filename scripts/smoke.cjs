const{_electron:electron}=require('playwright');const path=require('node:path');const fs=require('node:fs');const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'.test-output');fs.mkdirSync(out,{recursive:true});
const env={...process.env,QINGJIE_TEST:'1',QINGJIE_DATA_DIR:path.join(root,'.test-data',String(Date.now()))};delete env.ELECTRON_RUN_AS_NODE;
async function main(){let app;const errors=[];try{
  app=await electron.launch({executablePath:process.env.QINGJIE_EXE||require('electron'),args:process.env.QINGJIE_EXE?[]:[root],env,timeout:60000});
  app.process().stderr.on('data',data=>fs.appendFileSync(path.join(out,'runtime.log'),data));
  app.on('window',page=>page.on('pageerror',e=>errors.push(e.message)));
  const page=await app.firstWindow();await page.waitForSelector('#new-capture',{timeout:30000});
  await app.evaluate(async({clipboard})=>{globalThis.__testClipboard=await clipboard.read();});
  await page.screenshot({path:path.join(out,'01-home.png')});
  const noNode=await page.evaluate(()=>typeof require);assert.equal(noNode,'undefined');
  const sample=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1100;c.height=680;const x=c.getContext('2d');x.fillStyle='#fbf8f1';x.fillRect(0,0,1100,680);x.fillStyle='#174d3b';x.font='bold 64px Arial';x.fillText('Capture a little inspiration.',60,110);x.font='32px "Microsoft YaHei"';x.fillText('轻截 · 让每一个重点更清晰',60,175);x.fillStyle='#dbe9dd';x.fillRect(60,220,980,250);x.fillStyle='#679d7b';x.fillRect(95,260,220,170);x.fillStyle='#fff';x.font='bold 48px Arial';x.fillText('HELLO',120,355);x.fillStyle='#345a45';x.font='25px Arial';x.fillText('Local. Simple. Always within reach.',360,305);x.font='22px Arial';x.fillText('Screenshot  /  Annotate  /  Pin  /  OCR',360,365);x.fillStyle='#557665';x.font='30px Arial';x.fillText('QINGJIE 2026',60,555);x.font='22px Arial';x.fillText('Your everyday capture space.',60,605);return c.toDataURL();});
  await app.evaluate(async({clipboard,ClipboardItem,nativeImage},data)=>clipboard.write([new ClipboardItem({'image/png':new Blob([new Uint8Array(nativeImage.createFromDataURL(data).toPNG())],{type:'image/png'})})]),sample);
  await page.evaluate(()=>window.qingjie.pasteImage());await page.waitForSelector('#edit-canvas');
  const canvas=page.locator('#edit-canvas');const box=await canvas.boundingBox();
  await page.locator('[data-tool="rect"]').click();await page.mouse.move(box.x+box.width*.3,box.y+box.height*.38);await page.mouse.down();await page.mouse.move(box.x+box.width*.86,box.y+box.height*.6,{steps:12});await page.mouse.up();
  await page.locator('[data-tool="arrow"]').click();await page.mouse.move(box.x+box.width*.65,box.y+box.height*.8);await page.mouse.down();await page.mouse.move(box.x+box.width*.7,box.y+box.height*.62,{steps:12});await page.mouse.up();
  await page.locator('[data-tool="number"]').click();await page.mouse.click(box.x+box.width*.3,box.y+box.height*.38);
  await page.locator('[data-tool="text"]').click();await page.mouse.click(box.x+box.width*.6,box.y+box.height*.84);await page.locator('#annotation-text').fill('重点在这里');await page.locator('#text-add').click();
  await page.locator('#editor-undo').click();await page.locator('#editor-redo').click();
  await page.screenshot({path:path.join(out,'02-editor.png')});
  await page.locator('#editor-copy').click();await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('图片已复制'));
  const clip=await app.evaluate(async({clipboard,nativeImage})=>{const items=await clipboard.read();const blob=await items.find(i=>i.types.includes('image/png')).getType('image/png');return nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer())).getSize();});assert.deepEqual(clip,{width:1100,height:680});
  let hist=await page.evaluate(()=>window.qingjie.history());assert.equal(hist.length,1);assert.equal(hist[0].width,1100);
  await app.evaluate(({dialog},dest)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:dest});},path.join(out,'export.jpg'));
  await page.locator('#editor-save').click();await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('图片已保存'));
  assert.equal(fs.readFileSync(path.join(out,'export.jpg')).subarray(0,2).toString('hex'),'ffd8');
  const pinPromise=app.waitForEvent('window');await page.locator('#editor-pin').click();const pin=await pinPromise;await pin.waitForSelector('.pin-content img');assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(w=>w.isAlwaysOnTop())),true);await pin.locator('#pin-close').click();
  const ocr=await Promise.race([page.evaluate(data=>window.qingjie.ocr(data),sample),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('OCR timed out after 30 seconds')),30000);timer.unref();})]);assert.match(ocr.text,/Capture a little inspiration/);assert.match(ocr.text,/QINGJIE 2026/);assert.match(ocr.text,/让每一个重点更清晰/);fs.writeFileSync(path.join(out,'ocr-result.txt'),ocr.text);
  // UI crop + undo restores the full-resolution original.
  await page.locator('[data-tool="crop"]').click();await page.mouse.move(box.x+box.width*.05,box.y+box.height*.05);await page.mouse.down();await page.mouse.move(box.x+box.width*.8,box.y+box.height*.8,{steps:10});await page.mouse.up();await page.waitForFunction(()=>document.querySelector('#edit-canvas').width<1100);await page.locator('#editor-undo').click();await page.waitForFunction(()=>document.querySelector('#edit-canvas').width===1100);
  await page.locator('#editor-back').click();await page.waitForSelector('#new-capture');await page.locator('[data-nav="history"]').click();await page.waitForSelector('.history-card');await page.screenshot({path:path.join(out,'03-history.png')});
  // Actual desktop capture, real overlay and physical pixel crop.
  const overlayPromise=app.waitForEvent('window');await page.evaluate(()=>window.qingjie.capture('region'));
  const overlay=await overlayPromise;await overlay.waitForSelector('#screen-canvas');await overlay.waitForFunction(()=>document.querySelector('#screen-canvas').width>0);await overlay.mouse.move(80,90);await overlay.mouse.down();await overlay.mouse.move(540,390,{steps:20});await overlay.mouse.up();await overlay.locator('[data-action="edit"]').waitFor();await overlay.screenshot({path:path.join(out,'04-capture.png')});
  await overlay.locator('[data-action="edit"]').click();await page.waitForSelector('#edit-canvas');const dims=await page.locator('#edit-canvas').evaluate(c=>({w:c.width,h:c.height}));assert.ok(dims.w>=460&&dims.h>=300,JSON.stringify(dims));
  await page.locator('#editor-back').click();await page.waitForSelector('#new-capture');await page.locator('[data-nav="settings"]').click();await page.waitForSelector('#settings-form');await page.screenshot({path:path.join(out,'05-settings.png')});
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'smoke-result.json'),JSON.stringify({passed:true,platform:process.platform,packaged:!!process.env.QINGJIE_EXE,captureDimensions:dims,ocrText:ocr.text,rendererErrors:errors},null,2));console.log('PASS: home, annotation, undo/redo, clipboard, history, JPG save, pin, offline OCR, crop, actual screen capture, settings, isolated renderer.');
}finally{if(app){await app.evaluate(async({clipboard})=>{if(globalThis.__testClipboard?.length)await clipboard.write(globalThis.__testClipboard);else await clipboard.clear();}).catch(()=>{});await app.close();}}}
main().catch(e=>{console.error(e);process.exitCode=1;});
