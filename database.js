/* Supabase browser client for TRACKTOR. Never put service_role/secret keys here. */
(function(){
  "use strict";
  var config=window.TRACKTOR_SUPABASE_CONFIG||{};
  var client=null,session=null,status="not-configured",listeners=[],initPromise=null;
  function configured(){return typeof config.url==="string"&&config.url.trim().length>0&&typeof config.publishableKey==="string"&&config.publishableKey.trim().length>0;}
  function emit(event){listeners.slice().forEach(function(callback){try{callback(session&&session.user?session.user:null,event||"STATE_CHANGE");}catch(error){console.error(error);}});}
  function requireClient(){
    if(!client)throw new Error(status==="not-configured"?"Supabase не настроен. Заполните supabase-config.js.":status==="sdk-missing"?"Не загрузился Supabase JS SDK. Проверьте подключение к CDN.":"Нет соединения с Supabase.");
    return client;
  }
  function requireUser(){requireClient();if(!session||!session.user)throw new Error("Сначала войдите в аккаунт TRACKTOR.");return session.user;}
  function resultOrThrow(result){if(result.error)throw result.error;return result.data;}
  function init(){
    if(initPromise)return initPromise;
    if(!configured()){status="not-configured";return Promise.resolve(false);}
    if(!window.supabase||typeof window.supabase.createClient!=="function"){status="sdk-missing";return Promise.resolve(false);}
    status="connecting";
    try{client=window.supabase.createClient(config.url.trim(),config.publishableKey.trim(),{auth:{autoRefreshToken:true,persistSession:true,detectSessionInUrl:true}});}
    catch(error){status="error";return Promise.reject(error);}
    initPromise=client.auth.getSession().then(function(result){
      if(result.error)throw result.error;
      session=result.data.session;status=session&&session.user?"authenticated":"signed-out";
      client.auth.onAuthStateChange(function(event,nextSession){session=nextSession;status=session&&session.user?"authenticated":"signed-out";emit(event);});
      return true;
    }).catch(function(error){status="error";initPromise=null;throw error;});
    return initPromise;
  }
  function signIn(email,password){return requireClient().auth.signInWithPassword({email:email,password:password}).then(function(result){if(result.error)throw result.error;return result.data;});}
  function signUp(email,password){return requireClient().auth.signUp({email:email,password:password}).then(function(result){if(result.error)throw result.error;return result.data;});}
  function signOut(){return requireClient().auth.signOut().then(function(result){if(result.error)throw result.error;return true;});}
  function loadPreferences(){
    var user=requireUser();
    return client.from("user_preferences").select("preferences").eq("user_id",user.id).maybeSingle()
      .then(function(result){return resultOrThrow(result);}).then(function(row){return row?row.preferences:null;});
  }
  function savePreferences(preferences){
    var user=requireUser();
    return client.from("user_preferences").upsert({user_id:user.id,preferences:preferences,updated_at:new Date().toISOString()},{onConflict:"user_id"})
      .select("preferences").single().then(function(result){return resultOrThrow(result);});
  }
  function listSkills(){
    var user=requireUser();
    return client.from("skills").select("id,name,description,model,mode,enabled,sort_order").eq("owner_id",user.id).eq("enabled",true)
      .order("sort_order").order("name").then(function(result){return resultOrThrow(result);});
  }
  function createSkill(name,description){
    requireUser();
    return client.from("skills").insert({name:name,description:description||"",model:"SONNET",mode:"СРЕДНИЙ",enabled:true})
      .select("id,name,description,model,mode,enabled,sort_order").single().then(function(result){return resultOrThrow(result);});
  }
  function listClients(){
    var user=requireUser();
    return client.from("clients").select("id,name,monthly_fee,description,status,sort_order").eq("owner_id",user.id)
      .order("sort_order").order("name").then(function(result){return resultOrThrow(result);});
  }
  function listProjects(){
    var user=requireUser();
    return client.from("projects").select("id,name,file_count,color_index,sort_order").eq("owner_id",user.id)
      .order("sort_order").order("name").then(function(result){return resultOrThrow(result);});
  }
  function listRoutines(){
    var user=requireUser();
    return client.from("routines").select("id,title,detail,scheduled_at,status,is_next,sort_order").eq("owner_id",user.id).eq("enabled",true)
      .order("sort_order").order("scheduled_at").then(function(result){return resultOrThrow(result);});
  }
  function listNotifications(){
    var user=requireUser();
    return client.from("notifications").select("id,title,body,source,read_at,created_at").eq("owner_id",user.id)
      .order("created_at",{ascending:false}).then(function(result){return resultOrThrow(result);});
  }
  window.TracktorDB={
    init:init,isConfigured:configured,getStatus:function(){return status;},getUser:function(){return session&&session.user?session.user:null;},
    onAuthChange:function(callback){if(typeof callback!=="function")return function(){};listeners.push(callback);return function(){listeners=listeners.filter(function(item){return item!==callback;});};},
    signIn:signIn,signUp:signUp,signOut:signOut,loadPreferences:loadPreferences,savePreferences:savePreferences,
    listSkills:listSkills,createSkill:createSkill,listClients:listClients,listProjects:listProjects,listRoutines:listRoutines,listNotifications:listNotifications
  };
})();
