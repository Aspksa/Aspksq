/* Chat and actual request provenance stay visible together; no paid provider. */
const {chromium}=require('playwright'),{spawn}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'tracktor-trace-')),output=path.join(root,'artifacts','screenshots');fs.mkdirSync(output,{recursive:true});
const server=spawn(process.env.PYTHON||'python3',[path.join(__dirname,'cloud_ui_server.py'),'--port','0','--database',path.join(temporary,'data.sqlite3')],{stdio:['ignore','pipe','pipe']});let stderr='';server.stderr.on('data',chunk=>stderr+=chunk.toString());
async function ready(page){await page.waitForFunction(()=>!document.querySelector('#chatRefresh').disabled&&!document.querySelector('#chatInput').disabled);}
async function inspector(page,type,text){var node=page.locator('#mapViewport [data-trace-node="'+type+'"]');if(page.viewportSize().width<=700)await node.tap();else await node.click();await page.waitForFunction(text=>document.querySelector('#traceContent').textContent.includes(text),text);assert(await page.locator('#traceModal').isVisible());await page.locator('#traceClose').click();}
(async()=>{let browser;try{
 const site=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error(stderr)),15000);server.stdout.on('data',chunk=>{text+=chunk.toString();const match=text.match(/TRACKTOR: (http:\/\/[^\s]+)/);if(match){clearTimeout(timer);resolve(match[1]);}});server.once('error',reject);});
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});const errors=[];
 for(const width of [390,740,1024,1440]){
  const context=await browser.newContext({viewport:{width,height:900},hasTouch:true}),page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(site);await page.waitForFunction(()=>window.TracktorDB&&window.TracktorDB.isReady());
  const doc=(await (await page.request.post(site+'api/knowledge',{data:{id:crypto.randomUUID(),revision:0,title:'Проект Орион'+width,body:'Срок проекта Орион'+width+' — 25 ноября. Стоимость 42000 рублей. <script>alert(1)</script>',tags:['орион'+width]}})).json());
  await page.request.post(site+'api/cloud/settings',{data:{api_key:'test-key-ui-valid',model:'test/model-one'}});
  await page.locator('#assistantAvatar').click();await ready(page);await page.locator('#chatNew').click();await ready(page);
  let starts=0;page.on('request',request=>{if(request.url().endsWith('/api/chat/turns')&&request.method()==='POST')starts++;});
  const task='Расскажи о проекте Орион'+width;
  await page.locator('#chatInput').fill(task);await page.locator('#chatSend').click();await ready(page);
  await page.waitForFunction(()=>document.body.classList.contains('graph-chat-open')&&document.querySelector('#mapViewport [data-trace-node="answer"]')).catch(async error=>{console.error(await page.evaluate(()=>({graphStatus:document.querySelector('#chatGraphStatus').textContent,body:document.body.className,map:document.querySelector('#mapViewport').innerHTML.slice(0,350)})));throw error;});
  await page.waitForFunction(()=>document.querySelector('#brainLoader').classList.contains('hidden'));
  assert.equal(await page.locator('#assistantChat').getAttribute('aria-modal'),'false');assert.equal(await page.locator('.app').evaluate(e=>e.inert),false);
  const chart=await page.locator('.brain-canvas').boundingBox(),chat=await page.locator('#assistantChat').boundingBox();
  if(width<=1000)assert(chart.y+chart.height<=chat.y+1,'Graph and chat overlap vertically');else assert(chart.x+chart.width<=chat.x+1,'Graph and chat overlap horizontally');
  assert.equal(await page.locator('#mapViewport [data-trace-edge="request"]').count(),1);assert.equal(await page.locator('#mapViewport [data-trace-edge="response"]').count(),1);
  assert(await page.locator('#assistantChat').isVisible());
  await inspector(page,'query',task);await inspector(page,'model','test/model-one');await inspector(page,'answer','25 ноября');
  const source=page.locator('#mapViewport [data-document-id="'+doc.id+'"]');await source.click();await page.waitForFunction(()=>document.querySelector('#traceContent').textContent.includes('42000'));
  assert((await page.locator('#traceMeta').innerText()).includes('версия 1'));assert.equal(await page.locator('#traceDialog script').count(),0);await page.keyboard.press('Escape');
  assert(await page.locator('#assistantChat').isVisible(),'Closing inspector closed chat');assert.equal(starts,1,'Reading graph restarted a model request');
  const first=(await (await page.request.get(site+'api/chat')).json()).turns.at(-1).id;
  await page.locator('#chatInput').fill('А сроки проекта Орион'+width+'?');await page.locator('#chatSend').click();await ready(page);
  await page.waitForFunction(first=>document.querySelector('#traceTurn').options.length===2&&document.querySelector('#traceTurn').value!==first,first);
  const second=(await (await page.request.get(site+'api/chat')).json()).turns.at(-1).id;
  await page.locator('#traceTurn').selectOption(first);await page.waitForFunction(first=>document.querySelector('#mapViewport [data-trace-node="query"]').getAttribute('data-knowledge-id')==='query:'+first,first);
  assert(await page.locator('#assistantChat').isVisible());await page.locator('#traceTurn').selectOption(second);await page.waitForFunction(second=>document.querySelector('#mapViewport [data-trace-node="query"]').getAttribute('data-knowledge-id')==='query:'+second,second);
  const graph=(await (await page.request.get(site+'api/chat/graph')).json());assert(graph.edges.some(edge=>edge.kind==='history'));assert.equal(starts,2);
  await page.screenshot({path:path.join(output,'trace-workspace-'+width+'.png')});
  await page.locator('#chatClose').click();assert(!await page.locator('body').evaluate(e=>e.classList.contains('graph-chat-open')));assert(await page.locator('#assistantAvatar').isVisible());
  await page.reload();await page.locator('#assistantAvatar').click();await ready(page);await page.waitForFunction(()=>Boolean(document.querySelector('#mapViewport [data-trace-node="model"]')));assert.equal(starts,2,'Reload charged again');
  await page.locator('#chatGraphToggle').click();assert(!await page.locator('body').evaluate(e=>e.classList.contains('graph-chat-open')));
  if(width<=700)assert.equal(await page.locator('#assistantChat').getAttribute('aria-modal'),'true');
  await page.locator('#chatClose').click();await context.close();
 }
 assert.deepEqual(errors,[]);console.log('✓ Request graph: actual source/query/model/result/history, inspectors, desktop/mobile shared workspace, switching/reload, no duplicate calls, 4 widths');
}catch(error){console.error(error);console.error(stderr.slice(-2200));process.exitCode=1;}finally{if(browser)await browser.close();server.kill();await new Promise(resolve=>server.once('close',resolve));fs.rmSync(temporary,{recursive:true,force:true});}})();
