/* Personal knowledge materials and their real tag connections. */
(function(){
  'use strict';
  var $=function(id){return document.getElementById(id);},documentId=null,revision=0,busy=false,previousFocus=null,view=0;
  async function api(path,data){
    var options={cache:'no-store',signal:AbortSignal.timeout(15000)};
    if(data!==undefined){options.method='POST';options.headers={'Content-Type':'application/json'};options.body=JSON.stringify(data);}
    try{var response=await fetch('/api/knowledge'+path,options),value=await response.json();if(!response.ok)throw new Error(value.error||'Ошибка базы знаний');return value;}
    catch(error){throw new Error(error.name==='TypeError'||error.name==='TimeoutError'?'База недоступна. Оставьте BAT открытым и проверьте носитель с данными.':error.message);}
  }
  function feedback(text,error){$('knowledgeFeedback').textContent=text;$('knowledgeFeedback').classList.toggle('cloud-error',Boolean(error));}
  function controls(value){busy=value;['knowledgeName','knowledgeTags','knowledgeBody','knowledgeSave','knowledgeNew'].forEach(function(id){$(id).disabled=value;});$('knowledgeShowMap').disabled=value||!revision;$('knowledgeDialog').setAttribute('aria-busy',String(value));}
  function blank(){documentId=crypto.randomUUID();revision=0;$('knowledgeForm').reset();feedback('Заполните название, текст и метки. Сохранение не обращается к Cloud.ru.');controls(false);}
  async function library(){
    var result=await api(''),list=$('knowledgeList');list.textContent='';
    if(!result.documents.length){var empty=document.createElement('p');empty.className='dialog-note';empty.textContent='Материалов пока нет.';list.appendChild(empty);}
    result.documents.forEach(function(doc){var button=document.createElement('button');button.type='button';button.textContent=doc.title;button.className=doc.id===documentId?'active':'';button.addEventListener('click',function(){if(!busy)load(doc.id);});list.appendChild(button);});
  }
  async function load(id){
    var token=++view;controls(true);feedback('Читаю материал…');
    try{var doc=await api('/document/'+encodeURIComponent(id));if(token!==view)return;documentId=doc.id;revision=doc.revision;$('knowledgeName').value=doc.title;$('knowledgeTags').value=doc.tags.join(', ');$('knowledgeBody').value=doc.body;await library();feedback('Версия '+doc.revision+' · '+new Date(doc.updated_at).toLocaleString('ru-RU'));}
    catch(error){if(token===view)feedback(error.message,true);}finally{if(token===view)controls(false);}
  }
  async function open(id){
    previousFocus=document.activeElement;$('knowledgeModal').classList.remove('hidden');$('knowledgeClose').focus();blank();
    try{await library();if(id)await load(id);}catch(error){feedback(error.message,true);}
  }
  function close(){view++;$('knowledgeModal').classList.add('hidden');if(previousFocus&&previousFocus.isConnected)previousFocus.focus();}
  async function showSources(ids){
    try{var graph=await api('/graph');window.TracktorBrain.showKnowledge(graph,ids||[]);}
    catch(error){$('knowledgeMapStatus').textContent=error.message;$('knowledgeModal').classList.remove('hidden');feedback(error.message,true);$('knowledgeClose').focus();}
  }
  $('knowledgeForm').addEventListener('submit',async function(event){
    event.preventDefault();if(busy)return;controls(true);feedback('Сохраняю в локальную базу…');
    var data={id:documentId,revision:revision,title:$('knowledgeName').value,body:$('knowledgeBody').value,tags:$('knowledgeTags').value.split(',').map(function(tag){return tag.trim();}).filter(Boolean)};
    try{var doc=await api('',data);documentId=doc.id;revision=doc.revision;await library();window.TracktorBrain.updateKnowledge(await api('/graph'));feedback('Материал сохранён. Он доступен для поиска в чате и на карте.');}
    catch(error){feedback(error.message,true);}finally{controls(false);}
  });
  $('knowledgeNew').addEventListener('click',blank);$('knowledgeClose').addEventListener('click',close);
  $('knowledgeManage').addEventListener('click',function(){open();});$('knowledgeMode').addEventListener('click',function(){showSources([]);});
  $('knowledgeShowMap').addEventListener('click',function(){var id=documentId;close();showSources([id]);});
  $('knowledgeModal').addEventListener('click',function(event){if(event.target===this)close();});
  document.addEventListener('keydown',function(event){if(event.key==='Escape'&&!$('knowledgeModal').classList.contains('hidden')){event.preventDefault();event.stopImmediatePropagation();close();}},true);
  $('knowledgeModal').addEventListener('keydown',function(event){event.stopPropagation();if(event.key==='Tab'){var items=Array.from($('knowledgeDialog').querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled)')),first=items[0],last=items[items.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}});
  window.TracktorKnowledge={open:open,showSources:showSources};
  api('/graph').then(function(graph){if(window.TracktorBrain.isTrace())return;if(graph.documents)window.TracktorBrain.showKnowledge(graph,[],true);else window.TracktorBrain.updateKnowledge(graph);}).catch(function(){});
})();
