/* Movable assistant + persistent Cloud.ru chat. No generated HTML or executable output. */
(function(){
  'use strict';
  var $=function(id){return document.getElementById(id);};
  var avatar=$('assistantAvatar'),panel=$('assistantChat'),position={x:1,y:1},moved=false,drag=null,suppressClick=false;
  var state={sessions:[],session_id:null,turns:[],active:null},settings={},busy=false,posting=false,opened=false,timer=null,generation=0;
  var pending=null,drafts={},positionQueue=Promise.resolve(),positionVersion=0;
  var graphMode=false,graphPreference=null,graphRequest=0,graphSignature='',traceNode=null,traceFocus=null;
  var standaloneTimer=null,standaloneTicket=0,lastGraph=null;
  try{graphPreference=localStorage.getItem('tracktor-chat-graph');}catch(ignored){}
  try{pending=JSON.parse(sessionStorage.getItem('tracktor-chat-pending')||'null');}catch(ignored){}
  if(pending&&(!pending.request_id||!pending.session_id||typeof pending.task!=='string'))pending=null;
  function savePending(value){pending=value;try{if(value)sessionStorage.setItem('tracktor-chat-pending',JSON.stringify(value));else sessionStorage.removeItem('tracktor-chat-pending');}catch(ignored){}}
  async function api(path,data){
    var options={cache:'no-store',signal:AbortSignal.timeout(15000)};
    if(data!==undefined){options.method='POST';options.headers={'Content-Type':'application/json'};options.body=JSON.stringify(data);}
    try{
      var response=await fetch('/api/'+path,options),value=await response.json();
      if(!response.ok){var error=new Error(value.error||'Не удалось выполнить запрос');error.status=response.status;throw error;}
      return value;
    }catch(error){
      if(!error.status)throw new Error('Локальный сервер не отвечает. Оставьте BAT открытым и обновите состояние чата. Запрос автоматически не отправляется повторно.');
      throw error;
    }
  }
  function status(text,error){$('chatStatus').textContent=text;$('chatStatus').classList.toggle('assistant-error',Boolean(error));}
  function bounds(){return {x:Math.max(0,window.innerWidth-avatar.offsetWidth-16),y:Math.max(0,window.innerHeight-avatar.offsetHeight-16)};}
  function place(){
    // Viewport-relative CSS keeps the avatar on screen even before a resize
    // event reaches JavaScript (including display/orientation changes).
    avatar.style.left='calc(8px + max(0px, 100vw - 80px) * '+position.x+')';
    avatar.style.top='calc(8px + max(0px, 100dvh - 80px) * '+position.y+')';
  }
  function rememberPosition(){
    var value={x:position.x,y:position.y};moved=true;var revision=++positionVersion;
    try{localStorage.setItem('tracktor-avatar-position',JSON.stringify(value));}catch(ignored){}
    // Serialize writes so a slow older request cannot overwrite a later drag.
    positionQueue=positionQueue.catch(function(){}).then(function(){return api('assistant-position',value);}).catch(function(){if(revision===positionVersion)avatar.title='AI-помощник · положение сохранено в браузере; база сейчас недоступна';});
  }
  function readPosition(value){if(value&&Number.isFinite(value.x)&&Number.isFinite(value.y)){position={x:Math.min(1,Math.max(0,value.x)),y:Math.min(1,Math.max(0,value.y))};place();}}
  try{readPosition(JSON.parse(localStorage.getItem('tracktor-avatar-position')||'null'));}catch(ignored){}
  place();api('assistant-position').then(function(value){if(!moved)readPosition(value);}).catch(function(){});
  avatar.addEventListener('pointerdown',function(event){
    if(event.button!==0||!event.isPrimary)return;
    var box=avatar.getBoundingClientRect();drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:box.left,top:box.top,moving:false};
    suppressClick=false;avatar.setPointerCapture(event.pointerId);
  });
  avatar.addEventListener('pointermove',function(event){
    if(!drag||drag.id!==event.pointerId)return;
    var dx=event.clientX-drag.x,dy=event.clientY-drag.y;
    if(!drag.moving&&Math.hypot(dx,dy)<6)return;
    drag.moving=true;avatar.classList.add('is-dragging');
    var b=bounds();position={x:b.x?Math.max(0,Math.min(1,(drag.left+dx-8)/b.x)):0,y:b.y?Math.max(0,Math.min(1,(drag.top+dy-8)/b.y)):0};place();
  });
  function stopDrag(event){
    if(!drag||event.pointerId!==drag.id)return;
    suppressClick=drag.moving;if(drag.moving)rememberPosition();drag=null;avatar.classList.remove('is-dragging');
    if(avatar.hasPointerCapture(event.pointerId))avatar.releasePointerCapture(event.pointerId);
  }
  avatar.addEventListener('pointerup',stopDrag);avatar.addEventListener('pointercancel',stopDrag);avatar.addEventListener('lostpointercapture',stopDrag);
  avatar.addEventListener('click',function(event){if(suppressClick&&event.detail!==0){suppressClick=false;return;}if(opened)close();else open();});
  avatar.addEventListener('keydown',function(event){
    var directions={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
    if(event.key==='Home'){event.preventDefault();position={x:1,y:1};place();rememberPosition();}
    else if(directions[event.key]){event.preventDefault();var b=bounds(),step=event.shiftKey?64:16,d=directions[event.key];position.x=b.x?Math.max(0,Math.min(1,position.x+d[0]*step/b.x)):0;position.y=b.y?Math.max(0,Math.min(1,position.y+d[1]*step/b.y)):0;place();rememberPosition();}
    event.stopPropagation();
  });
  function mobileState(){var modal=opened&&!graphMode&&window.matchMedia('(max-width: 700px)').matches;panel.setAttribute('aria-modal',String(modal));document.querySelector('.app').inert=modal;avatar.hidden=modal||opened&&graphMode;document.body.classList.toggle('graph-chat-open',opened&&graphMode);$('chatGraphToggle').setAttribute('aria-pressed',String(graphMode));}
  window.addEventListener('resize',function(){place();mobileState();});
  if(window.visualViewport)window.visualViewport.addEventListener('resize',function(){panel.style.setProperty('--chat-height',window.visualViewport.height+'px');panel.style.setProperty('--chat-top',window.visualViewport.offsetTop+'px');});
  function controls(){
    var active=Boolean(state.active),locked=busy||posting||active||Boolean(pending);
    $('chatInput').disabled=locked;$('chatKnowledge').disabled=locked;
    $('chatSend').disabled=busy||posting||active||!settings.has_key||!settings.model||!state.session_id||(!pending&&!$('chatInput').value.trim());
    $('chatSend').textContent=pending?'Проверить отправку':active?'Отвечаю…':'Отправить ↑';
    $('chatNew').disabled=busy||posting||Boolean(pending);$('chatSession').disabled=busy||posting||Boolean(pending);
    $('chatSettings').disabled=busy||posting||Boolean(pending);$('chatRefresh').disabled=busy||posting;
    $('chatMaterials').disabled=busy||posting;
    avatar.classList.toggle('is-thinking',active);avatar.setAttribute('aria-busy',String(active));
  }
  function preferGraph(value){graphPreference=value?'on':'off';try{localStorage.setItem('tracktor-chat-graph',graphPreference);}catch(ignored){}}
  async function syncTrace(force,turnId){
    if(!opened)return;
    var latest=state.turns[state.turns.length-1];
    if(!graphMode){
      if(graphPreference==='off'||!(graphPreference==='on'||latest&&latest.sources&&latest.sources.length))return;
      graphMode=true;mobileState();
    }
    var signature=state.session_id+':'+(latest?latest.id+':'+latest.status+':'+(latest.context_turns===null?'preparing':'context-ready'):'empty');
    if(!force&&signature===graphSignature)return;
    graphSignature=signature;var ticket=++graphRequest,sessionId=state.session_id;
    try{
      var graph=await api('chat/graph'+(sessionId?'?session_id='+encodeURIComponent(sessionId):'')+(turnId?'&turn_id='+encodeURIComponent(turnId):''));
      if(ticket!==graphRequest||!opened||!graphMode||sessionId!==state.session_id)return;
      var select=$('traceTurn');select.textContent='';
      if(!graph.turns.length)select.add(new Option('Задайте вопрос в чате',''));
      graph.turns.forEach(function(turn){select.add(new Option(turn.title,turn.id));});
      if(graph.current_turn&&!graph.turns.some(function(turn){return turn.id===graph.current_turn;}))select.add(new Option('Предыдущий обмен из истории',graph.current_turn));
      select.value=graph.current_turn||'';
      $('chatGraphStatus').textContent=graph.current_turn?'Источники: '+graph.documents+' · нажмите узел для деталей':'Путь появится после первого запроса';
      window.TracktorBrain.showTrace(graph,!force);
      lastGraph=graph;
      $('traceKnowledge').textContent='Все знания';
    }catch(error){if(ticket===graphRequest&&opened){graphSignature='';$('chatGraphStatus').textContent=error.message;}}
  }
  function selectTrace(id){if(!opened){openTrace(id);return;}preferGraph(true);graphMode=true;mobileState();syncTrace(true,id);}
  async function openTrace(id){if(!opened)await open();if(!opened)return;preferGraph(true);graphMode=true;mobileState();syncTrace(true,id);}
  function closeTraceNode(){traceNode=null;$('traceModal').classList.add('hidden');if(traceFocus&&traceFocus.isConnected)traceFocus.focus();else if(opened)$('chatClose').focus();}
  async function inspectNode(node){
    traceNode=node;traceFocus=document.activeElement;$('traceModal').classList.remove('hidden');$('traceTitle').textContent='Читаю данные узла…';$('traceContent').textContent='';$('traceMeta').textContent='';$('traceOpenMaterial').hidden=true;$('traceOpenHistory').hidden=true;$('traceClose').focus();
    try{
      if(node.type==='document'){
        $('traceTitle').textContent=node.title;$('traceMeta').textContent='Фрагмент базы знаний · версия '+node.revision+' · снимок на момент запроса';$('traceContent').textContent=node.excerpt;$('traceOpenMaterial').hidden=false;return;
      }
      var turn=await api('chat/turns/'+encodeURIComponent(node.turn_id));if(traceNode!==node)return;
      var statuses={running:'Выполняется',succeeded:'Ответ получен',partial:'Частичный ответ',failed:'Ошибка',interrupted:'Прервано'},phase=statuses[turn.status]||turn.status;
      $('traceMeta').textContent='Модель: '+turn.model+' · '+new Date(turn.created_at).toLocaleString('ru-RU')+' · '+phase;
      if(node.type==='query'){$('traceTitle').textContent='Что было запрошено';$('traceContent').textContent=turn.task+'\n\nМатериалы: '+(turn.sources||[]).map(function(source){return source.title+' (v'+source.revision+')';}).join(', ')+'\nОбменов из истории: '+(turn.context_turns?turn.context_turns.length:'состав не сохранён для этого запроса');}
      else if(node.type==='history'){$('traceTitle').textContent='Обмен, включённый в контекст';$('traceContent').textContent='Вопрос:\n'+turn.task+'\n\nОтвет:\n'+turn.result;node.history_turn_id=turn.id;$('traceOpenHistory').hidden=false;}
      else if(node.type==='model'){$('traceTitle').textContent='Куда направлен запрос';$('traceContent').textContent='Cloud.ru Foundation Models\nМодель: '+turn.model+'\nСтатус: '+phase+'\n\nПередаваемые данные: вопрос, системная инструкция, выбранная история и найденные фрагменты материалов.\n\n'+(turn.error||'')+(turn.usage&&turn.usage.total_tokens?'\nТокенов: '+turn.usage.total_tokens:'')+(turn.status==='failed'||turn.status==='interrupted'?'\n\nОбработка запроса облаком может быть не подтверждена.':'')+'\n\nПросмотр графа не отправляет запрос модели.';}
      else{$('traceTitle').textContent='Что получено';$('traceContent').textContent=turn.result||turn.error||'Ответ ещё не получен.';}
    }catch(error){if(traceNode===node){$('traceTitle').textContent='Данные недоступны';$('traceContent').textContent=error.message;}}
  }
  async function inspectEdge(edge,graph){
    var source=graph.nodes.find(function(node){return node.id===edge.source;}),target=graph.nodes.find(function(node){return node.id===edge.target;}),entry={type:'edge',edge:edge,turn_id:graph.current_turn};
    traceNode=entry;traceFocus=document.activeElement;$('traceModal').classList.remove('hidden');$('traceTitle').textContent='Карточка связи';$('traceMeta').textContent=edge.label;$('traceContent').textContent='Читаю сохранённые данные…';$('traceOpenMaterial').hidden=true;$('traceOpenHistory').hidden=true;$('traceClose').focus();
    try{
      if(edge.kind==='source'){
        entry.id=source.id;$('traceTitle').textContent='Материал → запрос';$('traceMeta').textContent=source.title+' · версия '+source.revision+' · '+new Date(source.updated_at).toLocaleString('ru-RU');
        $('traceContent').textContent='Сохранённый фрагмент:\n'+source.excerpt;$('traceOpenMaterial').hidden=false;
        var current=await api('chat/turns/'+encodeURIComponent(graph.current_turn));if(traceNode!==entry)return;$('traceContent').textContent+='\n\nДля вопроса:\n'+current.task;return;
      }
      if(edge.kind==='history'){
        var exchanges=await Promise.all([api('chat/turns/'+encodeURIComponent(source.turn_id)),api('chat/turns/'+encodeURIComponent(graph.current_turn))]);if(traceNode!==entry)return;var previous=exchanges[0];
        entry.history_turn_id=previous.id;$('traceTitle').textContent='История → новый запрос';$('traceContent').textContent='Предыдущий вопрос:\n'+previous.task+'\n\nПредыдущий ответ:\n'+previous.result+'\n\nВключено в контекст вопроса:\n'+exchanges[1].task;$('traceOpenHistory').hidden=false;return;
      }
      var turn=await api('chat/turns/'+encodeURIComponent(graph.current_turn));if(traceNode!==entry)return;
      if(edge.kind==='request'){
        $('traceTitle').textContent='Запрос → '+turn.model;$('traceMeta').textContent='Сохранённые вопрос и контекст';
        var blocks=['Вопрос:\n'+turn.task];(turn.sources||[]).forEach(function(doc,index){blocks.push('Материал ['+(index+1)+'] '+doc.title+' · версия '+doc.revision+'\n'+doc.excerpt);});
        var history=await Promise.all((turn.context_turns||[]).map(function(id){return api('chat/turns/'+encodeURIComponent(id));}));if(traceNode!==entry)return;
        history.forEach(function(item,index){blocks.push('История ['+(index+1)+']\nВопрос: '+item.task+'\nОтвет: '+item.result);});
        if(turn.context_turns===null)blocks.push('Состав истории для этого старого запроса не сохранён.');$('traceContent').textContent=blocks.join('\n\n');
      }else{$('traceTitle').textContent=turn.model+' → результат';$('traceMeta').textContent='Сохранённый ответ или ошибка';$('traceContent').textContent=turn.result||turn.error||'Ответ ещё ожидается.';}
    }catch(error){if(traceNode===entry)$('traceContent').textContent=error.message;}
  }
  function article(role,text,detail){
    var item=document.createElement('article');item.className='assistant-message '+role;
    var label=document.createElement('strong');label.textContent=role==='user'?'Вы':'TRACKTOR';item.appendChild(label);
    var content=document.createElement('div');content.className='assistant-message-text';content.textContent=text;item.appendChild(content);
    if(detail){var note=document.createElement('small');note.textContent=detail;item.appendChild(note);}
    if(role==='assistant'&&text){var copy=document.createElement('button');copy.type='button';copy.className='assistant-copy';copy.textContent='Копировать';copy.addEventListener('click',async function(){try{await navigator.clipboard.writeText(text);status('Ответ скопирован.');}catch(ignored){status('Выделите текст ответа и скопируйте вручную.',true);}});item.appendChild(copy);}
    return item;
  }
  function render(){
    var select=$('chatSession');select.textContent='';
    state.sessions.forEach(function(session){select.add(new Option(session.title,session.id));});select.value=state.session_id||'';
    $('chatModel').textContent=settings.has_key&&settings.model?settings.model:'Подключите модель Cloud.ru';
    var list=$('chatMessages'),nearBottom=list.scrollHeight-list.scrollTop-list.clientHeight<90,scroll=list.scrollTop;
    list.textContent='';
    if(!state.turns.length){var empty=document.createElement('div');empty.className='assistant-empty';empty.innerHTML='<span aria-hidden="true">✦</span><h3>С чего начнём?</h3><p>Разберём задачу, составим план или подготовим текст.</p>';
      ['Составить план проекта','Помочь с текстом','Разобрать мою задачу'].forEach(function(text){var button=document.createElement('button');button.type='button';button.textContent=text;button.disabled=Boolean(state.active)||Boolean(pending);button.addEventListener('click',function(){$('chatInput').value=text+': ';controls();$('chatInput').focus();});empty.appendChild(button);});list.appendChild(empty);
    }
    state.turns.forEach(function(turn){
      list.appendChild(article('user',turn.task));
      var label=turn.model,error=turn.error||'';
      if(turn.status==='running')list.appendChild(article('assistant','Думаю над ответом…',label+' · Можно закрыть чат, запрос продолжится.'));
      else if(turn.result){
        var reply=article('assistant',turn.result,label+(error?' · '+error:''));
        if(turn.sources&&turn.sources.length){
          var details=document.createElement('details');details.className='assistant-sources';
          var summary=document.createElement('summary');summary.textContent='Материалы, переданные модели: '+turn.sources.length;details.appendChild(summary);
          turn.sources.forEach(function(source,index){
            var button=document.createElement('button');button.type='button';button.textContent='['+(index+1)+'] '+source.title+' ↗';
            button.title='Показать материал и связанные метки на карте';
            button.addEventListener('click',function(){selectTrace(turn.id);});details.appendChild(button);
            var excerpt=document.createElement('p');excerpt.textContent=source.excerpt;details.appendChild(excerpt);
          });
          var map=document.createElement('button');map.type='button';map.textContent='Все источники на карте';map.addEventListener('click',function(){selectTrace(turn.id);});details.appendChild(map);
          var note=document.createElement('small');note.textContent='Фрагменты сохранены на момент запроса. Связи на карте основаны на общих метках.';details.appendChild(note);reply.appendChild(details);
        }else if(turn.include_knowledge){var missing=document.createElement('small');missing.textContent='Поиск по базе не нашёл подходящих материалов.';reply.appendChild(missing);}
        list.appendChild(reply);
      }
      else list.appendChild(article('assistant','Ответ не получен.',label+' · '+error));
    });
    if(pending&&!state.turns.some(function(turn){return turn.id===pending.request_id;}))list.appendChild(article('user',pending.task,'Проверяем, принял ли сервер сообщение.'));
    if(nearBottom)list.scrollTop=list.scrollHeight;else list.scrollTop=scroll;
    controls();
  }
  function schedule(){clearTimeout(timer);if(opened&&state.active)timer=setTimeout(function(){refresh(false);},1300);}
  async function refresh(loadSettings){
    var token=generation;
    try{
      var values=await Promise.all([api('chat'+(state.session_id?'?session_id='+encodeURIComponent(state.session_id):'')),loadSettings?api('cloud/settings'):Promise.resolve(settings)]);
      if(token!==generation||!opened)return;
      state=values[0];settings=values[1];
      if(pending){
        try{var turn=await api('chat/turns/'+pending.request_id);if(token!==generation||!opened)return;if(turn){savePending(null);$('chatInput').value='';drafts[state.session_id]='';state=await api('chat?session_id='+encodeURIComponent(state.session_id));}}
        catch(error){if(error.status!==404)throw error;}
      }
      if(token!==generation||!opened)return;
      render();
      syncTrace(false);
      var latest=state.turns[state.turns.length-1];
      if(pending)status('Отправка не подтверждена. Нажмите «Проверить отправку»: тот же идентификатор защищает от повторного запроса.',true);
      else if(state.active)status(state.active.session_id===state.session_id?'Модель отвечает. Оставьте окно BAT открытым.':'Модель отвечает в другом диалоге. Дождитесь завершения.');
      else if(latest&&(latest.status==='failed'||latest.status==='interrupted'||latest.status==='partial'))status(latest.error,true);
      else status(settings.has_key&&settings.model?'Enter — отправить · Shift+Enter — новая строка':'Сохраните ключ и выберите модель кнопкой «Настроить».');
      schedule();
    }catch(error){if(token===generation&&opened){status(error.message,true);if(state.active)schedule();}}
  }
  async function open(){
    if(opened)return;clearTimeout(standaloneTimer);standaloneTicket++;opened=true;var token=++generation;panel.classList.remove('hidden');avatar.setAttribute('aria-expanded','true');mobileState();$('chatClose').focus();busy=true;controls();status('Открываю локальную историю…');
    try{
      var loaded=await Promise.all([api('cloud/settings'),api('chat')]);if(token!==generation)return;
      settings=loaded[0];state=loaded[1];
      var recoveredDraft='';
      if(pending){
        try{var recovered=await api('chat?session_id='+encodeURIComponent(pending.session_id));if(token!==generation)return;state=recovered;}
        catch(error){if(token!==generation)return;if(error.status===400||error.status===404){recoveredDraft=pending.task;savePending(null);}else throw error;}
      }
      if(!state.session_id){var created=await api('chat/sessions',{session_id:crypto.randomUUID(),create:true});if(token!==generation)return;state=created;}
      $('chatInput').value=recoveredDraft||drafts[state.session_id]||'';render();await refresh(false);
      if(recoveredDraft&&token===generation)status('Прежнее сообщение отсутствует в этой базе. Его текст восстановлен в поле ввода; автоматической отправки нет.',true);
    }catch(error){if(token===generation)status(error.message,true);}finally{if(token===generation){busy=false;controls();}}
  }
  function close(){
    if(!opened)return;if(state.session_id&&!pending)drafts[state.session_id]=$('chatInput').value;
    opened=false;generation++;clearTimeout(timer);panel.classList.add('hidden');avatar.setAttribute('aria-expanded','false');mobileState();avatar.focus();
    graphRequest++;graphMode=false;graphSignature='';mobileState();
    watchStandaloneGraph();
  }
  function watchStandaloneGraph(){
    clearTimeout(standaloneTimer);
    if(opened||!lastGraph||!['preparing','waiting'].includes(lastGraph.phase)||!window.TracktorBrain.isTrace()||$('brainPage').hidden)return;
    var ticket=standaloneTicket;
    standaloneTimer=setTimeout(async function(){
      if(opened||ticket!==standaloneTicket||!window.TracktorBrain.isTrace()||$('brainPage').hidden)return;
      try{var graph=await api('chat/graph?session_id='+encodeURIComponent(lastGraph.session_id)+'&turn_id='+encodeURIComponent(lastGraph.current_turn));if(opened||ticket!==standaloneTicket||!window.TracktorBrain.isTrace()||$('brainPage').hidden)return;lastGraph=graph;window.TracktorBrain.showTrace(graph,true);}
      catch(error){if(!opened&&ticket===standaloneTicket)$('chatGraphStatus').textContent=error.message;}
      watchStandaloneGraph();
    },1300);
  }
  $('chatClose').addEventListener('click',close);
  $('chatInput').addEventListener('input',controls);
  $('chatInput').addEventListener('keydown',function(event){if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();if(!$('chatSend').disabled)$('chatForm').requestSubmit();}});
  $('chatSettings').addEventListener('click',function(){close();window.TracktorCloudSettings.open();});
  $('chatMaterials').addEventListener('click',function(){close();window.TracktorKnowledge.open();});
  $('chatGraphToggle').addEventListener('click',function(){if(graphMode){preferGraph(false);graphMode=false;graphRequest++;graphSignature='';mobileState();$('chatGraphStatus').textContent='Материалы → запрос → модель → ответ';}else openTrace();});
  $('traceMode').addEventListener('click',function(){openTrace();});
  $('traceTurn').addEventListener('change',function(){if(this.value)selectTrace(this.value);});
  $('traceKnowledge').addEventListener('click',function(){if(this.textContent==='Путь запроса'){syncTrace(true,$('traceTurn').value);return;}graphRequest++;window.TracktorKnowledge.showSources([]);this.textContent='Путь запроса';$('chatGraphStatus').textContent='Карта материалов · вернитесь кнопкой «Путь запроса»';});
  $('traceClose').addEventListener('click',closeTraceNode);
  $('traceOpenMaterial').addEventListener('click',function(){var id=traceNode&&traceNode.id;closeTraceNode();if(id)window.TracktorKnowledge.open(id);});
  $('traceOpenHistory').addEventListener('click',function(){var id=traceNode&&traceNode.history_turn_id;closeTraceNode();if(id)selectTrace(id);});
  $('traceModal').addEventListener('click',function(event){if(event.target===this)closeTraceNode();});
  $('traceModal').addEventListener('keydown',function(event){event.stopPropagation();if(event.key==='Tab'){var items=Array.from($('traceDialog').querySelectorAll('button:not([hidden])')),first=items[0],last=items[items.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}});
  $('chatRefresh').addEventListener('click',async function(){if(busy)return;busy=true;controls();await refresh(true);busy=false;controls();});
  async function switchSession(create){
    if(busy||posting||pending)return;busy=true;var token=++generation;clearTimeout(timer);controls();
    if(state.session_id)drafts[state.session_id]=$('chatInput').value;
    try{var switched=await api('chat/sessions',{session_id:create?crypto.randomUUID():$('chatSession').value,create:create});if(token!==generation)return;state=switched;$('chatInput').value=drafts[state.session_id]||'';render();await refresh(true);}
    catch(error){if(token===generation)status(error.message,true);}finally{if(token===generation){busy=false;controls();}}
  }
  $('chatNew').addEventListener('click',function(){switchSession(true);});$('chatSession').addEventListener('change',function(){switchSession(false);});
  $('chatForm').addEventListener('submit',async function(event){
    event.preventDefault();if(busy||posting||state.active||!state.session_id)return;
    var task=$('chatInput').value.trim();if(!pending&&!task)return;
    if(!pending)savePending({request_id:crypto.randomUUID(),session_id:state.session_id,task:task,include_knowledge:$('chatKnowledge').checked,expected_model:settings.model});
    var payload=pending,token=generation;posting=true;controls();status('Передаю сообщение…');
    try{
      await api('chat/turns',payload);savePending(null);drafts[payload.session_id]='';if(token===generation)$('chatInput').value='';if(opened)await refresh(false);
    }catch(error){
      if(error.status){savePending(null);drafts[payload.session_id]=payload.task;if(token===generation){$('chatInput').value=payload.task;status(error.message,true);}}
      else if(opened){status(error.message,true);await refresh(false);}
    }finally{posting=false;controls();}
  });
  panel.addEventListener('keydown',function(event){
    event.stopPropagation();
    if(event.key==='Tab'&&panel.getAttribute('aria-modal')==='true'){
      var items=Array.from(panel.querySelectorAll('button:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]')),first=items[0],last=items[items.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    }
  });
  document.addEventListener('keydown',function(event){if(event.key!=='Escape')return;if(traceNode){event.preventDefault();event.stopImmediatePropagation();closeTraceNode();}else if(!$('traceTools').hidden){event.preventDefault();event.stopImmediatePropagation();window.TracktorBrain.closeTraceTools();}else if(opened){event.preventDefault();event.stopImmediatePropagation();close();}},true);
  window.TracktorAssistant={openTrace:openTrace,selectTrace:selectTrace,inspectNode:inspectNode,inspectEdge:inspectEdge};
})();
