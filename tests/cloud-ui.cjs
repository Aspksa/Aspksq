/* Full local UI/API/SQLite flow with a simulated provider; never spends Cloud.ru tokens. */
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'tracktor-cloud-ui-'));
const server=spawn(process.env.PYTHON||'python3',[path.join(__dirname,'cloud_ui_server.py'),'--port','0','--database',path.join(temporary,'tracktor.sqlite3')],{stdio:['ignore','pipe','pipe']});
let serverOutput='';
server.stderr.on('data',chunk=>{serverOutput+=chunk.toString();});
const output=path.join(root,'artifacts','screenshots');
fs.mkdirSync(output,{recursive:true});
(async()=>{
  let browser;
  try {
    const site=await new Promise((resolve,reject)=>{
      let text='';
      const timer=setTimeout(()=>reject(new Error('Cloud test server startup failed: '+serverOutput)),15000);
      server.stdout.on('data',chunk=>{
        text+=chunk.toString();
        const match=text.match(/TRACKTOR: (http:\/\/[^\s]+)/);
        if(match){clearTimeout(timer);resolve(match[1]);}
      });
      server.once('error',e=>{clearTimeout(timer);reject(e);});
      server.once('exit',code=>{clearTimeout(timer);reject(new Error('Cloud test server exited: '+code+' '+text+' '+serverOutput));});
    });
    browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});
    const errors=[];
    for(const width of [390,740,1024,1440]) {
      const context=await browser.newContext({viewport:{width,height:900}});
      const page=await context.newPage();
      page.on('pageerror',error=>errors.push(error.message));
      await page.goto(site);
      await page.waitForFunction(()=>window.TracktorDB&&window.TracktorDB.isReady());
      await page.locator('#cloudButton').click();
      await page.waitForFunction(()=>!document.querySelector('#cloudKey').disabled);
      assert(await page.locator('#cloudModal').isVisible());
      assert.equal(await page.locator('#cloudKey').getAttribute('type'),'password');
      await page.locator('#cloudKey').fill('test-key-ui-valid');
      await page.locator('#cloudSaveKey').click();
      await page.waitForFunction(()=>!document.querySelector('#cloudModel').disabled&&document.querySelector('#cloudModel').options.length===3);
      assert.equal(await page.locator('#cloudKey').inputValue(),'');
      assert.equal(await page.locator('#cloudModal img').count(),0,'Provider names must be plain text');
      assert.equal((await (await page.request.get(site+'api/cloud/settings')).json()).verified_at,null,'Catalog must not authenticate the key');
      await page.locator('#cloudModel').selectOption('test/model-one');
      await page.locator('#cloudSaveModel').click();
      await page.waitForFunction(()=>document.querySelector('#cloudFeedback').textContent.includes('Модель сохранена'));
      await page.reload();
      await page.locator('#cloudButton').click();
      await page.waitForFunction(()=>!document.querySelector('#cloudModel').disabled&&document.querySelector('#cloudModel').value==='test/model-one');
      assert.equal(await page.locator('#cloudKey').inputValue(),'','Saved key must not return to the input');
      assert(!JSON.stringify(await (await page.request.get(site+'api/cloud/settings')).json()).includes('test-key-ui-valid'));
      await page.locator('#cloudVerify').click();
      await page.waitForFunction(()=>document.querySelector('#cloudReply').textContent.includes('Работает'));
      assert((await page.locator('#cloudConnectionStatus').innerText()).includes('успешная проверка'));
      const bounds=await page.locator('#cloudDialog').boundingBox();
      assert(bounds.x>=0&&bounds.x+bounds.width<=width+1&&bounds.y>=0&&bounds.y+bounds.height<=901,'Modal outside viewport');
      await page.screenshot({path:path.join(output,'cloud-'+width+'.png')});
      const storage=await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}}));
      assert(!storage.includes('test-key-ui-valid'),'Key must not enter browser storage');
      assert(!(await page.content()).includes('test-key-ui-valid'),'Key must not be in rendered HTML');
      // Public catalog still loads with an invalid key; only inference rejects it.
      await page.locator('#cloudKey').fill('test-key-ui-invalid');
      await page.locator('#cloudSaveKey').click();
      await page.waitForFunction(()=>!document.querySelector('#cloudVerify').disabled);
      await page.locator('#cloudVerify').click();
      await page.waitForFunction(()=>document.querySelector('#cloudFeedback').textContent.includes('отклонил ключ'));
      assert.equal((await (await page.request.get(site+'api/cloud/settings')).json()).verified_at,null);
      assert(await page.evaluate(()=>window.TracktorDB.isReady()),'Provider failure must not disconnect SQLite');
      await page.locator('#cloudKey').fill('test-key-ui-down');
      await page.locator('#cloudSaveKey').click();
      await page.waitForFunction(()=>document.querySelector('#cloudFeedback').textContent.includes('временно недоступен'));
      assert(await page.evaluate(()=>window.TracktorDB.isReady()),'Provider outage must not disconnect SQLite');
      await page.waitForFunction(()=>!document.querySelector('#cloudRemove').disabled);
      await page.locator('#cloudRemove').click();
      await page.waitForFunction(()=>document.querySelector('#cloudFeedback').textContent.includes('удалены'));
      assert.deepEqual(await (await page.request.get(site+'api/cloud/settings')).json(),{has_key:false,model:'',verified_at:null});
      await page.keyboard.press('Escape');
      assert(!(await page.locator('#cloudModal').isVisible()));
      await page.locator('#accountButton').click();
      await page.locator('#openCloudSettings').click();
      assert(!(await page.locator('#authModal').isVisible()));
      assert(await page.locator('#cloudModal').isVisible());
      await page.locator('#closeCloudModal').click();
      await context.close();
    }
    assert.deepEqual(errors,[]);
    console.log('✓ Cloud.ru UI/API/SQLite: 390/740/1024/1440, saved key/model, reload, verification, auth/outage errors, deletion; no real Cloud.ru calls');
  } finally {
    if(browser)await browser.close();
    if(server.exitCode===null){server.kill();await new Promise(resolve=>server.once('exit',resolve));}
    fs.rmSync(temporary,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
