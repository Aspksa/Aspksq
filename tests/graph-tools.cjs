/* Functional graph controls, edge provenance and live status, fake provider only. */
const {chromium}=require('playwright'),{spawn}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'tracktor-graph-tools-')),output=path.join(root,'artifacts','screenshots');fs.mkdirSync(output,{recursive:true});
const server=spawn(process.env.PYTHON||'python3',[path.join(__dirname,'cloud_ui_server.py'),'--port','0','--database',path.join(temporary,'data.sqlite3')],{env:{...process.env,TRACKTOR_TEST_CHAT_DELAY:'2.5'},stdio:['ignore','pipe','pipe']});let stderr='';server.stderr.on('data',chunk=>stderr+=chunk.toString());
async function ready(page){await page.waitForFunction(()=>!document.querySelector('#chatRefresh').disabled&&!document.querySelector('#chatInput').disabled);}
async function tools(page){if(await page.locator('#traceTools').isHidden())await page.locator('#traceToolsToggle').click();}
async function edgeCard(page,kind,text){const edge=page.locator('#mapViewport [data-trace-edge="'+kind+'"]').first();await edge.press('Enter');await page.waitForFunction(text=>document.querySelector('#traceContent').textContent.includes(text),text);assert(await page.locator('#traceModal').isVisible());assert.equal(await page.locator('#traceDialog script').count(),0);await page.locator('#traceClose').click();assert(await edge.evaluate(e=>e.classList.contains('is-selected')));}
(async()=>{let browser;try{
 const site=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error(stderr)),15000);server.stdout.on('data',chunk=>{text+=chunk.toString();const match=text.match(/TRACKTOR: (http:\/\/[^\s]+)/);if(match){clearTimeout(timer);resolve(match[1]);}});server.once('error',reject);});
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});const errors=[];
 for(const width of [390,740,1024,1440]){
  const context=await browser.newContext({viewport:{width,height:900},hasTouch:true}),page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(site);await page.waitForFunction(()=>window.TracktorDB&&window.TracktorDB.isReady());
  const title='Условия Сосна'+width,body='Проект Сосна'+width+': срок 25 ноября, стоимость 42000 рублей. <script>alert(1)</script>';
  const doc=(await (await page.request.post(site+'api/knowledge',{data:{id:crypto.randomUUID(),revision:0,title,body,tags:['сосна'+width]}})).json());
  await page.request.post(site+'api/cloud/settings',{data:{api_key:'test-key-ui-valid',model:'test/model-one'}});
  await page.locator('#assistantAvatar').click();await ready(page);await page.locator('#chatNew').click();await ready(page);
  let starts=0;page.on('request',request=>{if(request.url().endsWith('/api/chat/turns')&&request.method()==='POST')starts++;});
  await page.locator('#chatInput').fill('Расскажи о проекте Сосна'+width);await page.locator('#chatSend').click();
  await page.waitForFunction(()=>document.querySelector('#tracePhase').dataset.phase==='waiting',null,{timeout:10000});
  assert(await page.locator('#mapViewport .trace-edge.is-active').count()>0,'Pending request has no live indication');
  await page.locator('#chatClose').click();await page.waitForFunction(()=>document.querySelector('#tracePhase').dataset.phase==='succeeded',null,{timeout:10000});
  assert(await page.locator('#assistantChat').isHidden(),'Standalone status refresh reopened chat');assert.equal(starts,1,'Standalone graph refresh sent another request');
  await page.locator('#assistantAvatar').click();
  await ready(page);await page.waitForFunction(()=>document.querySelector('#tracePhase').dataset.phase==='succeeded');
  assert.equal(await page.locator('#mapViewport .trace-edge.is-active').count(),0);
  const colors=await page.locator('#mapViewport .trace-edge-line').evaluateAll(edges=>[...new Set(edges.map(edge=>edge.getAttribute('stroke')))]);assert(colors.length>=3,'Edge kinds share one color');
  await page.waitForFunction(()=>document.querySelector('#brainLoader').classList.contains('hidden'));
  const source=page.locator('#mapViewport [data-document-id="'+doc.id+'"]');
  await source.press('Enter');await page.waitForFunction(()=>document.querySelector('#traceContent').textContent.includes('42000'));await page.locator('#traceClose').click();
  assert(await source.evaluate(e=>e.classList.contains('is-selected')));
  const initial=await source.boundingBox();await tools(page);await page.locator('#traceZoomSelected').click();const enlarged=await source.boundingBox();assert(enlarged.width>initial.width*1.2,'Zoom selected did not enlarge node');
  const canvas=await page.locator('.brain-canvas').boundingBox();assert(enlarged.x>=canvas.x-2&&enlarged.x+enlarged.width<=canvas.x+canvas.width+2,'Selected node clipped');
  await tools(page);await page.locator('#traceFitAll').click();assert.equal(await page.locator('#traceFocus').getAttribute('aria-pressed'),'false');
  await tools(page);await page.locator('#traceSearch').press('Escape');assert(await page.locator('#traceTools').isHidden());assert(await page.locator('#assistantChat').isVisible(),'Escape in graph tools closed the workspace');
  // A real pointer/touch hit on the curve opens its snapshot, rather than dragging the canvas.
  const hit=page.locator('#mapViewport [data-trace-edge="source"]').filter({has:page.locator('title')}).first().locator('.trace-edge-hit');
  const point=await hit.evaluate(e=>{const p=e.getPointAtLength(e.getTotalLength()*.5),m=e.getScreenCTM();return {x:m.a*p.x+m.c*p.y+m.e,y:m.b*p.x+m.d*p.y+m.f};});
  if(width<=700)await page.touchscreen.tap(point.x,point.y);else await page.mouse.click(point.x,point.y);
  await page.waitForFunction(()=>document.querySelector('#traceTitle').textContent==='Материал → запрос');assert((await page.locator('#traceMeta').innerText()).includes('версия 1'));assert((await page.locator('#traceContent').innerText()).includes('25 ноября'));await page.locator('#traceClose').click();
  await edgeCard(page,'request','42000');
  // Snapshot survives later edits of the original material.
  await page.request.post(site+'api/knowledge',{data:{...doc,body:'Теперь срок 30 ноября.'}});
  await edgeCard(page,'source','25 ноября');
  await tools(page);await page.locator('#traceSearch').fill('test/model-one');await page.locator('#traceSearch').press('Enter');assert(await page.locator('#mapViewport [data-trace-node="model"]').evaluate(e=>e.classList.contains('is-selected')));
  await tools(page);await page.locator('#traceClear').click();assert.equal(await page.locator('#mapViewport .is-selected').count(),0);
  await page.locator('#chatInput').fill('А стоимость проекта Сосна'+width+'?');await page.locator('#chatSend').click();await ready(page);await page.waitForFunction(()=>document.querySelector('#traceTurn').options.length===2&&document.querySelector('#tracePhase').dataset.phase==='succeeded');
  if(width>1000){await edgeCard(page,'history','Предыдущий ответ');const all=await page.locator('#mapViewport .trace-edge-line').evaluateAll(edges=>new Set(edges.map(edge=>edge.getAttribute('stroke'))).size);assert.equal(all,4);}
  await page.locator('#mapViewport [data-document-id="'+doc.id+'"]').press('Enter');await page.waitForFunction(()=>document.querySelector('#traceModal').classList.contains('hidden')===false);await page.locator('#traceClose').click();
  await tools(page);await page.locator('#traceFocus').click();assert.equal(await page.locator('#traceFocus').getAttribute('aria-pressed'),'true');
  if(width>1000)assert(await page.locator('#mapViewport [data-trace-node="history"]').evaluate(e=>e.classList.contains('is-dimmed')));
  assert.equal(starts,2,'Graph controls or edge cards generated another model request');
  await page.screenshot({path:path.join(output,'graph-tools-'+width+'.png')});
  await tools(page);await page.locator('#traceFitAll').click();
  // Failed state comes from the actual saved error, without an automatic resend.
  await page.request.post(site+'api/cloud/settings',{data:{api_key:'test-key-ui-down',model:'test/model-one'}});await page.locator('#chatRefresh').click();await ready(page);
  await page.locator('#chatInput').fill('Проверка ошибки подключения');await page.locator('#chatSend').click();await ready(page);await page.waitForFunction(()=>document.querySelector('#tracePhase').dataset.phase==='failed');
  assert(await page.locator('#mapViewport [data-trace-node="answer"]').evaluate(e=>e.classList.contains('is-state-failed')));assert.equal(starts,3);
  await page.locator('#chatClose').click();await context.close();
 }
 assert.deepEqual(errors,[]);console.log('✓ Graph colors/legend, node+edge selection, focus/dimming, fit/zoom/search, versioned edge cards via touch/mouse/keyboard, pending/success/error, no duplicate generations, 4 widths');
}catch(error){console.error(error);console.error(stderr.slice(-2400));process.exitCode=1;}finally{if(browser)await browser.close();server.kill();await new Promise(resolve=>server.once('close',resolve));fs.rmSync(temporary,{recursive:true,force:true});}})();
