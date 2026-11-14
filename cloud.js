/* Cloud.ru settings. The saved key is never read back into the browser. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var settings = {has_key:false, model:'', verified_at:null}, catalog = [], busy = false, previousFocus = null;
  async function api(path, data) {
    var options = {cache:'no-store', signal:AbortSignal.timeout(55000)};
    if (data !== undefined) { options.method='POST'; options.headers={'Content-Type':'application/json'}; options.body=JSON.stringify(data); }
    try {
      var response = await fetch('/api/cloud/'+path, options);
      var value = await response.json();
      if (!response.ok) throw new Error(value.error || 'Ошибка подключения Cloud.ru');
      return value;
    } catch (error) {
      if (error.name === 'TimeoutError') throw new Error('Проверка затянулась. Подождите и повторите её.');
      if (error.name === 'TypeError' || error.name === 'SyntaxError') throw new Error('Локальный сервер недоступен. Запустите Aspksa.bat.');
      throw error;
    }
  }
  function feedback(message, error) {
    $('cloudFeedback').textContent=message;
    $('cloudFeedback').classList.toggle('cloud-error', Boolean(error));
  }
  function setBusy(value) {
    busy=value;
    ['cloudKey','cloudSaveKey','cloudRefresh','cloudModel','cloudSaveModel','cloudVerify','cloudRemove'].forEach(function(id){$(id).disabled=value;});
    if (!value) {
      $('cloudRefresh').disabled=!settings.has_key;
      $('cloudSaveModel').disabled=!settings.has_key;
      $('cloudVerify').disabled=!settings.has_key;
      $('cloudRemove').disabled=!settings.has_key && !settings.model;
    }
    $('cloudDialog').setAttribute('aria-busy', String(value));
  }
  function applySettings(value) {
    settings=value;
    $('cloudKey').placeholder=value.has_key?'Ключ сохранён. Введите новый для замены.':'Вставьте Key Secret из Cloud.ru';
    $('cloudCredentialStatus').textContent=value.has_key?'Ключ сохранён на этом компьютере.':'Ключ ещё не сохранён.';
    var checked=value.verified_at?new Date(value.verified_at).toLocaleString('ru-RU'):null;
    $('cloudConnectionStatus').textContent=checked?'Последняя успешная проверка: '+checked+' · '+value.model:'Модель ещё не проверена.';
    $('cloudButton').classList.toggle('cloud-verified', Boolean(checked));
    renderModels();
  }
  function renderModels() {
    var select=$('cloudModel');
    select.textContent='';
    select.add(new Option('Выберите текстовую модель', ''));
    catalog.forEach(function(model){select.add(new Option(model.name+' · '+model.id, model.id));});
    if(settings.model && !catalog.some(function(model){return model.id===settings.model;})) {
      select.add(new Option(settings.model+' (сохранённая модель)', settings.model));
    }
    select.value=settings.model || '';
  }
  async function loadModels() {
    var response=await api('models');
    catalog=response.data;
    renderModels();
    feedback(catalog.length?'Список обновлён: '+catalog.length+' моделей. Выберите модель ниже.':'Cloud.ru не вернул текстовых моделей.');
  }
  async function run(action) {
    if(busy)return;
    var focused=document.activeElement;
    setBusy(true);
    try { await action(); }
    catch(error) { feedback(error.message,true); }
    finally {
      setBusy(false);
      if(!$('cloudModal').classList.contains('hidden') && document.activeElement===document.body){
        if(focused && $('cloudDialog').contains(focused) && !focused.disabled)focused.focus();
        else $('cloudKey').focus();
      }
    }
  }
  function open() {
    previousFocus=document.activeElement;
    if($('authModal').contains(previousFocus))previousFocus=$('cloudButton');
    $('authModal').classList.add('hidden');
    $('cloudModal').classList.remove('hidden');
    $('cloudKey').value='';
    $('cloudKey').focus();
    if(busy)return;
    run(async function(){
      feedback('Читаю сохранённые настройки…');
      applySettings(await api('settings'));
      $('cloudReply').textContent='';
      if(settings.has_key)await loadModels();
      else feedback('Вставьте Key Secret сервиса Foundation Models и нажмите «Сохранить ключ».');
    });
  }
  function close() {
    $('cloudKey').value='';
    $('cloudModal').classList.add('hidden');
    if(previousFocus && previousFocus.isConnected)previousFocus.focus();
  }
  $('cloudButton').addEventListener('click',open);
  $('openCloudSettings').addEventListener('click',open);
  $('closeCloudModal').addEventListener('click',close);
  $('cloudModal').addEventListener('click',function(event){if(event.target===this)close();});
  $('cloudSaveKey').addEventListener('click',function(){
    run(async function(){
      var key=$('cloudKey').value.trim();
      if(!key)throw new Error('Вставьте Key Secret. Сохранённый ключ менять не нужно.');
      feedback('Сохраняю ключ в локальной базе…');
      applySettings(await api('settings',{api_key:key}));
      $('cloudKey').value='';
      await loadModels();
    });
  });
  $('cloudRefresh').addEventListener('click',function(){run(async function(){feedback('Загружаю каталог Cloud.ru…');await loadModels();});});
  async function saveModel() {
    if($('cloudKey').value.trim())throw new Error('Сначала сохраните введённый ключ.');
    var model=$('cloudModel').value;
    if(!model)throw new Error('Выберите модель из списка.');
    applySettings(await api('settings',{model:model}));
  }
  $('cloudSaveModel').addEventListener('click',function(){run(async function(){await saveModel();feedback('Модель сохранена. Можно проверить подключение.');});});
  $('cloudVerify').addEventListener('click',function(){
    run(async function(){
      await saveModel();
      $('cloudReply').textContent='';
      feedback('Отправляю короткий проверочный запрос в Cloud.ru…');
      try {
        var result=await api('test',{});
        applySettings({has_key:true,model:result.model,verified_at:result.verified_at});
        $('cloudReply').textContent=result.reply || '';
        feedback(result.message);
      } catch(error) {
        try { applySettings(await api('settings')); } catch(ignored) {}
        throw error;
      }
    });
  });
  $('cloudRemove').addEventListener('click',function(){
    run(async function(){
      applySettings(await api('settings',{remove_key:true}));
      catalog=[];renderModels();$('cloudKey').value='';$('cloudReply').textContent='';
      feedback('Сохранённый ключ и выбор модели удалены из приложения.');
    });
  });
  document.addEventListener('keydown',function(event){
    if(event.key==='Escape' && !$('cloudModal').classList.contains('hidden')){
      event.preventDefault();event.stopPropagation();close();
    }
  },true);
  $('cloudModal').addEventListener('keydown',function(event){
    event.stopPropagation();
    if(event.key==='Escape'){event.preventDefault();close();}
    if(event.key==='Tab'){
      var items=Array.from($('cloudDialog').querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]'));
      var first=items[0],last=items[items.length-1];
      if(event.shiftKey && document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first.focus();}
    }
  });
})();
