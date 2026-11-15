/* Personal knowledge -> Cloud.ru context -> cited material -> real map nodes. */
const {chromium}=require('playwright'),{spawn}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'tracktor-knowledge-'));
const server=spawn(process.env.PYTHON||'python3',[path.join(__dirname,'cloud_ui_server.py'),'--port','0','--database',path.join(temporary,'data.sqlite3')],{stdio:['ignore','pipe','pipe']});
let stderr='';server.stderr.on('data',chunk=>stderr+=chunk.toString());const output=path.join(root,'artifacts','screenshots');fs.mkdirSync(output,{recursive:true});
async function chatReady(page){await page.waitForFunction(()=>!document.querySelector('#chatRefresh').disabled&&!document.querySelector('#chatInput').disabled);}
(async()=>{
 let browser;
 try{
  const site=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('Server startup '+stderr)),15000);server.stdout.on('data',chunk=>{text+=chunk.toString();const match=text.match(/TRACKTOR: (http:\/\/[^\s]+)/);if(match){clearTimeout(timer);resolve(match[1]);}});server.once('error',reject);});
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});const errors=[];
  for(const width of [390,740,1024,1440]){
   const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
   await page.goto(site);await page.waitForFunction(()=>window.TracktorDB&&window.TracktorDB.isReady());
   await page.request.post(site+'api/cloud/settings',{data:{api_key:'test-key-ui-valid',model:'test/model-one'}});
   await page.locator('#assistantAvatar').click();await chatReady(page);
   assert.equal(await page.locator('#chatLimit').count(),0,'Manual output limit still shown');
   await page.locator('#chatMaterials').click();await page.waitForFunction(()=>!document.querySelector('#knowledgeSave').disabled);
   const title='Договор Кедр'+width,tag='кедр'+width;
   await page.locator('#knowledgeName').fill(title);
   await page.locator('#knowledgeTags').fill(tag+', договоры');
   await page.locator('#knowledgeBody').fill('Срок сдачи проекта Кедр'+width+' — 25 ноября. Стоимость — 42000 рублей. <script>alert(1)</script>');
   await page.locator('#knowledgeSave').click();await page.waitForFunction(()=>document.querySelector('#knowledgeFeedback').textContent.includes('Материал сохранён')&&!document.querySelector('#knowledgeSave').disabled);
   const docs=(await (await page.request.get(site+'api/knowledge')).json()).documents,doc=docs.find(doc=>doc.title===title);
   assert(doc,'Material was not stored');
   const related=(await (await page.request.post(site+'api/knowledge',{data:{id:crypto.randomUUID(),title:'Встречи Кедр'+width,body:'Встречи по пятницам в 10:00.',tags:[tag,'команда'],revision:0}})).json());
   await page.request.post(site+'api/knowledge',{data:{id:crypto.randomUUID(),title:'Созвездие '+width,body:'Вега находится в созвездии Лира.',tags:['звёзды'+width],revision:0}});
   await page.locator('#knowledgeShowMap').click();await page.waitForFunction(id=>Boolean(document.querySelector('[data-document-id="'+id+'"].is-source')),doc.id);
   assert((await page.locator('#knowledgeMapStatus').innerText()).includes('материалов'));
   assert(await page.locator('#knowledgeMode').evaluate(e=>e.classList.contains('active')));
   const graph=(await (await page.request.get(site+'api/knowledge/graph')).json());
   assert(graph.edges.some(edge=>edge.source===related.id&&edge.target==='tag:'+tag));
   for(const layout of ['rings','circle','hex','force']){await page.locator('[data-layout="'+layout+'"]').click();assert.equal(await page.locator('#mapViewport .knowledge-node[data-document-id]').count(),graph.documents);}
   await page.locator('[data-layout="rings"]').click();
   await page.waitForFunction(()=>document.querySelector('#brainLoader').classList.contains('hidden'));
   // Keyboard activation opens the actual document, including its saved text.
   await page.locator('#mapViewport [data-document-id="'+doc.id+'"]').press('Enter');
   await page.waitForFunction(()=>!document.querySelector('#knowledgeModal').classList.contains('hidden')&&!document.querySelector('#knowledgeSave').disabled&&document.querySelector('#knowledgeBody').value.includes('42000'));
   assert.equal(await page.locator('#knowledgeName').inputValue(),title);assert.equal(await page.locator('#knowledgeDialog script').count(),0);
   await page.locator('#knowledgeClose').click();
   await page.locator('#assistantAvatar').click();await chatReady(page);await page.locator('#chatNew').click();await chatReady(page);
   assert(await page.locator('#chatKnowledge').isChecked());
   let sent;page.on('request',request=>{if(request.url().endsWith('/api/chat/turns')&&request.method()==='POST')sent=request.postDataJSON();});
   await page.locator('#chatInput').fill('Какой срок сдачи проекта Кедр'+width+'?');await page.locator('#chatSend').click();
   await page.waitForFunction(()=>document.querySelector('#chatMessages').textContent.includes('25 ноября')&&!document.querySelector('#chatInput').disabled,null,{timeout:15000});
   assert.equal(sent.include_knowledge,true);assert(!('max_tokens' in sent));assert(!('max_completion_tokens' in sent));
   assert.equal(await page.locator('#chatMessages script').count(),0);
   const sources=page.locator('.assistant-sources').last();await sources.locator('summary').click();assert((await sources.innerText()).includes(title));
   await page.screenshot({path:path.join(output,'knowledge-chat-'+width+'.png')});
   await sources.getByRole('button',{name:'[1] '+title+' ↗',exact:true}).click();
   await page.waitForFunction(id=>Boolean(document.querySelector('[data-document-id="'+id+'"].is-source')),doc.id);
   await page.waitForFunction(()=>document.querySelector('#brainLoader').classList.contains('hidden'));
   await page.screenshot({path:path.join(output,'knowledge-map-'+width+'.png')});
   await page.reload();await page.waitForFunction(id=>Boolean(document.querySelector('[data-document-id="'+id+'"]')),doc.id);
   await page.locator('#assistantAvatar').click();await chatReady(page);assert((await page.locator('#chatMessages').innerText()).includes('25 ноября'));
   await page.locator('#chatKnowledge').uncheck();await page.locator('#chatInput').fill('Не используй базу знаний');await page.locator('#chatSend').click();
   await page.waitForFunction(()=>document.querySelectorAll('.assistant-message.assistant').length===2&&!document.querySelector('#chatInput').disabled,null,{timeout:15000});
   const snapshot=await (await page.request.get(site+'api/chat')).json();assert.equal(snapshot.turns.at(-1).sources.length,0);assert.equal(snapshot.turns.at(-1).include_knowledge,0);
   await page.locator('#chatClose').click();await context.close();
  }
  assert.deepEqual(errors,[]);console.log('✓ Knowledge editor/persistence, uncapped chat requests, retrieval/sources, real tag graph, source highlights, 4 layouts/widths, keyboard nodes, opt-out, safe text');
 }catch(error){console.error(error);console.error(stderr.slice(-2500));process.exitCode=1;}
 finally{if(browser)await browser.close();server.kill();await new Promise(resolve=>server.once('close',resolve));fs.rmSync(temporary,{recursive:true,force:true});}
})();
