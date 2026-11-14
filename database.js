/* Same-origin SQLite API. No account or external SDK required. */
(function(){
  "use strict";
  var status="offline",initPromise=null;
  function request(path,data){
    if(location.protocol==="file:")return Promise.reject(new Error("Запустите Aspksa.bat и откройте http://127.0.0.1:4173/"));
    var options={cache:"no-store",signal:AbortSignal.timeout(10000)};
    if(data!==undefined){options.method="POST";options.headers={"Content-Type":"application/json"};options.body=JSON.stringify(data);}
    return fetch("/api/"+path,options).then(function(response){
      return response.json().then(function(value){
        if(!response.ok){if(response.status>=500){status="error";initPromise=null;}throw new Error(value.error||"Ошибка локальной базы");}
        return value;
      });
    }).catch(function(error){
      if(error.name==="TypeError"||error.name==="TimeoutError"||error.name==="SyntaxError"){status="error";initPromise=null;}
      throw error;
    });
  }
  function init(){
    if(initPromise)return initPromise;
    status="connecting";
    initPromise=request("status").then(function(info){
      if(info.storage!=="sqlite"||!info.single_user)throw new Error("Запустите локальный сервер через Aspksa.bat.");
      status="ready";return info;
    }).catch(function(error){status="error";initPromise=null;throw error;});
    return initPromise;
  }
  window.TracktorDB={
    init:init,getStatus:function(){return status;},isReady:function(){return status==="ready";},
    loadPreferences:function(){return request("preferences");},
    savePreferences:function(preferences){return request("preferences",preferences);},
    listSkills:function(){return request("skills");},
    createSkill:function(name,description){return request("skills",{name:name,description:description||""});},
    listClients:function(){return request("clients");},listProjects:function(){return request("projects");},
    listRoutines:function(){return request("routines");},listNotifications:function(){return request("notifications");},
    getInfo:function(){return request("status");}
  };
})();
