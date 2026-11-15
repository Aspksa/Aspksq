/* Real avatar pointer events + persisted chat API; fake Cloud.ru, no token spend. */
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'tracktor-assistant-'));
const server=spawn(process.env.PYTHON||'python3',[path.join(__dirname,'cloud_ui_server.py'),'--port','0','--database',path.join(temporary,'db.sqlite3')],{stdio:['ignore','pipe','pipe']});
let stderr='';server.stderr.on('data',chunk=>stderr+=chunk.toString());
const output=path.join(root,'artifacts','screenshots');fs.mkdirSync(output,{recursive:true});
async function ready(page){await page.waitForFunction(()=>!document.querySelector('#chatRefresh').disabled&&!document.querySelector('#chatInput').disabled);}
async function finished(page,text){await page.waitForFunction(text=>document.querySelector('#chatMessages').textContent.includes(text)&&!document.querySelector('#chatInput').disabled,text,{timeout:15000});}
async function drag(page,from,to){await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:12});await page.mouse.up();}
(async()=>{
 let browser;
 try{
  const site=await new Promise((resolve,reject)=>{
   let text='';const timer=setTimeout(()=>reject(new Error('Server startup: '+stderr)),15000);
   server.stdout.on('data',chunk=>{text+=chunk.toString();const match=text.match(/TRACKTOR: (http:\/\/[^\s]+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
   server.once('error',error=>{clearTimeout(timer);reject(error);});
   server.once('exit',code=>{clearTimeout(timer);reject(new Error('Server exited '+code+' '+stderr));});
  });
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});
  const errors=[];
  for(const width of [390,740,1024,1440]){
   const context=await browser.newContext({viewport:{width,height:900},hasTouch:true});const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
   await page.goto(site);await page.waitForFunction(()=>window.TracktorDB&&window.TracktorDB.isReady());
   await page.request.post(site+'api/cloud/settings',{data:{remove_key:true}});
   const avatar=page.locator('#assistantAvatar');
   await avatar.click();await ready(page);assert((await page.locator('#chatModel').innerText()).includes('Подключите'));
   assert(await page.locator('#chatSend').isDisabled(),'Sending without credentials');
   await page.locator('#chatClose').click();
   if(width===390){
    await page.evaluate(()=>sessionStorage.setItem('tracktor-chat-pending',JSON.stringify({request_id:crypto.randomUUID(),session_id:crypto.randomUUID(),task:'Черновик из прежней базы',expected_model:'test/model-one',max_tokens:2048})));
    await page.reload();await avatar.click();await ready(page);
    assert.equal(await page.locator('#chatInput').inputValue(),'Черновик из прежней базы','A restored backup lost the unsent draft');
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('tracktor-chat-pending')),null);
    assert((await page.locator('#chatStatus').innerText()).includes('автоматической отправки нет'));
    await page.locator('#chatClose').click();
   }
   let box=await avatar.boundingBox();await drag(page,{x:box.x+32,y:box.y+32},{x:110,y:180});
   assert(await page.locator('#assistantChat').isHidden(),'Dragging opened chat');
   box=await avatar.boundingBox();assert(Math.abs(box.x-78)<3&&Math.abs(box.y-148)<3);
   await page.waitForFunction(()=>Number(localStorage.getItem('tracktor-avatar-position')!==null));
   await page.waitForFunction(async()=>{const value=await (await fetch('/api/assistant-position')).json(),local=JSON.parse(localStorage.getItem('tracktor-avatar-position'));return Math.abs(value.x-local.x)<.001&&Math.abs(value.y-local.y)<.001;});
   await page.reload();await page.waitForFunction(()=>window.TracktorDB&&window.TracktorDB.isReady());
   box=await avatar.boundingBox();assert(Math.abs(box.x-78)<3,'Avatar position not restored');
   // Native touch events check the same drag path used on a phone.
   const cdp=await context.newCDPSession(page);
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+32,y:box.y+32}]});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:175,y:250}]});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   assert(await page.locator('#assistantChat').isHidden(),'Touch drag opened chat');
   box=await avatar.boundingBox();assert(Math.abs(box.x-143)<4&&Math.abs(box.y-218)<4,'Touch drag failed');
   await avatar.focus();await page.keyboard.press('ArrowRight');box=await avatar.boundingBox();assert(Math.abs(box.x-159)<4,'Keyboard move failed');
   await page.keyboard.press('Home');
   await page.request.post(site+'api/cloud/settings',{data:{api_key:'test-key-ui-valid',model:'test/model-one'}});
   await avatar.click();await ready(page);
   if(width<=700){assert.equal(await page.locator('#assistantChat').getAttribute('aria-modal'),'true');assert(await page.locator('.app').evaluate(e=>e.inert));assert(await avatar.isHidden());}
   else assert.equal(await page.locator('#assistantChat').getAttribute('aria-modal'),'false');
   await page.locator('#chatNew').click();await ready(page);
   const initial=(await (await page.request.get(site+'api/chat')).json()).session_id;
   let posts=0;page.on('request',request=>{if(request.url().endsWith('/api/chat/turns')&&request.method()==='POST')posts++;});
   const task='Задача '+width+': составь план на русском языке.';
   await page.locator('#chatInput').fill(task);
   const accepted=page.waitForResponse(response=>response.url().endsWith('/api/chat/turns')&&response.request().method()==='POST');
   await page.locator('#chatSend').evaluate(button=>{button.click();button.click();});
   const turn=await (await accepted).json();
   await page.locator('#chatClose').click();await avatar.click();
   await finished(page,'Ответ помощника: '+task);assert.equal(posts,1,'Double click made a second paid call');
   assert.equal(await page.locator('#chatMessages img').count(),0,'Provider output inserted as HTML');
   assert((await page.locator('#chatMessages').innerText()).includes('<img src=x'));
   await page.reload();await avatar.click();await ready(page);await finished(page,'Ответ помощника: '+task);assert.equal(posts,1,'Reload resubmitted');
   assert.equal((await (await page.request.get(site+'api/chat/turns/'+turn.id)).json()).status,'succeeded');
   await page.locator('#chatInput').fill('Уточни второй пункт');await page.locator('#chatInput').press('Enter');
   await finished(page,'Учтено сообщений: 4');assert.equal(posts,2);
   const bounds=await page.locator('#assistantChat').boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=width+1&&bounds.y>=0&&bounds.y+bounds.height<=901,'Chat outside viewport');
   await page.screenshot({path:path.join(output,'assistant-chat-'+width+'.png')});
   await page.locator('#chatNew').click();await ready(page);assert((await page.locator('#chatMessages').innerText()).includes('С чего начнём?'));
   await page.locator('#chatSession').selectOption(initial);await ready(page);await finished(page,'Уточни второй пункт');
   // Lose an accepted POST response. Reconcile from SQLite rather than generate again.
   await page.route('**/api/chat/turns',async route=>{await route.fetch();await route.abort('failed');await page.unroute('**/api/chat/turns');});
   await page.locator('#chatInput').fill('Проверка потерянного ответа');await page.locator('#chatSend').click();
   await finished(page,'Ответ помощника: Проверка потерянного ответа');assert.equal(posts,3,'Lost response generated again');
   assert.equal(await page.evaluate(()=>sessionStorage.getItem('tracktor-chat-pending')),null);
   await page.locator('#chatClose').click();assert.equal(await page.locator('.app').evaluate(e=>e.inert),false);
   // Avatar remains available after navigation to the other page.
   await page.locator('#openBrainButton').click();await avatar.click();await ready(page);await finished(page,'Проверка потерянного ответа');
   await page.locator('#chatClose').click();
   await page.setViewportSize({width:320,height:600});box=await avatar.boundingBox();assert(box.x>=0&&box.x+box.width<=320&&box.y+box.height<=600,'Avatar lost after resize');
   await context.close();
  }
  assert.deepEqual(errors,[]);console.log('✓ Avatar mouse/touch/keyboard drag, persisted position, chat history/context, reload, no duplicate requests, lost POST response, safe text, 4 widths');
 }catch(error){console.error(error);console.error(stderr.slice(-2500));process.exitCode=1;}
 finally{if(browser)await browser.close();server.kill();await new Promise(resolve=>server.once('close',resolve));fs.rmSync(temporary,{recursive:true,force:true});}
})();
