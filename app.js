/* TRACKTOR interactive recreation — dependency-free JavaScript */
(function () {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  var $ = function (id) { return document.getElementById(id); };
  var accounts = [
    ["Miranda Seguros","500","tráfego, site e site","green"],
    ["Tojiro Mooca","2.200","tráfego · chega de...","green"],
    ["Tojiro Zona Norte","1.500","tráfego · chega de...","green"],
    ["Instituto Bella Face - SER","850/895","serviços Tractor","red"],
    ["Mecânica Primus","690","tráfego e site","red"],
    ["Total Protege","1.000","tráfego","grey"],
    ["Sr Man Barber Shop","1.000","tráfego","red"],
    ["Expo Peças","","produção","green"],
    ["Potecitamente","","tráfego · chega de...","green"],
    ["Daiane Rosendo Advocacia","","Google Ads · Mídia...","green"],
    ["Grupo Centurião","3.200","marca e produção","red"],
    ["Grupo PMS","2.500","sistema e produção","red"],
    ["T-Motors","1.850","sistema","red"],
    ["Escrita com Ciência","","tráfego","grey"],
    ["Hellen Gestão","","tráfego","green"],
    ["Jacque Gomes","","conteúdo","green"],
    ["Maison Estética Sudoeste","","tráfego","red"],
    ["Pissolatti Vinhos","","tráfego","green"],
    ["drafernanda","","","grey"]
  ];
  var projects = [
    {name:"TRACTOR",files:49,color:0},
    {name:"MAIN FRAME",files:64,color:0},
    {name:"SR RAN BARBER SHOP",files:38,color:1},
    {name:"INSTITUTO BELLA FACE - SER",files:42,color:2},
    {name:"GRUPO CENTURIÃO",files:52,color:3},
    {name:"DAIANE ROSENDO ADVOCACIA",files:54,color:0},
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
    {name:"SKILLS",files:95,color:0},
    {name:"TOTAL PROTEGE",files:30,color:3},
    {name:"MOTOR",files:29,color:1}
  ];
  var themes = [
    {name:"Metálico Tracktor",colors:["#9ad1d0","#d7bd84","#b76a83","#816cae","#e09f7d","#b4d9eb"],accent:"#45d9b6",rgb:"69,217,182",bg:"#07131b"},
    {name:"Rubric",colors:["#e7cfb2","#e69c70","#c64d5a","#ae3b6d","#e25daa","#a6b5e3"],accent:"#ef986b",rgb:"239,152,107",bg:"#161019"},
    {name:"Oceano",colors:["#43e0b3","#63cdb6","#8cbadb","#668bc9","#917cdb","#e7b577"],accent:"#36dfb7",rgb:"54,223,183",bg:"#07111b"},
    {name:"Neon",colors:["#f1c5ff","#ffeb67","#d4f467","#83e656","#fa42ba","#36dbea"],accent:"#d1fa5c",rgb:"209,250,92",bg:"#0a101b"},
    {name:"Bordô",colors:["#e5b5b5","#d99299","#a75a75","#b47894","#dfad8c","#d6c8b0"],accent:"#e2a1aa",rgb:"226,161,170",bg:"#160f19"},
    {name:"Papel",colors:["#a6b5c5","#c59c53","#6a7da2","#b98e6e","#7f6d9e","#879c9d"],accent:"#cfac77",rgb:"207,172,119",bg:"#151a21"}
  ];
  var state = {
    page:"command",layout:"rings",view:"departments",angle:0.25,
    force:0.02,size:0.40,names:false,theme:"Oceano",expanded:true,
    zoom:1,panX:0,panY:0,search:"",hud:false,selected:null
  };
  var drag = null, dragged = false, timerToast = 0;
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
        ["layout","view","angle","force","size","names","theme","hud"].forEach(function(k){
          if(Object.prototype.hasOwnProperty.call(value,k))state[k]=value[k];
        });
      }
    }catch(e){}
    if(!["rings","circle","hex","force"].includes(state.layout))state.layout="rings";
    if(!["departments","folders"].includes(state.view))state.view="departments";
    if(!themes.some(function(t){return t.name===state.theme;}))state.theme="Oceano";
  }
  function applyTheme(){
    var t=theme();
    document.documentElement.style.setProperty("--accent",t.accent);
    document.documentElement.style.setProperty("--accent-rgb",t.rgb);
    document.documentElement.style.setProperty("--bg",t.bg);
    document.querySelectorAll(".theme-item").forEach(function(e){e.classList.toggle("selected",e.dataset.theme===t.name);});
  }
  function renderThemes(){
    var holder=$("themeList");holder.textContent="";
    themes.forEach(function(t){
      var item=dom("button","theme-item",undefined,holder);
      item.type="button";item.dataset.theme=t.name;
      var strip=dom("span","theme-strip",undefined,item);
      t.colors.forEach(function(c){var dot=dom("i","",undefined,strip);dot.style.backgroundColor=c;});
      dom("span","theme-label",t.name,item);
      if(t.name==="Oceano")dom("small","", "EM USO",item);
      item.addEventListener("click",function(){state.theme=t.name;applyTheme();renderThemes();renderBrain();renderCommand();});
    });
    applyTheme();
  }
  function renderWallet(){
    var holder=$("walletList");holder.textContent="";
    accounts.forEach(function(a,i){
      var row=dom("div","wallet-item",undefined,holder);
      dom("span","wallet-dot",undefined,row);
      var block=dom("span","wallet-client",undefined,row);
      dom("div","wallet-name",a[0],block);
      dom("div","wallet-sub",a[2]||"em acompanhamento",block);
      var right=dom("span","wallet-aside",undefined,row);
      if(a[1])dom("span","wallet-money","R$ "+a[1],right);
      dom("span","wallet-pill",i%7===2?"SITE":"▸ TRÁFEGO",right);
      row.title="Visualizar "+a[0];
      row.style.cursor="pointer";
      row.addEventListener("click",function(){openBrain(a[0]);});
    });
    var alerts=$("alertItems");alerts.textContent="";
    ["Cópia solicitada pelo motor","Nova rotina do conteúdo","3 itens aguardam revisão"].forEach(function(t,i){
      var e=dom("div","",undefined,alerts);dom("b","","0"+(i+1),e);e.appendChild(document.createTextNode(t));
    });
  }
  function renderTeam(){
    var grid=$("teamGrid");grid.textContent="";
    for(var i=0;i<154;i++){
      var active=random(i*5+8)>.66 || i>132&&random(i)>.34;
      var item=dom("span","team-cell"+(active?" active":"")+(i%9===0?" alt":""),undefined,grid);
      dom("span","",active?(i%4===0?"◇":i%6===0?"⌁":"◦"):"·",item);
      item.title=active?"Agente ativo":"Agente em espera";
    }
  }
  function updateClock(){
    var now=new Date();
    try{
      var t=new Intl.DateTimeFormat("pt-BR",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false,timeZone:"America/Sao_Paulo"}).format(now);
      var day=new Intl.DateTimeFormat("pt-BR",{weekday:"short",day:"numeric",month:"short",year:"numeric",timeZone:"America/Sao_Paulo"}).format(now);
      $("liveClock").textContent=t;
      $("liveDate").textContent=day.toUpperCase();
      $("systemLabel").textContent="SINCRONIZADO "+t.slice(0,5);
    }catch(e){$("liveClock").textContent=now.toLocaleTimeString("pt-BR");}
  }
  function renderCalendar(){
    var holder=$("miniCalendar");holder.textContent="";
    ["D","S","T","Q","Q","S","S"].forEach(function(x){dom("span","",x,holder);});
    var now=new Date(),weekday=(now.getDay()+6)%7;
    for(var j=0;j<14;j++){
      var day=now.getDate()+j-weekday;
      dom("span",day===now.getDate()?"today":"",String(day),holder);
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
      svg("circle",{cx:xy[0],cy:xy[1],r:random(i+99)*2+.5,fill:i%8===0?accent(1):accent(i%3),opacity:.28+random(i+33)*.6},root);
    }
    for(var j=0;j<38;j++){
      var angle=-Math.PI/2+Math.PI*2*j/38,pt=polar(cx,cy,355,angle);
      svg("circle",{cx:pt[0],cy:pt[1],r:21,fill:"#0e1c2b",stroke:"#293747","stroke-width":1.1,opacity:.88},root);
      svg("circle",{cx:pt[0],cy:pt[1],r:8,fill:"none",stroke:"#365265","stroke-width":.8,opacity:.8},root);
      svg("text",{x:pt[0],y:pt[1]+3,"text-anchor":"middle",fill:"#6f8798","font-family":"var(--mono)","font-size":"8"},root,j%5===0?"1":j%3===0?"◇":"?");
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
      hit.addEventListener("click",function(){openBrain(ac[0]);});
      hit.appendChild(svg("title",{},null,ac[0]));
    });
    for(var q=0;q<140;q++){
      var an=random(q+550)*6.283,rr2=60+random(q+350)*110,xy2=polar(cx,cy,rr2,an);
      svg("circle",{cx:xy2[0],cy:xy2[1],r:.55+random(q+933)*1.45,fill:accent(q%6),opacity:random(q+441)*.35},root);
    }
    svg("text",{x:cx,y:cy+79,"text-anchor":"middle",fill:"#426774","font-family":"var(--mono)","font-size":"9","letter-spacing":"3"},root,"TRACKTOR");
  }
  function matchSearch(name){
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
    var attrs={x:x,y:y,fill:color,"font-size":size||9,"font-family":"DM Mono, ui-monospace, monospace","letter-spacing":".03em","text-anchor":anchor||"middle"};
    if(extra)Object.keys(extra).forEach(function(k){attrs[k]=extra[k];});
    return svg("text",attrs,parent,str);
  }
  function attachNode(e,p,type){
    e.classList.add(type==="file"?"file-node":"group-node");
    e.setAttribute("data-name",p.name);
    if(!matchSearch(p.name))e.setAttribute("opacity",".09");
    var title=svg("title",{},e,p.name);
    e.addEventListener("click",function(ev){
      if(dragged)return;
      ev.stopPropagation();
      state.selected=p;
      showDetails(ev,p);
    });
    return e;
  }
  function showDetails(ev,p){
    var box=$("mapTooltip"),rect=$("brainSvg").getBoundingClientRect(),canvas=$("brainPage").getBoundingClientRect();
    box.textContent="";
    var h=dom("strong","",undefined,box),dot=dom("i","tip-dot",undefined,h);
    dot.style.background=accent(p.color||0);h.appendChild(document.createTextNode(p.name));
    dom("small","",String(p.files||30)+" arquivos · "+(state.view==="departments"?"departamento":"pasta"),box);
    dom("small","", "Clique em outro nó para explorar",box);
    var x=ev.clientX-canvas.left+12,y=ev.clientY-canvas.top+12;
    x=clamp(x,10,Math.max(10,rect.width-box.offsetWidth-30));
    y=clamp(y,8,Math.max(8,rect.height-105));
    box.style.left=x+"px";box.style.top=y+"px";box.classList.remove("hidden");
  }
  function hideDetails(){$("mapTooltip").classList.add("hidden");state.selected=null;}
  function drawCenter(parent,cx,cy){
    drawCircle(parent,cx,cy,83,"none","#30434c",1,.52);
    drawCircle(parent,cx,cy,60,"#091a25","#245b5b",1,.8);
    drawCircle(parent,cx,cy,44,"none",accent(0),1.4,.93);
    drawCircle(parent,cx,cy,22,"none","#b2caca",1.1,.7);
    drawCircle(parent,cx+5,cy-4,14,"none","#91b4bd",.9,.95);
    drawCircle(parent,cx-5,cy+2,11,"none","#9cb6b9",1,.65);
    drawText(parent,cx,cy+74,"CLAUDE.MD","#789aa3",9,"middle",{"letter-spacing":"2"});
    attachNode(drawCircle(parent,cx,cy,46,"transparent","none",0,1),{name:"CLAUDE.MD",files:1,color:0},"group");
  }
  function drawStars(parent,count){
    for(var i=0;i<count;i++){
      var x=55+random(i*11+800)*990,y=44+random(i*7+550)*825;
      drawCircle(parent,x,y,.4+random(i+60)*.8,accent(i%4),"none",0,.07+random(i+88)*.2);
    }
  }
  function rings(parent){
    var cx=545,cy=467;
    drawStars(parent,190);
    [100,165,305,383,420,451].forEach(function(r,i){
      drawCircle(parent,cx,cy,r,"none","#4c6370",i===5?1:.65,i===3?.30:i===5?.34:.18);
    });
    drawCenter(parent,cx,cy);
    var angles=[-90,-114,-75,-58,-42,-26,-10,5,19,34,49,65,88,105,122,140,158,180,202,237];
    projects.forEach(function(p,i){
      var a=rad(angles[i]+state.angle*22),col=accent(p.color);
      var spotlight=matchSearch(p.name);
      var from=polar(cx,cy,103,a),to=polar(cx,cy,296,a);
      drawLine(parent,from,to,col,.6,spotlight?.17:.025);
      var cluster=svg("g",{opacity:spotlight?1:.1},parent);
      for(var j=0;j<p.files;j++){
        var band=j%9,level=Math.floor(j/9);
        var rr=172+level*13+random(j*i+47)*10;
        var dx=(band-4)*.018 +(random(i*500+j)-.5)*.012;
        var pt=polar(cx,cy,rr,a+dx),r=.95+random(j+i*9)*1.55;
        drawCircle(cluster,pt[0],pt[1],r,col,"none",0,.38+random(j+17)*.56);
      }
      var l=polar(cx,cy,327,a),isLeft=Math.cos(a)<-.2;
      var label=drawText(cluster,l[0],l[1],p.name,col,8,isLeft?"end":Math.cos(a)>.2?"start":"middle");
      label.setAttribute("class","node-label");
      var nodePoint=polar(cx,cy,272,a);
      attachNode(drawCircle(cluster,nodePoint[0],nodePoint[1],12,"transparent","none",0,1),p,"group");
    });
    for(var k=0;k<178;k++){
      var angle=rad(-172+k*344/177)+state.angle*.035;
      var rr=(k%3===0?451:k%3===1?423:399),pt=polar(cx,cy,rr,angle);
      var parentGroup=projects[k%projects.length],col=accent(Math.floor(k/20)%6);
      if(k%9===0){drawLine(parent,polar(cx,cy,365,angle),pt,"#466270",.6,.23);}
      var node=drawCircle(parent,pt[0],pt[1],k%7===0?8:7,"#0c1925",col,.8,.30+k%3*.07);
      drawCircle(parent,pt[0],pt[1],2,"none",col,.65,.55);
      attachNode(drawCircle(parent,pt[0],pt[1],8,"transparent","none",0,1),parentGroup,"file");
    }
    if(!state.expanded){
      svg("rect",{x:0,y:0,width:1,height:1,fill:"none"},parent);
    }
  }
  function circleLayout(parent){
    var cx=545,cy=455;
    drawStars(parent,180);
    [120,245,335].forEach(function(r){drawCircle(parent,cx,cy,r,"none","#35515d",.8,.25);});
    drawCenter(parent,cx,cy);
    projects.forEach(function(p,i){
      var a=rad(-90+i*360/projects.length)+state.angle*.18;
      var radius=285+Math.sin(i*1.9)*45,pos=polar(cx,cy,radius,a),col=accent(p.color);
      var size=22+(p.files/5)*state.size;
      drawLine(parent,polar(cx,cy,90,a),pos,col,.7,.28);
      drawCircle(parent,pos[0],pos[1],size,"#0d202b",col,1,.40);
      drawCircle(parent,pos[0],pos[1],size*.72,"none",col,.8,.17);
      for(var j=0;j<(state.expanded?p.files:Math.round(p.files*.25));j++){
        var th=random(i*400+j)*Math.PI*2,rr=Math.sqrt(random(i*200+j+22))*size*.7,pt=polar(pos[0],pos[1],rr,th);
        drawCircle(parent,pt[0],pt[1],1.1+random(j+7)*1.7,col,"none",0,.42+random(j+8)*.5);
      }
      drawText(parent,pos[0],pos[1]-size-10,p.name,col,8,"middle",{opacity:matchSearch(p.name)?1:.08,class:"node-label"});
      attachNode(drawCircle(parent,pos[0],pos[1],size,"transparent","none",0,1),p,"group");
    });
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
    var count=state.expanded?16:9;
    var scale=.76+state.size*.55;
    for(var i=0;i<count;i++){
      var col=i%4,row=Math.floor(i/4),p=projects[(i*3+4)%projects.length],c=accent(p.color);
      var cx=147+col*264,cy=141+row*223+(col%2)*111,r=148*scale;
      var group=svg("g",{opacity:matchSearch(p.name)?1:.13},parent);
      svg("polygon",{points:hexPath(cx,cy,r),fill:c,"fill-opacity":".045",stroke:c,"stroke-opacity":".23","stroke-width":"1.5",class:"hex-cell"},group);
      svg("polygon",{points:hexPath(cx,cy,r-9),fill:"none",stroke:c,"stroke-opacity":".10","stroke-width":".6"},group);
      drawCircle(group,cx,cy,51,"none",c,.75,.3);
      drawCircle(group,cx,cy,22,"none",c,1,.45);
      drawCircle(group,cx,cy,5,c,"none",0,.65);
      drawText(group,cx,cy-65,p.name,c,8,"middle",{class:"node-label"});
      for(var j=0;j<(state.expanded?p.files:15);j++){
        var a=random(i*111+j+6)*6.283,rr=16+Math.sqrt(random(j+12+i*50))*90,pt=polar(cx,cy,rr,a);
        drawCircle(group,pt[0],pt[1],.8+random(j+9)*1.5,c,"none",0,.2+random(j+11)*.6);
      }
      for(var k=0;k<6;k++){
        var pt2=polar(cx,cy,r,Math.PI/3*k+Math.PI/6);
        drawCircle(group,pt2[0],pt2[1],8,"#0c1b28",c,1,.55);
      }
      attachNode(drawCircle(group,cx,cy,Math.max(35,r*.5),"transparent","none",0,1),p,"group");
    }
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
    $("mapViewport").setAttribute("transform","translate("+state.panX+" "+state.panY+") translate(550 460) scale("+state.zoom+") translate(-550 -460)");
  }
  function renderBrain(){
    var group=$("mapViewport");group.textContent="";
    if(state.layout==="rings")rings(group);
    else if(state.layout==="circle")circleLayout(group);
    else if(state.layout==="hex")hexLayout(group);
    else forceLayout(group);
    if(state.hud){
      drawText(group,40,42,"TRACKTOR / SEGUNDO CÉREBRO",accent(0),10,"start",{opacity:".5"});
      drawText(group,40,60,"MODE: "+state.layout.toUpperCase()+" · ARQUIVOS: 2209",accent(2),8,"start",{opacity:".4"});
      drawText(group,1060,875,"MAX MUNHOZ · INTERACTIVE GRAPH","#476574",9,"end");
    }
    updateTransform();
    hideDetails();
  }
  function openBrain(query){
    state.page="brain";
    $("app").classList.replace("mode-command","mode-brain");
    $("commandPage").hidden=true;$("brainPage").hidden=false;
    $("brandSection").textContent="Segundo Cérebro";
    $("brandSubtitle").textContent="POR MAX MUNHOZ";
    $("systemLabel").textContent="2209 ARQUIVOS · 137 ROTINAS";
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
    $("app").classList.replace("mode-brain","mode-command");
    $("brainPage").hidden=true;$("commandPage").hidden=false;
    $("brandSection").textContent="Comando";
    $("brandSubtitle").textContent="MAX MUNHOZ · AGENTE 05";
    document.body.classList.remove("presenting");
    renderCommand();
    updateClock();
  }
  function setLayout(name){
    state.layout=name;
    document.querySelectorAll("[data-layout]").forEach(function(e){e.classList.toggle("active",e.dataset.layout===name);});
    resetPosition();
    renderBrain();
  }
  function setView(name){
    state.view=name;
    document.querySelectorAll("[data-view]").forEach(function(e){e.classList.toggle("active",e.dataset.view===name);});
    renderBrain();
  }
  function setRange(id,value,decimals){
    var e=$(id);e.value=value;
    $(id+"Value").textContent=Number(value).toFixed(decimals);
    var fraction=(value-Number(e.min))/(Number(e.max)-Number(e.min));
    e.style.setProperty("--fill",(fraction*100)+"%");
  }
  function resetPosition(){state.zoom=1;state.panX=0;state.panY=0;updateTransform();}
  function changeZoom(factor){
    state.zoom=clamp(state.zoom*factor,.4,4);
    updateTransform();
    if(state.names&&state.layout==="rings")renderBrain();
  }
  function bind(){
    $("brandButton").addEventListener("click",openCommand);
    ["navBrain","navPower","openBrainButton"].forEach(function(id){$(id).addEventListener("click",function(){openBrain();});});
    $("navBack").addEventListener("click",openCommand);
    $("navRefresh").addEventListener("click",function(){renderCommand();notify("Painel atualizado");});
    $("navTraffic").addEventListener("click",function(){openBrain("tráfego");});
    $("navFred").addEventListener("click",function(){openBrain();notify("Visão geral de arquivos");});
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
    $("hudToggle").addEventListener("click",function(){state.hud=!state.hud;this.classList.toggle("active",state.hud);renderBrain();});
    $("fileSearch").addEventListener("input",function(e){state.search=e.target.value;renderBrain();});
    $("expandAll").addEventListener("click",function(){state.expanded=true;renderBrain();});
    $("collapseAll").addEventListener("click",function(){state.expanded=false;renderBrain();});
    ["recenter","zoomReset"].forEach(function(id){$(id).addEventListener("click",function(){resetPosition();renderBrain();});});
    $("zoomIn").addEventListener("click",function(){changeZoom(1.24);});
    $("zoomOut").addEventListener("click",function(){changeZoom(1/1.24);});
    $("saveSettings").addEventListener("click",function(){
      try{
        var prefs={};
        ["layout","view","angle","force","size","names","theme","hud"].forEach(function(k){prefs[k]=state[k];});
        localStorage.setItem("tracktor-preferences",JSON.stringify(prefs));
        $("saveFeedback").textContent="✓ Ajustes salvos neste navegador";
      }catch(e){$("saveFeedback").textContent="Não foi possível salvar"; }
    });
    $("exportPng").addEventListener("click",exportPNG);
    $("brainSvg").addEventListener("wheel",function(e){
      e.preventDefault();
      changeZoom(e.deltaY<0?1.1:1/1.1);
    },{passive:false});
    $("brainSvg").addEventListener("pointerdown",function(e){
      if(e.button!==0&&e.pointerType==="mouse")return;
      drag={x:e.clientX,y:e.clientY,startX:state.panX,startY:state.panY};
      dragged=false;
      e.currentTarget.setPointerCapture(e.pointerId);
      e.currentTarget.classList.add("dragging");
    });
    $("brainSvg").addEventListener("pointermove",function(e){
      if(!drag)return;
      var dx=e.clientX-drag.x,dy=e.clientY-drag.y;
      if(Math.abs(dx)+Math.abs(dy)>6)dragged=true;
      var rect=this.getBoundingClientRect();
      state.panX=drag.startX+dx*1100/rect.width;
      state.panY=drag.startY+dy*920/rect.height;
      updateTransform();
      if(dragged)hideDetails();
    });
    function stopDrag(e){drag=null;e.currentTarget.classList.remove("dragging");setTimeout(function(){dragged=false;},60);}
    $("brainSvg").addEventListener("pointerup",stopDrag);
    $("brainSvg").addEventListener("pointercancel",stopDrag);
    $("brainSvg").addEventListener("click",function(e){if(!dragged&&e.target===$("brainSvg"))hideDetails();});
    $("closeShortcuts").addEventListener("click",function(){$("shortcuts").classList.add("hidden");});
    $("shortcuts").addEventListener("click",function(e){if(e.target===this)this.classList.add("hidden");});
    document.addEventListener("keydown",function(e){
      if(e.key==="Escape"){
        $("shortcuts").classList.add("hidden");$("headerMenu").classList.add("hidden");hideDetails();
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
        if(!blob){notify("Falha ao exportar PNG");return;}
        var a=document.createElement("a"),temp=URL.createObjectURL(blob);
        a.href=temp;a.download="tracktor-segundo-cerebro.png";document.body.appendChild(a);a.click();a.remove();
        setTimeout(function(){URL.revokeObjectURL(temp);},500);
        notify("PNG exportado");
      },"image/png");
    };
    image.onerror=function(){URL.revokeObjectURL(url);notify("Não foi possível exportar");};
    image.src=url;
  }
  function restoreUI(){
    document.querySelectorAll("[data-layout]").forEach(function(e){e.classList.toggle("active",e.dataset.layout===state.layout);});
    document.querySelectorAll("[data-view]").forEach(function(e){e.classList.toggle("active",e.dataset.view===state.view);});
    setRange("ringAngle",state.angle,2);setRange("ringForce",state.force,3);setRange("mapSize",state.size,2);
    $("fileNames").checked=state.names;
    $("hudToggle").classList.toggle("active",state.hud);
  }
  readSaved();renderWallet();renderTeam();renderCalendar();renderThemes();restoreUI();renderCommand();bind();
  updateClock();setInterval(updateClock,1000);
  if(location.hash==="#cerebro"||location.hash==="#brain")openBrain();
})();