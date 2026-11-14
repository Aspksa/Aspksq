/* TRACKTOR interactive recreation — dependency-free JavaScript */
(function () {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  var $ = function (id) { return document.getElementById(id); };
  var accounts = [
    ["Miranda Seguros","500","трафик, веб-сайт","green"],
    ["Tojiro Mooca","2.200","трафик · продвижение","green"],
    ["Tojiro Zona Norte","1.500","трафик · продвижение","green"],
    ["Instituto Bella Face - SER","850/895","услуги TRACKTOR","red"],
    ["Mecânica Primus","690","трафик и сайт","red"],
    ["Total Protege","1.000","трафик","grey"],
    ["Sr Man Barber Shop","1.000","трафик","red"],
    ["Expo Peças","","производство","green"],
    ["Potecitamente","","трафик · продвижение","green"],
    ["Daiane Rosendo Advocacia","","Google Ads · реклама","green"],
    ["Grupo Centurião","3.200","брендинг и продакшен","red"],
    ["Grupo PMS","2.500","система и продакшен","red"],
    ["T-Motors","1.850","система","red"],
    ["Escrita com Ciência","","трафик","grey"],
    ["Hellen Gestão","","трафик","green"],
    ["Jacque Gomes","","контент","green"],
    ["Maison Estética Sudoeste","","трафик","red"],
    ["Pissolatti Vinhos","","трафик","green"],
    ["drafernanda","","","grey"]
  ];
  var projects = [
    {name:"TRACTOR",files:49,color:0},
    {name:"MAIN FRAME",files:64,color:0},
    {name:"SR MAN BARBER SHOP",files:38,color:1},
    {name:"INSTITUTO BELLA FACE - SER",files:42,color:2},
    {name:"GRUPO CENTURIÃO",files:52,color:3},
    {name:"DAIANE ROSENDO ADVOCACIA",files:20,color:0},
    {name:"DRA. FERNANDA",files:32,color:1},
    {name:"ESCRITA COM CIÊNCIA",files:43,color:2},
    {name:"EXPO PEÇAS",files:36,color:0},
    {name:"GRUPO PMS",files:44,color:0},
    {name:"HELLEN GESTÃO",files:31,color:4},
    {name:"JACQUE GOMES",files:37,color:1},
    {name:"MAISON ESTÉTICA SUDOESTE",files:31,color:3},
    {name:"TOJIRO MOOCA",files:39,color:1},
    {name:"PISSOLATTI VINHOS",files:36,color:0},
    {name:"MECÂNICA PRIMUS",files:45,color:0},
    {name:"T-MOTORS",files:35,color:0},
    {name:"SKILLS",files:192,color:0},
    {name:"TOTAL PROTEGE",files:30,color:3},
    {name:"MOTOR",files:29,color:1}
  ];
  var themes = [
    {name:"Металлический TRACKTOR",colors:["#9ad1d0","#d7bd84","#b76a83","#816cae","#e09f7d","#b4d9eb"],accent:"#45d9b6",rgb:"69,217,182",bg:"#07131b"},
    {name:"Рубрика",colors:["#e7cfb2","#e69c70","#c64d5a","#ae3b6d","#e25daa","#a6b5e3"],accent:"#ef986b",rgb:"239,152,107",bg:"#161019"},
    {name:"Океан",colors:["#43e0b3","#63cdb6","#8cbadb","#668bc9","#917cdb","#e7b577"],accent:"#36dfb7",rgb:"54,223,183",bg:"#07111b"},
    {name:"Неон",colors:["#f1c5ff","#ffeb67","#d4f467","#83e656","#fa42ba","#36dbea"],accent:"#d1fa5c",rgb:"209,250,92",bg:"#0a101b"},
    {name:"Бордо",colors:["#e5b5b5","#d99299","#a75a75","#b47894","#dfad8c","#d6c8b0"],accent:"#e2a1aa",rgb:"226,161,170",bg:"#160f19"},
    {name:"Бумага",colors:["#a6b5c5","#c59c53","#6a7da2","#b98e6e","#7f6d9e","#879c9d"],accent:"#cfac77",rgb:"207,172,119",bg:"#151a21"}
  ];
  var state = {
    page:"command",layout:"rings",view:"departments",angle:0.25,
    force:0.02,size:0.60,names:false,theme:"Океан",expanded:true,
    zoom:1,panX:0,panY:0,search:"",hud:false,plaque:false,selected:null,focus:null
  };
  var drag = null, dragged = false, timerToast = 0, loaderTimer = 0, revealTimer = 0, brainLoadedOnce = false;
  function random(seed) {
    var x = Math.sin(seed * 127.1 + 34.7) * 43758.5453123;
    return x - Math.floor(x);
  }
  function clamp(n,a,b){return Math.min(b,Math.max(a,n));}
  function polar(cx,cy,r,a){return [cx + Math.cos(a)*r,cy + Math.sin(a)*r];}
  function rad(deg){return deg*Math.PI/180;}
  function svg(tag,attrs,parent,label){
    var e=document.createElementNS(NS,tag);
    if(attrs){Object.keys(attrs).forEach(function(k){if(attrs[k]!==null && attrs[k]!==undefined)e.setAttribute(k,attrs[k]);});}
    if(label!==undefined)e.textContent=label;
    if(parent)parent.appendChild(e);
    return e;
  }
  function dom(tag,cls,text,parent){
    var e=document.createElement(tag);
    if(cls)e.className=cls;
    if(text!==undefined)e.textContent=text;
    if(parent)parent.appendChild(e);
    return e;
  }
  function theme(){return themes.find(function(t){return t.name===state.theme;})||themes[2];}
  function accent(i){return theme().colors[((i%theme().colors.length)+theme().colors.length)%theme().colors.length];}
  function notify(message){
    var toast=$("toast");toast.textContent=message;toast.classList.remove("hidden");
    clearTimeout(timerToast);timerToast=setTimeout(function(){toast.classList.add("hidden");},2600);
  }
  function readSaved(){
    try{
      var value=JSON.parse(localStorage.getItem("tracktor-preferences")||"null");
      if(value&&typeof value==="object"){
        ["layout","view","angle","force","size","names","theme","hud","plaque"].forEach(function(k){
          if(Object.prototype.hasOwnProperty.call(value,k))state[k]=value[k];
        });
      }
    }catch(e){}
    var oldTheme={"Oceano":"Океан","Metálico Tracktor":"Металлический TRACKTOR","Rubric":"Рубрика","Neon":"Неон","Bordô":"Бордо","Papel":"Бумага"};
    if(oldTheme[state.theme])state.theme=oldTheme[state.theme];
    if(!["rings","circle","hex","force"].includes(state.layout))state.layout="rings";
    if(!["departments","folders"].includes(state.view))state.view="departments";
    if(!themes.some(function(t){return t.name===state.theme;}))state.theme="Океан";
  }
  function applyTheme(){
    var t=theme();
    document.documentElement.style.setProperty("--accent",t.accent);
    document.documentElement.style.setProperty("--accent-rgb",t.rgb);
    document.documentElement.style.setProperty("--bg",t.bg);
    document.querySelectorAll(".theme-item").forEach(function(e){e.classList.toggle("selected",e.dataset.theme===t.name);});
  }
  function renderHeaderIcons(){
    var paths={
      phone:["M21 16.5v3a2 2 0 0 1-2.2 2A18 18 0 0 1 2.5 5.2 2 2 0 0 1 4.5 3h3a1.8 1.8 0 0 1 1.8 1.5l.5 3.3a2 2 0 0 1-.6 1.8L8.7 11a15 15 0 0 0 4.3 4.3l1.4-1.4a2 2 0 0 1 1.8-.6l3.3.5A1.8 1.8 0 0 1 21 16.5Z"],
      search:["M20 20l-4.6-4.6","M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z"],
      brain:["M12 3v18","M12 8H7L5 6","M12 12h6l2-2","M12 16H7L5 18","M5 8a3 3 0 0 1 0-6","M19 9a3 3 0 0 0 0-6","M5 16a3 3 0 0 0 0 6","M19 16a3 3 0 0 1 0 6"],
      refresh:["M20 11a8 8 0 1 0-2.3 5.7","M20 4v7h-7"],
      power:["M12 2v10","M6.2 5.5a9 9 0 1 0 11.6 0"],
      menu:["M4 6h16","M4 12h16","M4 18h16"]
    };
    document.querySelectorAll("[data-ui-icon]").forEach(function(button){
      var kind=button.getAttribute("data-ui-icon"),data=paths[kind]||[];
      button.textContent="";
      var root=svg("svg",{viewBox:"0 0 24 24",width:15,height:15,"aria-hidden":"true",
        fill:"none",stroke:"currentColor","stroke-width":1.65,"stroke-linecap":"round","stroke-linejoin":"round"},button);
      data.forEach(function(d){svg("path",{d:d},root);});
    });
  }
  function renderThemes(){
    var holder=$("themeList");holder.textContent="";
    themes.forEach(function(t){
      var item=dom("button","theme-item",undefined,holder);
      item.type="button";item.dataset.theme=t.name;
      var strip=dom("span","theme-strip",undefined,item);
      t.colors.forEach(function(c){var dot=dom("i","",undefined,strip);dot.style.backgroundColor=c;});
      dom("span","theme-label",t.name,item);
      if(t.name===state.theme)dom("small","", "ВЫБРАНА",item);
      item.addEventListener("click",function(){state.theme=t.name;applyTheme();renderThemes();renderBrain();renderCommand();});
    });
    applyTheme();
  }
  var selectedClient=null;
  function showClient(account){
    selectedClient=account;
    $("clientModalTitle").textContent=account[0];
    var holder=$("clientModalFields");holder.textContent="";
    var fields=[
      ["ПОДПИСКА",account[1]?"R$ "+account[1]:"Не указана"],
      ["НАПРАВЛЕНИЕ",account[2]||"Сопровождение"],
      ["СОСТОЯНИЕ",account[3]==="red"?"Требует внимания":account[3]==="green"?"Активен":"На проверке"],
      ["ИСТОЧНИК","Видеозапись · демо"]
    ];
    fields.forEach(function(field){
      var cell=dom("div","",undefined,holder);
      dom("small","",field[0],cell);
      dom("strong","",field[1],cell);
    });
    $("clientModal").classList.remove("hidden");
    $("closeClientModal").focus();
  }
  function hideClient(){$("clientModal").classList.add("hidden");}
  function commandTooltip(ev,account){
    var tooltip=$("commandTooltip"),rect=$("commandStage").getBoundingClientRect();
    tooltip.textContent="";
    dom("strong","",account[0],tooltip);
    dom("small","",account[2]||"Сопровождение клиента",tooltip);
    dom("small","",account[1]?"R$ "+account[1]+" / месяц":"Данные по оплате отсутствуют",tooltip);
    dom("em","","НАЖМИТЕ, ЧТОБЫ ОТКРЫТЬ КАРТОЧКУ",tooltip);
    tooltip.style.left=clamp(ev.clientX-rect.left+12,10,Math.max(10,rect.width-222))+"px";
    tooltip.style.top=clamp(ev.clientY-rect.top+12,10,Math.max(10,rect.height-100))+"px";
    tooltip.classList.remove("hidden");
  }
  function renderWallet(){
    var holder=$("walletList");holder.textContent="";
    accounts.forEach(function(a,i){
      var row=dom("div","wallet-item",undefined,holder);
      dom("span","wallet-dot",undefined,row);
      var block=dom("span","wallet-client",undefined,row);
      dom("div","wallet-name",a[0],block);
      dom("div","wallet-sub",a[2]||"под наблюдением",block);
      var right=dom("span","wallet-aside",undefined,row);
      if(a[1])dom("span","wallet-money","R$ "+a[1],right);
      dom("span","wallet-pill",i%7===2?"САЙТ":"▸ ТРАФИК",right);
      row.title="Открыть "+a[0];
      row.style.cursor="pointer";
      row.addEventListener("click",function(){showClient(a);});
    });
    var alerts=$("alertItems");alerts.textContent="";
    [
      ["09:00","Праздник 7/09 · Mooca: счёт R$ 27,86"],
      ["06:10","Автоматизация Daiane выполнила действие"],
      ["06:00","Поиск клиентов · утро 07/09"],
      ["06:00","Reels Mooca · публикации на неделю"],
      ["06:00","Автоматизация Tojiro ZN · просроченное обещание"],
      ["05:30","Воронка за неделю · Tojiro Zona Norte"],
      ["05:30","Воронка за неделю · Mecânica Primus"],
      ["05:30","Воронка за неделю · Tojiro Mooca"]
    ].forEach(function(t){
      var e=dom("div","",undefined,alerts);dom("b","",t[0],e);e.appendChild(document.createTextNode(t[1]));
    });
  }
  function renderFunnel(){
    var holder=$("funnelList");if(!holder)return;
    holder.textContent="";
    var rows=[["Expo Peças",548,0],["Tojiro Mooca",345,197],["Tojiro Zona Norte",243,127],
      ["Instituto Bella Face",117,41],["Mecânica Primus",36,29],
      ["Potecitamente",20,0],["Miranda Seguros",14,0],["Total Protege",0,0],["Sr Man Barber Shop",0,0]];
    rows.forEach(function(data){
      var item=dom("div","funnel-item",undefined,holder);
      var l=dom("div","",undefined,item),r=dom("div","",undefined,item);
      dom("div","funnel-name",data[0],l);
      var track=dom("div","funnel-track",undefined,l),bar=dom("i","",undefined,track);
      bar.style.width=(data[1]/548*100).toFixed(2)+"%";
      dom("div","funnel-count",String(data[1]),r);
      dom("div","funnel-mini",data[2]+" диалогов",r);
    });
  }
  function renderSkills(){
    var holder=$("skillsGrid");if(!holder)return;
    holder.textContent="";
    var skills=["/оптимизация-аккаунта","/отчёт-в-3-шага","/панель-кампаний","/цикл-креативов"];
    skills.forEach(function(name){
      var card=dom("div","skill-card",undefined,holder);
      dom("div","skill-name",name,card);
      dom("div","skill-meta","SONNET · СРЕДНИЙ",card);
      var actions=dom("div","skill-controls",undefined,card);
      var run=dom("button","", "▶",actions),more=dom("button","skill-more","◌",actions);
      run.type="button";run.title="Запустить навык";
      more.type="button";more.title="Информация о навыке";
      run.addEventListener("click",function(){notify("Демо: для запуска "+name+" нужен сервер оригинала");});
      more.addEventListener("click",function(){notify("Навык "+name+" · модель SONNET · режим «Средний»");});
    });
  }
  function renderRoutines(){
    var holder=$("routineList");if(!holder)return;holder.textContent="";
    var routines=[
      ["19:00","Проверка кредитного лимита","ТРЕКТОР · ПРОВЕРКА","СЛЕДУЮЩИЙ",true],
      ["19:25","Поиск рабочего номера","УТИЛИТА · ВЫЗОВ","В ОЧЕРЕДИ",false],
      ["20:30","Запросить номер у владельца","COBRA_RODIZIO · DOCKER","В ОЧЕРЕДИ",false],
      ["23:40","Обновить панель данных","UPDATE-DATA · ОПЕРАЦИЯ","ЗАПЛАНИРОВАН",false],
      ["04:10","Обновление CRM","АВТОМАТИЗАЦИЯ · СИСТЕМА","ЗАПЛАНИРОВАН",false],
      ["06:00","Отчёт по рекламным кампаниям","РАБОЧИЕ ЗАДАЧИ","ЗАПЛАНИРОВАН",false]
    ];
    routines.forEach(function(r){
      var row=dom("div","routine-row"+(r[4]?" next":""),undefined,holder);
      dom("div","routine-time",r[0],row);
      var center=dom("div","",undefined,row);
      dom("div","routine-name",r[1],center);
      dom("div","routine-detail",r[2],center);
      dom("div","routine-status",r[3],row);
      row.title=r[1]+" · "+r[3];
    });
  }
  function renderTeam(){
    var grid=$("teamGrid");grid.textContent="";
    for(var i=0;i<154;i++){
      var active=random(i*5+8)>.66 || i>132&&random(i)>.34;
      var item=dom("span","team-cell"+(active?" active":"")+(i%9===0?" alt":""),undefined,grid);
      dom("span","",active?(i%4===0?"◇":i%6===0?"⌁":"◦"):"·",item);
      item.title=active?"Сотрудник активен":"Сотрудник ожидает";
    }
  }
  function updateClock(){
    var now=new Date();
    try{
      var t=new Intl.DateTimeFormat("ru-RU",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false,timeZone:"America/Sao_Paulo"}).format(now);
      var day=new Intl.DateTimeFormat("ru-RU",{weekday:"short",day:"numeric",month:"short",year:"numeric",timeZone:"America/Sao_Paulo"}).format(now);
      $("liveClock").textContent=t;
      $("liveDate").textContent=day.toUpperCase();
      $("systemLabel").textContent=state.page==="brain"?"2209 ФАЙЛОВ · 137 ПРОЦЕССОВ":"ДЕМО-РЕЖИМ · "+t.slice(0,5);
    }catch(e){$("liveClock").textContent=now.toLocaleTimeString("ru-RU");}
  }
  function renderCalendar(){
    var holder=$("miniCalendar");holder.textContent="";
    ["ВС","ПН","ВТ","СР","ЧТ","ПТ","СБ"].forEach(function(x){dom("span","",x,holder);});
    var parts=new Intl.DateTimeFormat("ru-RU",{timeZone:"America/Sao_Paulo",year:"numeric",month:"numeric",day:"numeric"}).formatToParts(new Date());
    function get(key){return Number(parts.find(function(p){return p.type===key;}).value);}
    var year=get("year"),month=get("month"),today=get("day");
    var start=new Date(Date.UTC(year,month-1,1)).getUTCDay();
    var total=new Date(Date.UTC(year,month,0)).getUTCDate();
    var cells=Math.ceil((start+total)/7)*7;
    for(var j=0;j<cells;j++){
      var num=j-start+1;
      dom("span",num===today?"today":num<=0||num>total?"outside":"",num>0&&num<=total?String(num):"",holder);
    }
  }
  function renderCommand(){
    var root=$("commandSvg");root.textContent="";
    var defs=svg("defs",{},root);
    var filter=svg("filter",{id:"cmdGlow",x:"-80%",y:"-80%",width:"260%",height:"260%"},defs);
    svg("feGaussianBlur",{stdDeviation:"2.5",result:"b"},filter);
    var merge=svg("feMerge",{},filter);svg("feMergeNode",{in:"b"},merge);svg("feMergeNode",{in:"SourceGraphic"},merge);
    var cx=410,cy=445;
    [80,150,245,345].forEach(function(r,i){
      svg("circle",{cx:cx,cy:cy,r:r,fill:"none",stroke:"#1d3442","stroke-width":i===2?1.2:.65,opacity:i===3?.13:.38},root);
    });
    for(var i=0;i<170;i++){
      var a=random(i+12)*Math.PI*2,rr=Math.sqrt(random(i+980))*47,xy=polar(cx,cy,rr,a);
      var dot=svg("circle",{cx:xy[0],cy:xy[1],r:random(i+99)*2+.5,fill:i%8===0?accent(1):accent(i%3),
        opacity:.28+random(i+33)*.6,class:i%3===0?"command-star":""},root);
      if(i%3===0)dot.style.animationDelay=(-(i%16)*.22)+"s";
    }
    for(var j=0;j<38;j++){
      var angle=-Math.PI/2+Math.PI*2*j/38,pt=polar(cx,cy,355,angle);
      var icons=["file","chat","target","chart","star","link","folder","code","calendar","gear"];
      drawBadge(root,pt[0],pt[1],21,"#537487",icons[j%icons.length],.68);
      if(j%5===0)svg("text",{x:pt[0],y:pt[1]+30,"text-anchor":"middle",fill:"#486576",
        "font-family":"var(--mono)","font-size":"8"},root,j%2?"поддержка":"сервис");
      if(j<25){
        var pt2=polar(cx,cy,325,angle);
        svg("line",{x1:pt[0],y1:pt[1],x2:pt2[0],y2:pt2[1],stroke:"#223443","stroke-width":.6},root);
      }
    }
    accounts.slice(0,17).forEach(function(ac,k){
      var a=-Math.PI+Math.PI*2*k/17,pt=polar(cx,cy,205+12*Math.sin(k),a);
      var small=polar(cx,cy,40+random(k+70)*28,a+random(k)*.4);
      var col=accent(k===4?1:k%5);
      svg("line",{x1:small[0],y1:small[1],x2:pt[0],y2:pt[1],stroke:col,"stroke-width":.9,opacity:.18},root);
      svg("circle",{cx:pt[0],cy:pt[1],r:9,fill:"#0e1d2a",stroke:col,"stroke-width":1.6,opacity:.9},root);
      svg("circle",{cx:pt[0],cy:pt[1],r:5,fill:col,opacity:.95,filter:"url(#cmdGlow)"},root);
      var isRight=Math.cos(a)>=0;
      var text=svg("text",{x:pt[0]+(isRight?13:-13),y:pt[1]+3,"text-anchor":isRight?"start":"end",fill:"#7e9eab","font-family":"var(--mono)","font-size":k%3===0?"10":"9",opacity:.82},root,ac[0].substring(0,23));
      var hit=svg("circle",{cx:pt[0],cy:pt[1],r:14,fill:"transparent",class:"account-node"},root);
      hit.addEventListener("pointerenter",function(e){commandTooltip(e,ac);});
      hit.addEventListener("pointermove",function(e){commandTooltip(e,ac);});
      hit.addEventListener("pointerleave",function(){$("commandTooltip").classList.add("hidden");});
      hit.addEventListener("click",function(){$("commandTooltip").classList.add("hidden");showClient(ac);});
      hit.appendChild(svg("title",{},null,ac[0]));
    });
    for(var q=0;q<140;q++){
      var an=random(q+550)*6.283,rr2=60+random(q+350)*110,xy2=polar(cx,cy,rr2,an);
      svg("circle",{cx:xy2[0],cy:xy2[1],r:.55+random(q+933)*1.45,fill:accent(q%6),opacity:random(q+441)*.35},root);
    }
    svg("text",{x:cx,y:cy+79,"text-anchor":"middle",fill:"#426774","font-family":"var(--mono)","font-size":"9","letter-spacing":"3"},root,"TRACKTOR");
    var enter=svg("circle",{cx:cx,cy:cy,r:62,fill:"transparent",stroke:"transparent","stroke-width":1,class:"center-open-target"},root);
    svg("title",{},enter,"Открыть Второй мозг");
    enter.addEventListener("click",function(){openBrain();});
  }
  function matchSearch(name){
    if(state.focus&&name!==state.focus&&name!=="CLAUDE.MD")return false;
    if(!state.search.trim())return true;
    function clean(s){return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");}
    return clean(name).includes(clean(state.search.trim()));
  }
  function drawCircle(parent,x,y,r,fill,stroke,sw,opacity,cls){
    return svg("circle",{cx:x,cy:y,r:r,fill:fill||"none",stroke:stroke||"none","stroke-width":sw||0,opacity:opacity===undefined?1:opacity,class:cls||""},parent);
  }
  function drawLine(parent,a,b,color,width,opacity){
    return svg("line",{x1:a[0],y1:a[1],x2:b[0],y2:b[1],stroke:color,"stroke-width":width||.7,opacity:opacity===undefined?.3:opacity},parent);
  }
  function drawText(parent,x,y,str,color,size,anchor,extra){
    var attrs={x:x,y:y,fill:color,"font-size":size||9,"font-family":"IBM Plex Mono, ui-monospace, monospace","letter-spacing":".03em","text-anchor":anchor||"middle"};
    if(extra)Object.keys(extra).forEach(function(k){attrs[k]=extra[k];});
    return svg("text",attrs,parent,str);
  }
  function attachNode(e,p,type){
    e.classList.add(type==="file"?"file-node":"group-node");
    e.setAttribute("data-name",p.name);
    if(p.group)e.setAttribute("data-group",p.group);
    if(!matchSearch(p.group||p.name))e.setAttribute("opacity",".09");
    svg("title",{},e,p.name);
    e.addEventListener("pointerenter",function(ev){
      if(drag||dragged)return;
      showDetails(ev,p);
      drawHoverLinks(e,p);
    });
    e.addEventListener("pointermove",function(ev){
      if(drag||dragged)return;
      showDetails(ev,p);
    });
    e.addEventListener("pointerleave",function(){
      if(!drag&&!dragged){hideDetails();clearHoverLinks();}
    });
    e.addEventListener("click",function(ev){
      if(dragged)return;
      ev.stopPropagation();
      var name=p.group||p.name;
      state.focus=state.focus===name?null:name;
      state.search="";
      $("fileSearch").value="";
      renderBrain();
      $("canvasHint").textContent=state.focus?
        "ФИЛЬТР: "+state.focus.toUpperCase()+" · ESC — СНЯТЬ ФИЛЬТР":
        "ПЕРЕТАСКИВАНИЕ — ПЕРЕМЕСТИТЬ · КОЛЕСО — МАСШТАБ · КЛИК — ФИЛЬТР";
    });
    return e;
  }
  function nodeCoords(el){
    var a=Number(el.getAttribute("cx")),b=Number(el.getAttribute("cy"));
    if(Number.isFinite(a)&&Number.isFinite(b))return [a,b];
    var rect=el.getBBox();
    return [rect.x+rect.width/2,rect.y+rect.height/2];
  }
  function clearHoverLinks(){
    var e=$("hoverLinks");if(e)e.remove();
  }
  function drawHoverLinks(element,p){
    clearHoverLinks();
    var parent=$("mapViewport"),overlay=svg("g",{id:"hoverLinks",class:"hover-links","pointer-events":"none"},parent);
    var start=nodeCoords(element),all=Array.from(parent.querySelectorAll(".file-node, .group-node")).filter(function(el){return el!==element;});
    var name=p.group||p.name;
    var related=all.filter(function(el){return el.getAttribute("data-name")===name||el.getAttribute("data-group")===name;});
    var seed=projects.findIndex(function(proj){return proj.name===name;});
    if(seed<0)seed=0;
    // Connections are derived from nodes in the same demonstration group.
    // Don't invent edges between unrelated departments.
    var targets=related.slice(0,state.layout==="hex"?20:32);
    targets.forEach(function(el,i){
      var end=nodeCoords(el);
      if(Math.hypot(end[0]-start[0],end[1]-start[1])<15)return;
      drawLine(overlay,start,end,accent((p.color||0)+i%3),.85+i%4*.22,.36+i%4*.13);
      drawCircle(overlay,end[0],end[1],i%5===0?2.7:1.4,accent(p.color||0),"none",0,.75);
    });
  }
  function showDetails(ev,p){
    var box=$("mapTooltip"),rect=$("brainSvg").getBoundingClientRect();
    box.textContent="";
    var h=dom("strong","",undefined,box),dot=dom("i","tip-dot",undefined,h);
    dot.style.background=accent(p.color||0);h.appendChild(document.createTextNode(p.name));
    if(p.kind==="file"){
      dom("small","","ФАЙЛ · "+(p.group||"Библиотека"),box);
      dom("small","",p.path||"Внутренний документ",box);
      dom("small","",p.size||"1,2 КБ",box);
    }else{
      var label=p.name==="CLAUDE.MD"?"центральный файл":state.view==="departments"?"отдел":"папка";
      dom("small","",String(p.files||30)+" файлов · "+label,box);
    }
    dom("small","",state.focus===(p.group||p.name)?"НАЖМИТЕ, ЧТОБЫ СНЯТЬ ФИЛЬТР":"НАЖМИТЕ, ЧТОБЫ ОТФИЛЬТРОВАТЬ",box);
    var x=ev.clientX-rect.left+13,y=ev.clientY-rect.top+13;
    x=clamp(x,10,Math.max(10,rect.width-240));
    y=clamp(y,8,Math.max(8,rect.height-100));
    box.style.left=x+"px";box.style.top=y+"px";box.classList.remove("hidden");
  }
  function hideDetails(){$("mapTooltip").classList.add("hidden");state.selected=null;}
  function drawCenter(parent,cx,cy){
    drawCircle(parent,cx,cy,84,"none","#30434c",1,.5);
    drawCircle(parent,cx,cy,61,"#091923","#245b5b",.95,.89);
    drawCircle(parent,cx,cy,45,"none",accent(0),1.7,.97,"center-ring");
    var logo=svg("g",{class:"brain-center-logo",stroke:"#d8e8ea","stroke-width":"1.8",
      "stroke-linecap":"round",fill:"none",opacity:".96"},parent);
    svg("ellipse",{cx:cx-3,cy:cy+1,rx:20,ry:16,transform:"rotate(-40 "+(cx-3)+" "+(cy+1)+")"},logo);
    svg("ellipse",{cx:cx+5,cy:cy-3,rx:16,ry:20,transform:"rotate(35 "+(cx+5)+" "+(cy-3)+")"},logo);
    svg("ellipse",{cx:cx+1,cy:cy+1,rx:12,ry:16,transform:"rotate(72 "+(cx+1)+" "+(cy+1)+")"},logo);
    drawText(parent,cx,cy+37,"CLAUDE.MD","#839da6",9,"middle",{"letter-spacing":"1",class:"center-label"});
    attachNode(drawCircle(parent,cx,cy,46,"transparent","none",0,1),
      {name:"CLAUDE.MD",files:1,color:0},"group");
  }
  function drawBadge(parent,x,y,r,color,kind,opacity){
    var g=svg("g",{class:"map-badge",opacity:opacity===undefined?1:opacity},parent);
    drawCircle(g,x,y,r,"#0a1723",color,1,.62);
    drawCircle(g,x,y,r*.78,"none",color,.55,.31);
    var icon=svg("g",{transform:"translate("+x+" "+y+") scale("+(r/10)+")",stroke:color,"stroke-width":1.35,
      "stroke-linecap":"round","stroke-linejoin":"round",fill:"none",opacity:".8"},g);
    if(kind==="file"){
      svg("path",{d:"M-4 -6 H2 L5 -3 V6 H-4 Z M2 -6 V-3 H5 M-2 -1 H3 M-2 2 H3"},icon);
    }else if(kind==="chat"){
      svg("path",{d:"M-5 -4 Q-5 -6 -3 -6 H4 Q6 -6 6 -4 V2 Q6 4 4 4 H-1 L-4 7 V4 Q-5 4 -5 2 Z M-2 -2 H3 M-2 1 H2"},icon);
    }else if(kind==="target"){
      drawCircle(icon,0,0,5.5,"none",color,1.2,.95);
      drawCircle(icon,0,0,2.3,"none",color,1.1,.9);
      drawCircle(icon,0,0,.8,color,"none",0,.9);
    }else if(kind==="chart"){
      svg("path",{d:"M-6 6 V1 H-3 V6 M-1 6 V-3 H2 V6 M4 6 V-6 H7 V6"},icon);
    }else if(kind==="star"){
      svg("path",{d:"M0 -7 L1.5 -1.5 L7 0 L1.5 1.5 L0 7 L-1.5 1.5 L-7 0 L-1.5 -1.5 Z"},icon);
    }else if(kind==="link"){
      svg("path",{d:"M-1 -4 L2 -6 Q6 -8 7 -4 Q8 -1 5 1 L3 3 M1 4 L-2 6 Q-6 8 -7 4 Q-8 1 -5 -1 L-3 -3 M-3 2 L3 -2"},icon);
    }else if(kind==="folder"){
      svg("path",{d:"M-7 -3 V5 H7 V-3 H0 L-2 -6 H-7 Z"},icon);
    }else if(kind==="code"){
      svg("path",{d:"M-2 -5 L-7 0 L-2 5 M2 -5 L7 0 L2 5 M1 -7 L-1 7"},icon);
    }else if(kind==="calendar"){
      svg("rect",{x:-6,y:-5,width:12,height:11,rx:1},icon);
      svg("path",{d:"M-6 -1 H6 M-3 -7 V-3 M3 -7 V-3"},icon);
    }else{
      svg("path",{d:"M0 -7 V-5 M5 -5 L3 -3 M7 0 H5 M5 5 L3 3 M0 7 V5 M-5 5 L-3 3 M-7 0 H-5 M-5 -5 L-3 -3"},icon);
      drawCircle(icon,0,0,3,"none",color,1,.95);
    }
    return g;
  }
  function drawPlaque(parent,x,y,text,color,anchor){
    if(!state.plaque)return;
    var width=Math.max(65,text.length*5.6+12);
    var left=anchor==="start"?x-3:anchor==="end"?x-width+3:x-width/2;
    svg("rect",{x:left,y:y-12,width:width,height:17,rx:3,fill:"#0d2532","fill-opacity":".88",
      stroke:color,"stroke-width":".65","stroke-opacity":".48"},parent);
  }
  function ensureBackdrop(){
    var canvas=$("brainSvg");
    if(canvas.querySelector("#mapBackdrop"))return;
    var defs=svg("defs",{},null);
    var pattern=svg("pattern",{id:"backgroundHex",width:86,height:75,patternUnits:"userSpaceOnUse"},defs);
    svg("path",{d:"M21 1 L64 1 L85 37.5 L64 74 L21 74 L0 37.5 Z",fill:"none",stroke:"#2b4352",
      "stroke-width":"1","stroke-opacity":".25"},pattern);
    canvas.insertBefore(defs,$("mapViewport"));
    var backdrop=svg("rect",{id:"mapBackdrop",x:0,y:0,width:1100,height:920,
      fill:"url(#backgroundHex)","fill-opacity":".22","pointer-events":"none"},null);
    canvas.insertBefore(backdrop,$("mapViewport"));
  }
  function drawStars(parent,count){
    for(var i=0;i<count;i++){
      var x=55+random(i*11+800)*990,y=44+random(i*7+550)*825;
      drawCircle(parent,x,y,.4+random(i+60)*.8,accent(i%4),"none",0,.07+random(i+88)*.2);
    }
  }
  function demoFile(project,projectIndex,fileIndex){
    var names=["память.md","агенты.md","данные.json","задачи.md","отчёт.csv","процессы.md",
      "архив.json","связи.md","индекс.yaml","заметки.md","метрики.csv","проекты.md"];
    var name=names[(projectIndex*7+fileIndex)%names.length];
    return {name:name,kind:"file",group:project.name,color:project.color,
      size:(.3+random(projectIndex*80+fileIndex)*6).toFixed(1).replace(".",",")+" КБ",
      path:"/"+project.name.toLowerCase().replace(/\s+/g,"-")+"/"+name};
  }
  function rings(parent){
    var cx=545,cy=467;
    drawStars(parent,190);
    [100,165,305,389,453,505].forEach(function(r,i){
      drawCircle(parent,cx,cy,r,"none","#4c6370",i===5?1:.65,i===3?.30:i===5?.34:.18);
    });
    drawCenter(parent,cx,cy);
    drawText(parent,cx,cy-116,"ПРОЦЕССЫ","#566e7d",8,"middle",{"letter-spacing":"2"});
    drawText(parent,cx,cy-26,"ПАМЯТЬ","#688994",8,"middle",{"letter-spacing":"2"});
    var angles=[-90,-114,-75,-58,-42,-26,-10,5,19,34,49,65,88,105,122,140,158,180,202,237];
    projects.forEach(function(p,i){
      var a=rad(angles[i]+state.angle*22+(state.view==="folders"?(i%2?8:-8):0)),col=accent(p.color);
      var spotlight=matchSearch(p.name);
      var from=polar(cx,cy,103,a),to=polar(cx,cy,296,a);
      drawLine(parent,from,to,col,.6,spotlight?.17:.025);
      var cluster=svg("g",{opacity:spotlight?1:.1},parent);
      for(var j=0;j<(state.expanded?p.files:Math.min(p.files,10));j++){
        var band=j%9,level=Math.floor(j/9);
        var rr=172+level*(13+state.force*85)+random(j*i+47)*10;
        var dx=(band-4)*.018 +(random(i*500+j)-.5)*.012;
        var pt=polar(cx,cy,rr,a+dx),r=.95+random(j+i*9)*1.55;
        drawCircle(cluster,pt[0],pt[1],r,col,"none",0,.38+random(j+17)*.56);
        if(j%2===0){
          var file=demoFile(p,i,j);
          attachNode(drawCircle(cluster,pt[0],pt[1],6.3,"transparent","none",0,1),file,"file");
        }
        if((state.names&&state.zoom>1.5&&j<5)||(state.zoom>2.2&&j%17===0)){
          var labelFile=demoFile(p,i,j);
          drawText(cluster,pt[0]+5,pt[1]-5,labelFile.name,col,6,"start",{opacity:".73"});
        }
      }
      var l=polar(cx,cy,327,a),isLeft=Math.cos(a)<-.2;
      var anchor=isLeft?"end":Math.cos(a)>.2?"start":"middle";
      drawPlaque(cluster,l[0],l[1],p.name,col,anchor);
      var label=drawText(cluster,l[0],l[1],p.name,col,8,anchor);
      label.setAttribute("class","node-label");
      var nodePoint=polar(cx,cy,272,a);
      attachNode(drawCircle(cluster,nodePoint[0],nodePoint[1],12,"transparent","none",0,1),p,"group");
    });
    for(var k=0;k<(state.expanded?178:60);k++){
      var angle=rad(-172+k*344/(state.expanded?177:59))+state.angle*.035;
      var rr=(k%3===0?505:k%3===1?479:450),pt=polar(cx,cy,rr,angle);
      var parentGroup=projects[k%projects.length],col=accent(Math.floor(k/20)%6),visible=matchSearch(parentGroup.name);
      if(k%9===0){drawLine(parent,polar(cx,cy,365,angle),pt,"#466270",.6,.23);}
      var pictograms=["file","chat","target","chart","star","link","folder","code","calendar","gear"];
      drawBadge(parent,pt[0],pt[1],k%7===0?10.7:9.2,col,pictograms[k%pictograms.length],visible?(.53+k%4*.1):.07);
      attachNode(drawCircle(parent,pt[0],pt[1],11,"transparent","none",0,1),parentGroup,"file");
    }
    if(!state.expanded){
      svg("rect",{x:0,y:0,width:1,height:1,fill:"none"},parent);
    }
  }
  function circleLayout(parent){
    var cx=545,cy=455;
    drawStars(parent,180);
    [117,270,390,435].forEach(function(r){drawCircle(parent,cx,cy,r,"none","#35515d",.65,.17);});
    drawCenter(parent,cx,cy);
    var sym=["file","chat","target","chart","star","link","folder","code","calendar","gear"];
    // In the source recording, departments become individual file bubbles orbiting the central document.
    projects.forEach(function(p,i){
      var a=rad(-90+i*360/projects.length)+state.angle*.14+(state.view==="folders"?(i%2?-.06:.06):0);
      var distance=380+Math.sin(i*1.9)*27,pos=polar(cx,cy,distance,a),col=accent(p.color);
      var radius=(p.name==="SKILLS"?75:28+p.files*.27)*(.81+state.size*.36);
      var visible=matchSearch(p.name);
      var group=svg("g",{opacity:visible?1:.13},parent);
      drawCircle(group,pos[0],pos[1],radius,"#091b27",col,.95,.55);
      drawCircle(group,pos[0],pos[1],radius*.67,"none",col,.8,.29);
      drawCircle(group,pos[0],pos[1],5,col,"none",0,.9);
      var total=state.expanded?p.files:Math.min(10,p.files),fileSpots=[];
      for(var j=0;j<total;j++){
        var th=random(i*400+j)*Math.PI*2,rr=Math.sqrt(random(i*200+j+22))*radius*.85,pt=polar(pos[0],pos[1],rr,th);
        drawCircle(group,pt[0],pt[1],1.2+random(j+7)*2.2,col,"none",0,.44+random(j+8)*.54);
        if(j%5===0)fileSpots.push({pt:pt,file:demoFile(p,i,j)});
      }
      var count=state.expanded?Math.max(4,Math.min(18,Math.round(p.files/5))):3;
      for(var k=0;k<count;k++){
        var ba=-Math.PI/2+6.283*k/count,pp=polar(pos[0],pos[1],radius+16,ba);
        drawBadge(group,pp[0],pp[1],8.5,col,sym[(i+k)%sym.length],.52);
        attachNode(drawCircle(group,pp[0],pp[1],11,"transparent","none",0,1),p,"file");
      }
      var y=pos[1]-radius-22;
      drawPlaque(group,pos[0],y,p.name,col,"middle");
      drawText(group,pos[0],y,p.name,col,8,"middle",{class:"node-label"});
      attachNode(drawCircle(group,pos[0],pos[1],radius*.9,"transparent","none",0,1),p,"group");
      fileSpots.forEach(function(x){attachNode(drawCircle(group,x.pt[0],x.pt[1],5.7,"transparent","none",0,1),x.file,"file");});
    });
    // A necklace of small file badges follows the main document in the circle view.
    for(var m=0;m<27;m++){
      var pos2=polar(cx,cy,65,rad(-130+m*10));
      drawBadge(parent,pos2[0],pos2[1],7.3,accent(0),sym[m%sym.length],.46);
    }
  }
  function hexPath(cx,cy,r){
    var pts=[];
    for(var i=0;i<6;i++){
      var a=Math.PI/3*i+Math.PI/6,pt=polar(cx,cy,r,a);
      pts.push(pt[0].toFixed(2)+","+pt[1].toFixed(2));
    }
    return pts.join(" ");
  }
  function hexLayout(parent){
    drawStars(parent,145);
    var tiles=[
      ["TOJIRO MOOCA",240,-75,5],
      ["PISSOLATTI VINHOS",550,-75,3],
      ["POTECITAMENTE",860,-75,2],
      ["MIRANDA SEGUROS",85,190,0],
      ["GRUPO CENTURIÃO",395,190,4],
      ["DAIANE ROSENDO ADVOCACIA",705,190,0],
      ["MAISON ESTÉTICA SUDOESTE",-70,455,4],
      ["INSTITUTO BELLA FACE - SER",240,455,2],
      ["CLAUDE.MD",550,455,0],
      ["DRA. FERNANDA",860,455,5],
      ["JACQUE GOMES",85,720,3],
      ["SR MAN BARBER SHOP",395,720,3],
      ["TRACTOR",705,720,0],
      ["HELLEN GESTÃO",240,985,3],
      ["GRUPO PMS",550,985,0],
      ["EXPO PEÇAS",860,985,3]
    ];
    var scale=.76+state.size*.55,r=165*scale;
    var kinds=["file","chat","target","chart","star","link","folder","code","calendar","gear"];
    tiles.slice(0,state.expanded?16:10).forEach(function(tile,i){
      var found=projects.find(function(x){return x.name===tile[0];});
      var p={name:tile[0],files:found?found.files:38,color:tile[3]};
      var cx=tile[1],cy=tile[2],c=accent(p.color);
      var group=svg("g",{opacity:matchSearch(p.name)?1:.13},parent);
      // The central CLAUDE.MD hub in the footage sits in the empty space between the cells.
      if(p.name!=="CLAUDE.MD"){
        var tileShape=svg("polygon",{points:hexPath(cx,cy,r),fill:c,"fill-opacity":state.plaque?".11":".052",
          stroke:c,"stroke-opacity":".34","stroke-width":"1.35",class:"hex-cell"},group);
        // The entire hexagon is interactive, not just its inner hub.
        attachNode(tileShape,p,"group");
        svg("polygon",{points:hexPath(cx,cy,r-6),fill:"none",stroke:c,
          "stroke-opacity":".08","stroke-width":".7"},group);
      }
      if(p.name==="CLAUDE.MD"){
        drawCenter(group,cx,cy);
        for(var z=0;z<22;z++){
          var a0=z/22*6.283,orbit=polar(cx,cy,73,a0);
          drawBadge(group,orbit[0],orbit[1],6.8,c,kinds[z%kinds.length],.56);
        }
      }else{
        drawCircle(group,cx,cy,45,"none",c,1,.37);
        drawCircle(group,cx+22,cy-7,3,c,"none",0,.8);
        drawLine(group,[cx,cy],[cx+22,cy-7],c,.9,.43);
      }
      var titleY=cy-60;
      drawPlaque(group,cx,titleY,p.name,c,"middle");
      drawText(group,cx,titleY,p.name,c,8,"middle",{class:"node-label"});
      var num=state.expanded?p.files:Math.min(p.files,12),fileSpots=[];
      for(var j=0;j<num;j++){
        var theta=random(i*111+j+6)*6.283,spread=Math.sqrt(random(j+12+i*50))*Math.min(110,r*.8),pt=polar(cx,cy,spread,theta);
        drawCircle(group,pt[0],pt[1],.8+random(j+9)*1.8,c,"none",0,.3+random(j+11)*.55);
        if(j%5===0)fileSpots.push({pt:pt,file:demoFile(p,i,j)});
        if(((state.names&&state.zoom>1.6)||state.zoom>2.2)&&j%12===0){
          drawText(group,pt[0]+6,pt[1]-4,demoFile(p,i,j).name,c,6,"start",{opacity:".7"});
        }
      }
      for(var k=0;k<6;k++){
        var edge=polar(cx,cy,r,Math.PI/3*k+Math.PI/6);
        drawBadge(group,edge[0],edge[1],9,c,kinds[(i+k)%kinds.length],.56);
        attachNode(drawCircle(group,edge[0],edge[1],11,"transparent","none",0,1),p,"file");
      }
      attachNode(drawCircle(group,cx,cy,Math.min(43,r*.42),"transparent","none",0,1),p,"group");
      fileSpots.forEach(function(x){attachNode(drawCircle(group,x.pt[0],x.pt[1],5.8,"transparent","none",0,1),x.file,"file");});
    });
  }
  function forceLayout(parent){
    drawStars(parent,160);
    var spots=[];
    projects.forEach(function(p,i){
      var a=rad(i*137.508+state.angle*30),dist=90+Math.sqrt(i/20)*360,pos=polar(535,455,dist,a);
      pos[0]+=Math.sin(i*4)*25;pos[1]+=Math.cos(i*3)*25;spots.push(pos);
    });
    spots.forEach(function(pt,i){
      var p=projects[i],col=accent(p.color),match=matchSearch(p.name);
      for(var j=0;j<2;j++){
        var other=spots[(i+1+j*6)%spots.length];
        drawLine(parent,pt,other,col,.8,match?.14:.02);
      }
    });
    spots.forEach(function(pos,i){
      var p=projects[i],col=accent(p.color);
      var group=svg("g",{opacity:matchSearch(p.name)?1:.1},parent);
      var radius=15+p.files*.20+state.size*15;
      drawCircle(group,pos[0],pos[1],radius,"#0a2029",col,1,.48);
      for(var j=0;j<(state.expanded?p.files:12);j++){
        var a=random(j+i*73)*6.283,rr=Math.sqrt(random(j*3+i*40))*radius*1.8,pt=polar(pos[0],pos[1],rr,a);
        drawCircle(group,pt[0],pt[1],1+random(j+i)*1.7,col,"none",0,.4+random(j+1)*.6);
      }
      drawText(group,pos[0],pos[1]-radius-12,p.name,col,8,"middle",{class:"node-label"});
      attachNode(drawCircle(group,pos[0],pos[1],radius,"transparent","none",0,1),p,"group");
    });
  }
  function updateTransform(){
    var width=window.innerWidth,baseX=(width>=641&&width<=950)?190:0;
    $("mapViewport").setAttribute("transform","translate("+(state.panX+baseX)+" "+state.panY+") translate(550 460) scale("+state.zoom+") translate(-550 -460)");
  }
  function renderBrain(transition){
    ensureBackdrop();
    var group=$("mapViewport");
    clearHoverLinks();
    var stale=$("previousMap");if(stale)stale.remove();
    if(transition&&group.childNodes.length&&!window.matchMedia("(prefers-reduced-motion: reduce)").matches){
      var old=group.cloneNode(true);
      old.id="previousMap";
      old.setAttribute("pointer-events","none");
      old.classList.add("graph-exit");
      group.parentNode.insertBefore(old,group);
      setTimeout(function(){if(old.parentNode)old.remove();},480);
    }
    group.classList.remove("graph-enter");
    group.textContent="";
    if(state.layout==="rings")rings(group);
    else if(state.layout==="circle")circleLayout(group);
    else if(state.layout==="hex")hexLayout(group);
    else forceLayout(group);
    if(state.hud){
      drawText(group,40,42,"TRACKTOR / ВТОРОЙ МОЗГ",accent(0),10,"start",{opacity:".5"});
      drawText(group,40,60,"РЕЖИМ: "+({rings:"КОЛЬЦА",circle:"КРУГ",hex:"СОТЫ",force:"СИЛОВАЯ"}[state.layout])+" · ФАЙЛОВ: 2209",accent(2),8,"start",{opacity:".4"});
      drawText(group,1060,875,"MAX MUNHOZ · ИНТЕРАКТИВНАЯ КАРТА","#476574",9,"end");
    }
    updateTransform();
    hideDetails();
    if(transition&&!window.matchMedia("(prefers-reduced-motion: reduce)").matches){
      void group.getBoundingClientRect();
      group.classList.add("graph-enter");
    }
  }
  function openBrain(query){
    state.page="brain";
    var firstOpening=!brainLoadedOnce;
    $("app").classList.replace("mode-command","mode-brain");
    if(!brainLoadedOnce){
      brainLoadedOnce=true;
      clearTimeout(loaderTimer);
      clearTimeout(revealTimer);
      $("brainLoader").classList.remove("hidden");
      $("mapViewport").classList.remove("brain-first-appearance");
      $("brainSettings").classList.remove("brain-settings-appearance");
      loaderTimer=setTimeout(function(){
        $("brainLoader").classList.add("hidden");
        if(state.page==="brain")$("systemLabel").textContent="2209 ФАЙЛОВ · 137 ПРОЦЕССОВ";
        if(state.page==="brain"&&!window.matchMedia("(prefers-reduced-motion: reduce)").matches){
          $("mapViewport").classList.add("brain-first-appearance");
          $("brainSettings").classList.add("brain-settings-appearance");
          revealTimer=setTimeout(function(){
            $("mapViewport").classList.remove("brain-first-appearance");
            $("brainSettings").classList.remove("brain-settings-appearance");
          },1700);
        }
      },620);
    }
    $("commandPage").hidden=true;$("brainPage").hidden=false;
    $("brandSection").textContent="Второй мозг";
    $("brandSubtitle").textContent="АВТОР: MAX MUNHOZ";
    $("systemLabel").textContent=firstOpening?"ЗАГРУЗКА КАРТЫ":"2209 ФАЙЛОВ · 137 ПРОЦЕССОВ";
    state.focus=null;
    if(query){
      $("fileSearch").value=query;
      state.search=query;
    }else{
      $("fileSearch").value="";
      state.search="";
    }
    renderBrain();
  }
  function openCommand(){
    state.page="command";
    clearTimeout(loaderTimer);
    clearTimeout(revealTimer);
    $("mapViewport").classList.remove("brain-first-appearance");
    $("brainSettings").classList.remove("brain-settings-appearance");
    $("brainLoader").classList.add("hidden");
    $("app").classList.replace("mode-brain","mode-command");
    $("brainPage").hidden=true;$("commandPage").hidden=false;
    hideClient();
    $("brandSection").textContent="Командный центр";
    $("brandSubtitle").textContent="MAX MUNHOZ · АГЕНТ 05";
    document.body.classList.remove("presenting");
    renderCommand();
    updateClock();
  }
  function setLayout(name){
    state.layout=name;
    document.querySelectorAll("[data-layout]").forEach(function(e){e.classList.toggle("active",e.dataset.layout===name);});
    resetPosition();
    renderBrain(true);
  }
  function setView(name){
    state.view=name;
    document.querySelectorAll("[data-view]").forEach(function(e){e.classList.toggle("active",e.dataset.view===name);});
    renderBrain(true);
  }
  function setRange(id,value,decimals){
    var e=$(id);e.value=value;
    $(id+"Value").textContent=Number(value).toFixed(decimals);
    var fraction=(value-Number(e.min))/(Number(e.max)-Number(e.min));
    e.style.setProperty("--fill",(fraction*100)+"%");
  }
  function resetPosition(){state.zoom=1;state.panX=0;state.panY=0;updateTransform();}
  function changeZoom(factor,mouseX,mouseY){
    var before=state.zoom,after=clamp(before*factor,.4,5.5);
    if(after===before)return;
    if(typeof mouseX==="number"&&typeof mouseY==="number"){
      var rect=$("brainSvg").getBoundingClientRect();
      var unit=Math.min(rect.width/1100,rect.height/920);
      var insetX=(rect.width-1100*unit)/2,insetY=(rect.height-920*unit)/2;
      var targetX=(mouseX-rect.left-insetX)/unit,targetY=(mouseY-rect.top-insetY)/unit;
      var baseX=(window.innerWidth>=641&&window.innerWidth<=950)?190:0;
      state.panX+=(before-after)*(targetX-baseX-state.panX-550)/before;
      state.panY+=(before-after)*(targetY-state.panY-460)/before;
    }
    state.zoom=after;
    updateTransform();
    // Rebuild file captions only when crossing a visibility threshold.
    // Otherwise preserve the SVG and keep zoom smooth.
    var band=function(z){return z>2.2?2:state.names&&z>1.55?1:0;};
    if(band(before)!==band(after))renderBrain();
  }
  function bind(){
    $("brandButton").addEventListener("click",openCommand);
    ["navBrain","navPower","openBrainButton"].forEach(function(id){$(id).addEventListener("click",function(){openBrain();});});
    $("navBack").addEventListener("click",openCommand);
    $("closeClientModal").addEventListener("click",hideClient);
    $("clientCloseButton").addEventListener("click",hideClient);
    $("clientModal").addEventListener("click",function(ev){if(ev.target===this)hideClient();});
    $("clientOpenBrain").addEventListener("click",function(){
      var title=selectedClient?selectedClient[0]:"";
      hideClient();
      if(projects.some(function(p){return p.name.toLowerCase().includes(title.toLowerCase());}))openBrain(title);
      else {openBrain();notify("Карта открыта. Данные этого клиента в демоверсии ограничены");}
    });
    $("navContact").addEventListener("click",function(){notify("Контакты: подключение к серверу недоступно в демоверсии");});
    $("navSearch").addEventListener("click",function(){openBrain();$("fileSearch").focus();});
    $("navRefresh").addEventListener("click",function(){renderCommand();notify("Панель обновлена");});
    $("navTraffic").addEventListener("click",function(){openBrain();notify("Раздел трафика (демо)");});
    $("navFred").addEventListener("click",function(){openBrain();notify("Обзор файлов");});
    $("navPresent").addEventListener("click",function(){
      var active=!document.body.classList.contains("presenting");
      document.body.classList.toggle("presenting",active);
      if(active&&document.documentElement.requestFullscreen)document.documentElement.requestFullscreen().catch(function(){});
      if(!active&&document.fullscreenElement&&document.exitFullscreen)document.exitFullscreen().catch(function(){});
    });
    $("navMenu").addEventListener("click",function(){
      var menu=$("headerMenu");menu.classList.toggle("hidden");
      $("navMenu").setAttribute("aria-expanded",String(!menu.classList.contains("hidden")));
    });
    $("headerMenu").addEventListener("click",function(e){
      var b=e.target.closest("button");if(!b)return;
      $("headerMenu").classList.add("hidden");$("navMenu").setAttribute("aria-expanded","false");
      if(b.dataset.menu==="command")openCommand();
      else if(b.dataset.menu==="brain")openBrain();
      else if(b.dataset.menu==="reset"){resetPosition();renderBrain();}
      else $("shortcuts").classList.remove("hidden");
    });
    document.querySelectorAll("[data-layout]").forEach(function(b){b.addEventListener("click",function(){setLayout(b.dataset.layout);});});
    document.querySelectorAll("[data-view]").forEach(function(b){b.addEventListener("click",function(){setView(b.dataset.view);});});
    [["ringAngle","angle",2],["ringForce","force",3],["mapSize","size",2]].forEach(function(row){
      $(row[0]).addEventListener("input",function(ev){
        state[row[1]]=Number(ev.target.value);
        setRange(row[0],state[row[1]],row[2]);
        renderBrain();
      });
    });
    $("fileNames").addEventListener("change",function(e){state.names=e.target.checked;renderBrain();});
    $("plaqueToggle").addEventListener("click",function(){
      state.plaque=!state.plaque;
      this.classList.toggle("active",state.plaque);
      this.setAttribute("aria-pressed",String(state.plaque));
      renderBrain();
    });
    $("hudToggle").addEventListener("click",function(){
      state.hud=!state.hud;
      this.classList.toggle("active",state.hud);
      this.setAttribute("aria-pressed",String(state.hud));
      renderBrain();
    });
    $("fileSearch").addEventListener("input",function(e){state.search=e.target.value;state.focus=null;renderBrain();});
    $("expandAll").addEventListener("click",function(){state.expanded=true;renderBrain();});
    $("collapseAll").addEventListener("click",function(){state.expanded=false;renderBrain();});
    ["recenter","zoomReset"].forEach(function(id){$(id).addEventListener("click",function(){resetPosition();renderBrain();});});
    $("zoomIn").addEventListener("click",function(){changeZoom(1.24);});
    $("zoomOut").addEventListener("click",function(){changeZoom(1/1.24);});
    $("saveSettings").addEventListener("click",function(){
      try{
        var prefs={};
        ["layout","view","angle","force","size","names","theme","hud","plaque"].forEach(function(k){prefs[k]=state[k];});
        localStorage.setItem("tracktor-preferences",JSON.stringify(prefs));
        $("saveFeedback").textContent="✓ Настройки сохранены в браузере";
      }catch(e){$("saveFeedback").textContent="Не удалось сохранить настройки"; }
    });
    $("exportPng").addEventListener("click",exportPNG);
    $("brainSvg").addEventListener("dblclick",function(e){
      e.preventDefault();
      if(!dragged)changeZoom(1.9,e.clientX,e.clientY);
    });
    $("brainSvg").addEventListener("wheel",function(e){
      e.preventDefault();
      changeZoom(e.deltaY<0?1.1:1/1.1,e.clientX,e.clientY);
    },{passive:false});
    // Drag uses the actual SVG viewBox scale; two simultaneous touch pointers
    // provide pinch-to-zoom without changing the fixed settings panel.
    var activePointers=new Map(),pinch=null;
    $("brainSvg").addEventListener("pointerdown",function(e){
      if(e.button!==0&&e.pointerType==="mouse")return;
      activePointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(activePointers.size>=2){
        var ps=Array.from(activePointers.values());
        pinch={distance:Math.hypot(ps[1].x-ps[0].x,ps[1].y-ps[0].y)};
        drag=null;dragged=true;hideDetails();clearHoverLinks();
      }else{
        pinch=null;
        drag={x:e.clientX,y:e.clientY,startX:state.panX,startY:state.panY};
        dragged=false;
      }
      e.currentTarget.setPointerCapture(e.pointerId);
      e.currentTarget.classList.add("dragging");
    });
    $("brainSvg").addEventListener("pointermove",function(e){
      if(!activePointers.has(e.pointerId))return;
      activePointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(activePointers.size>=2){
        var ps=Array.from(activePointers.values());
        var distance=Math.hypot(ps[1].x-ps[0].x,ps[1].y-ps[0].y);
        var centerX=(ps[0].x+ps[1].x)/2,centerY=(ps[0].y+ps[1].y)/2;
        if(pinch&&pinch.distance>1&&distance>1)changeZoom(distance/pinch.distance,centerX,centerY);
        pinch={distance:distance};
        dragged=true;hideDetails();clearHoverLinks();
        return;
      }
      if(!drag)return;
      var dx=e.clientX-drag.x,dy=e.clientY-drag.y;
      if(Math.abs(dx)+Math.abs(dy)>6)dragged=true;
      var rect=this.getBoundingClientRect();
      var unit=Math.min(rect.width/1100,rect.height/920);
      state.panX=drag.startX+dx/unit;
      state.panY=drag.startY+dy/unit;
      updateTransform();
      if(dragged){hideDetails();clearHoverLinks();}
    });
    function stopDrag(e){
      activePointers.delete(e.pointerId);
      if(activePointers.size===1){
        var remaining=Array.from(activePointers.values())[0];
        drag={x:remaining.x,y:remaining.y,startX:state.panX,startY:state.panY};
        pinch=null;dragged=true;
      }else if(activePointers.size===0){
        drag=null;pinch=null;
        e.currentTarget.classList.remove("dragging");
        setTimeout(function(){if(activePointers.size===0)dragged=false;},100);
      }
    }
    $("brainSvg").addEventListener("pointerup",stopDrag);
    $("brainSvg").addEventListener("pointercancel",stopDrag);
    $("brainSvg").addEventListener("click",function(e){if(!dragged&&(e.target===$("brainSvg")||e.target===$("mapViewport"))){state.focus=null;hideDetails();clearHoverLinks();renderBrain();}});
    $("closeShortcuts").addEventListener("click",function(){$("shortcuts").classList.add("hidden");});
    $("shortcuts").addEventListener("click",function(e){if(e.target===this)this.classList.add("hidden");});
    document.addEventListener("keydown",function(e){
      if(e.key==="Escape"){
        hideClient();
        $("shortcuts").classList.add("hidden");$("headerMenu").classList.add("hidden");hideDetails();clearHoverLinks();if(state.focus){state.focus=null;renderBrain();$("canvasHint").textContent="ПЕРЕТАСКИВАНИЕ — ПЕРЕМЕСТИТЬ · КОЛЕСО — МАСШТАБ · КЛИК — ФИЛЬТР";}
        if(document.body.classList.contains("presenting")){document.body.classList.remove("presenting");if(document.fullscreenElement&&document.exitFullscreen)document.exitFullscreen().catch(function(){});}
        return;
      }
      var typing=/INPUT|TEXTAREA/.test(document.activeElement.tagName);
      if(e.key==="/"&&!typing&&state.page==="brain"){e.preventDefault();$("fileSearch").focus();}
      if(typing)return;
      if(state.page==="brain"){
        if(e.key==="+"||e.key==="=")changeZoom(1.2);
        if(e.key==="-")changeZoom(1/1.2);
        if(e.key==="0"){resetPosition();renderBrain();}
        if(e.key==="?")$("shortcuts").classList.remove("hidden");
      }
    });
  }
  function exportPNG(){
    var source=$("brainSvg"),clone=source.cloneNode(true);
    clone.setAttribute("xmlns",NS);clone.setAttribute("width","1100");clone.setAttribute("height","920");
    var bg=document.createElementNS(NS,"rect");
    bg.setAttribute("width","1100");bg.setAttribute("height","920");bg.setAttribute("fill",theme().bg);
    clone.insertBefore(bg,clone.firstChild);
    var xml=new XMLSerializer().serializeToString(clone);
    var url=URL.createObjectURL(new Blob([xml],{type:"image/svg+xml;charset=utf-8"}));
    var image=new Image();
    image.onload=function(){
      var canvas=document.createElement("canvas");canvas.width=2200;canvas.height=1840;
      var ctx=canvas.getContext("2d");ctx.drawImage(image,0,0,2200,1840);
      URL.revokeObjectURL(url);
      canvas.toBlob(function(blob){
        if(!blob){notify("Не удалось создать PNG");return;}
        var a=document.createElement("a"),temp=URL.createObjectURL(blob);
        a.href=temp;a.download="tracktor-segundo-cerebro.png";document.body.appendChild(a);a.click();a.remove();
        setTimeout(function(){URL.revokeObjectURL(temp);},500);
        notify("PNG сохранён");
      },"image/png");
    };
    image.onerror=function(){URL.revokeObjectURL(url);notify("Не удалось экспортировать карту");};
    image.src=url;
  }
  function restoreUI(){
    document.querySelectorAll("[data-layout]").forEach(function(e){e.classList.toggle("active",e.dataset.layout===state.layout);});
    document.querySelectorAll("[data-view]").forEach(function(e){e.classList.toggle("active",e.dataset.view===state.view);});
    setRange("ringAngle",state.angle,2);setRange("ringForce",state.force,3);setRange("mapSize",state.size,2);
    $("fileNames").checked=state.names;
    $("hudToggle").classList.toggle("active",state.hud);
    $("hudToggle").setAttribute("aria-pressed",String(state.hud));
    $("plaqueToggle").classList.toggle("active",state.plaque);
    $("plaqueToggle").setAttribute("aria-pressed",String(state.plaque));
  }
  readSaved();renderHeaderIcons();renderWallet();renderFunnel();renderSkills();renderRoutines();renderTeam();renderCalendar();renderThemes();restoreUI();renderCommand();bind();
  updateClock();setInterval(updateClock,1000);
  if(location.hash==="#cerebro"||location.hash==="#brain")openBrain();
})();