/* Persistent skill jobs. Closing this dialog does not cancel a Cloud.ru request. */
(function(){
  'use strict';
  var $=function(id){return document.getElementById(id);};
  var catalog=[],settings={},skill=null,job=null,pending=null,timer=null,version=0,posting=false,loading=false,previousFocus=null,drafts={};
  async function api(path,data){
    var options={cache:'no-store',signal:AbortSignal.timeout(15000)};
    if(data!==undefined){options.method='POST';options.headers={'Content-Type':'application/json'};options.body=JSON.stringify(data);}
    try{
      var response=await fetch('/api/'+path,options),value=await response.json();
      if(!response.ok)throw new Error(value.error||'Ошибка выполнения навыка');
      return value;
    }catch(error){
      if(error.name==='TypeError'||error.name==='SyntaxError'||error.name==='TimeoutError')throw new Error('Не удалось получить ответ локального сервера. Оставьте окно BAT открытым и откройте навык снова для проверки результата.');
      throw error;
    }
  }
  function visible(){return !$('skillModal').classList.contains('hidden');}
  function feedback(text,error){$('skillFeedback').textContent=text;$('skillFeedback').classList.toggle('skill-error',Boolean(error));}
  function controls(){
    var running=Boolean(job&&job.status==='running'),disabled=posting||loading||running;
    $('skillTask').disabled=disabled;$('skillTokenLimit').disabled=disabled;
    $('skillExecute').disabled=disabled||!settings.has_key||!settings.model||!skill;
    $('skillExecute').textContent=job&&job.status!=='running'?'Запустить ещё раз':'Выполнить навык';
    $('skillConfigureCloud').disabled=posting||loading||running;
    $('skillCopy').disabled=!(job&&job.result);$('skillDownload').disabled=!(job&&job.result);
    $('skillDialog').setAttribute('aria-busy',String(disabled));
  }
  function showSkill(value){
    skill=value;
    $('skillTitle').textContent=value.name;
    $('skillDescription').textContent=value.description||'Навык выполнит введённую задачу с учётом своего названия.';
    $('skillTask').placeholder=value.hint||'Опишите задачу и вставьте исходные данные.';
  }
  function renderJob(value){
    job=value;
    $('skillTask').value=value.task;
    $('skillTokenLimit').value=String(value.max_tokens);
    $('skillResult').textContent=value.result||'';
    $('skillModel').textContent='Модель запуска: '+value.model+(settings.model&&settings.model!==value.model?' · Для нового запуска: '+settings.model:'');
    var labels={running:'Выполняется… Окно навыка можно закрыть: запрос продолжится. Оставьте BAT открытым.',succeeded:'Навык выполнен. Результат сохранён в локальной базе.',partial:'Получен частичный результат.',failed:'Не удалось выполнить навык.',interrupted:'Выполнение было прервано остановкой сервера.'};
    var usage=value.usage&&Number.isInteger(value.usage.total_tokens)?' Токенов: '+value.usage.total_tokens+'.':'';
    feedback((labels[value.status]||value.status)+(value.error?' '+value.error:'')+usage,value.status==='failed'||value.status==='interrupted'||value.status==='partial');
    if(value.status!=='running')pending=null;
    controls();
  }
  function attach(value){
    if(value.skill_id!==skill.id)showSkill({id:value.skill_id,name:value.skill_name,description:value.description});
    renderJob(value);
    if(value.status==='running')schedule(1000);
  }
  function schedule(delay){clearTimeout(timer);timer=setTimeout(poll,delay);}
  async function poll(){
    if(!visible()||!job||job.status!=='running')return;
    var token=version,id=job.id;
    try{var value=await api('skill-runs/'+encodeURIComponent(id));if(token!==version||!visible())return;renderJob(value);if(value.status==='running')schedule(1200);}
    catch(error){if(token===version&&visible()){feedback(error.message,true);schedule(3000);}}
  }
  function saveDraft(){if(skill&&!loading&&!posting&&(!job||job.status!=='running'))drafts[skill.id]={task:$('skillTask').value,limit:$('skillTokenLimit').value};}
  function close(){saveDraft();version++;clearTimeout(timer);$('skillModal').classList.add('hidden');if(previousFocus&&previousFocus.isConnected)previousFocus.focus();}
  async function open(id){
    saveDraft();var token=++version;clearTimeout(timer);
    previousFocus=document.activeElement;
    $('skillModal').classList.remove('hidden');
    $('skillTitle').textContent='Запуск навыка';$('skillDescription').textContent='';$('skillResult').textContent='';
    $('skillTask').value='';$('skillModel').textContent='Проверяю настройки Cloud.ru…';
    job=null;skill=null;loading=true;controls();$('closeSkillModal').focus();feedback('Читаю навык и сохранённый результат…');
    try{
      var result=await Promise.all([api('skill-catalog'),api('cloud/settings'),api('skill-runs?skill_id='+encodeURIComponent(id))]);
      if(token!==version||!visible())return;
      catalog=result[0].data;settings=result[1];
      var selected=catalog.find(function(item){return item.id===id;});
      if(!selected)throw new Error('Навык удалён или отключён. Обновите панель.');
      showSkill(selected);loading=false;
      $('skillModel').textContent=settings.has_key&&settings.model?'Выбранная модель: '+settings.model:'Для запуска сохраните ключ и модель в Cloud.ru.';
      if(result[2].active_run)attach(result[2].active_run);
      else if(result[2].run){renderJob(result[2].run);if(drafts[id]){$('skillTask').value=drafts[id].task;$('skillTokenLimit').value=drafts[id].limit;}}
      else{
        $('skillTask').value=drafts[id]?drafts[id].task:'';$('skillTokenLimit').value=drafts[id]?drafts[id].limit:'2048';
        feedback(settings.has_key&&settings.model?'Введите задачу и нажмите «Выполнить навык».':'Сначала настройте Cloud.ru кнопкой ниже.');
      }
      controls();if(!job||job.status!=='running')$('skillTask').focus();
    }catch(error){if(token===version){loading=false;feedback(error.message,true);controls();}}
  }
  $('closeSkillModal').addEventListener('click',close);
  $('skillModal').addEventListener('click',function(event){if(event.target===this)close();});
  $('skillConfigureCloud').addEventListener('click',function(){close();window.TracktorCloudSettings.open();});
  $('skillExecute').addEventListener('click',async function(){
    if(posting||loading||(job&&job.status==='running')||!skill)return;
    var task=$('skillTask').value.trim();
    if(!task){feedback('Введите задачу для навыка.',true);$('skillTask').focus();return;}
    var fields={skill_id:skill.id,task:task,max_tokens:Number($('skillTokenLimit').value),expected_model:settings.model};
    var signature=JSON.stringify(fields);
    if(!pending||pending.signature!==signature)pending={signature:signature,payload:Object.assign({request_id:crypto.randomUUID()},fields)};
    var payload=pending.payload,token=version;
    drafts[skill.id]={task:task,limit:$('skillTokenLimit').value};posting=true;controls();feedback('Ставлю задачу на выполнение…');
    try{var value=await api('skill-runs',payload);if(token===version&&visible())attach(value);}
    catch(error){
      if(token===version&&visible()){
        feedback(error.message,true);
        // A lost HTTP response must not cause a second paid request.
        try{var latest=await api('skill-runs?skill_id='+encodeURIComponent(fields.skill_id));if(token===version&&visible()&&(latest.active_run||(latest.run&&latest.run.id===payload.request_id)))attach(latest.active_run||latest.run);}catch(ignored){}
      }
    }finally{posting=false;if(visible())controls();if(token===version&&visible()&&(!job||job.status!=='running'))$('skillExecute').focus();}
  });
  $('skillCopy').addEventListener('click',async function(){
    if(!job||!job.result)return;
    try{await navigator.clipboard.writeText(job.result);feedback('Результат скопирован.');}
    catch(error){feedback('Браузер не разрешил копирование. Используйте «Скачать TXT».',true);}
  });
  $('skillDownload').addEventListener('click',function(){
    if(!job||!job.result)return;
    var text=job.skill_name+'\nМодель: '+job.model+'\n\nЗадача:\n'+job.task+'\n\nРезультат:\n'+job.result;
    var url=URL.createObjectURL(new Blob(['\uFEFF'+text],{type:'text/plain;charset=utf-8'})),link=document.createElement('a');
    link.href=url;link.download='skill-result-'+job.id+'.txt';link.click();setTimeout(function(){URL.revokeObjectURL(url);},1000);
  });
  document.addEventListener('keydown',function(event){if(event.key==='Escape'&&visible()){event.preventDefault();event.stopPropagation();close();}},true);
  $('skillModal').addEventListener('keydown',function(event){
    event.stopPropagation();
    if(event.key==='Tab'){
      var items=Array.from($('skillDialog').querySelectorAll('button:not(:disabled),textarea:not(:disabled),select:not(:disabled)')),first=items[0],last=items[items.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    }
  });
  window.SkillRunner={open:open};
})();
