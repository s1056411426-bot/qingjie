const{chromium}=require('playwright');const{spawn}=require('node:child_process');const path=require('node:path');const fs=require('node:fs');const net=require('node:net');
const root=path.resolve(__dirname,'..'),out=path.join(root,'.test-output');
const appVersion=require('../package.json').version;
async function getPort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function main(){
  const port=await getPort();
  const env={...process.env,QINGJIE_TEST:'1',QINGJIE_DATA_DIR:path.join(root,'.test-data','portable-'+Date.now())};delete env.ELECTRON_RUN_AS_NODE;
  const proc=spawn(path.join(root,`release/Qingjie-${appVersion}-win-x64.exe`),[`--remote-debugging-port=${port}`,'--remote-debugging-address=127.0.0.1'],{env,windowsHide:true,stdio:'ignore'});
  let browser,page;
  try{
    for(let i=0;i<90;i++){try{const r=await fetch(`http://127.0.0.1:${port}/json/version`);if(r.ok)break;}catch{}await new Promise(r=>setTimeout(r,500));}
    browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`,{timeout:20000});
    for(let i=0;i<40;i++){page=browser.contexts()[0].pages().find(p=>p.url().includes('index.html'));if(page)break;await new Promise(r=>setTimeout(r,250));}
    if(!page)throw Error('No app page: '+JSON.stringify(browser.contexts()[0].pages().map(p=>p.url())));
    await page.waitForSelector('#new-capture',{timeout:15000});
    await page.screenshot({path:path.join(out,'08-portable-home.png')});
    const version=await page.evaluate(()=>window.qingjie.init());if(version.version!==appVersion)throw Error('Version mismatch');
    console.log('PASS: portable EXE extracted and launched the desktop application.');fs.writeFileSync(path.join(out,'portable-result.json'),JSON.stringify({passed:true,version:version.version},null,2));
  }catch(e){if(page){console.log('Portable page:',page.url(),await page.locator('body').textContent().catch(()=>''));await page.screenshot({path:path.join(out,'portable-debug.png')}).catch(()=>{});}throw e;}
  finally{if(page)await page.evaluate(()=>window.qingjie?.quit()).catch(()=>{});if(browser)await browser.close().catch(()=>{});if(proc.exitCode===null)proc.kill();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
