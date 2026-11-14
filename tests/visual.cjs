/* Browser-level visual regression checks; run with: node tests/visual.cjs
 * Requires: npm install --no-save playwright && npx playwright install chromium
 */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const site = pathToFileURL(path.join(root, 'index.html')).href;
const output = path.join(root, 'artifacts', 'screenshots');
fs.mkdirSync(output, { recursive: true });

function inside(box, width, height, label) {
  assert(box && box.width > 25 && box.height > 20, label + ': пустой блок');
  assert(box.x >= -2 && box.x + box.width <= width + 3,
    label + ': блок обрезан по ширине (' + JSON.stringify(box) + ')');
  assert(box.y >= -2 && box.y < height + 3, label + ': блок вне видимой области');
}
async function inspect(page, width, height, pageName) {
  const topbar = await page.locator('.topbar').boundingBox();
  inside(topbar, width, height, 'Шапка');
  if(pageName==='command') {
    const stage = await page.locator('#commandStage').boundingBox();
    inside(stage, width, height, 'Карта командного центра');
    const left = page.locator('.command-left');
    const right = page.locator('.command-right');
    assert(await left.isVisible(), 'Скрыт блок клиентов');
    assert(await right.isVisible(), 'Скрыта команда и процессы');
    if(width>700){
      const l=await left.boundingBox(), r=await right.boundingBox();
      inside(l,width,height,'Левая панель');
      inside(r,width,height,'Правая панель');
      assert(l.x+l.width<=stage.x+4, 'Левая панель пересекает центральную карту');
      assert(stage.x+stage.width<=r.x+4, 'Центральная карта пересекает правую панель');
    }else{
      const rightState=await right.evaluate(e=>({display:getComputedStyle(e).display, scroll:e.scrollWidth,client:e.clientWidth}));
      assert.notEqual(rightState.display,'none','Правая колонка скрыта на телефоне');
      assert(rightState.scroll>rightState.client,'Карточки правой колонки недоступны для горизонтальной прокрутки');
    }
  }else{
    const canvas=await page.locator('.brain-canvas').boundingBox();
    const settings=await page.locator('#brainSettings').boundingBox();
    inside(canvas,width,height,'Карта «Второй мозг»');
    inside(settings,width,height,'Настройки карты');
    assert(await page.locator('#brainSvg .group-node').count()>0, 'Не отрисованы интерактивные узлы');
    assert(await page.locator('[data-layout="hex"]').isVisible(), 'Нет переключателя «Соты»');
    if(width<=700)assert(canvas.y+canvas.height<=settings.y+4,'Мобильные настройки накладываются на карту');
    else assert(canvas.x+canvas.width<=settings.x+4,'Настройки перекрывают карту');
  }
}
async function assertNoPanelOverlap(page,selector,axis){
  const panels=page.locator(selector),count=await panels.count();
  for(let i=0;i<count-1;i++){
    const a=await panels.nth(i).boundingBox(),b=await panels.nth(i+1).boundingBox();
    assert(a&&b,selector+': не удалось измерить панели');
    if(axis==='x')assert(a.x+a.width<=b.x+2,selector+': соседние карточки перекрываются по горизонтали');
    else assert(a.y+a.height<=b.y+2,selector+': соседние карточки перекрываются по вертикали');
  }
}

async function checkAllCards(page,selector,expected){
  const cards=page.locator(selector);
  assert.equal(await cards.count(),expected,selector+': неверное число карточек');
  for(let i=0;i<expected;i++){
    const card=cards.nth(i);
    await card.scrollIntoViewIfNeeded();
    assert(await card.isVisible(),selector+'['+i+'] недоступна при прокрутке');
    const box=await card.boundingBox();
    assert(box&&box.width>150&&box.height>100,selector+'['+i+'] имеет неверный размер');
  }
}
async function exerciseEveryControl(browser,errors){
  const context=await browser.newContext({viewport:{width:1440,height:900},acceptDownloads:true});
  const page=await context.newPage();
  page.on('pageerror',e=>errors.push('controls: '+e.message));
  const click=async selector=>{await page.locator(selector).click({timeout:8000});};
  const visible=async selector=>assert(await page.locator(selector).isVisible(),selector+' не показан');
  const hidden=async selector=>assert(!(await page.locator(selector).isVisible()),selector+' не скрылся');
  try{
    await page.goto(site,{waitUntil:'domcontentloaded'});
    await page.waitForSelector('#walletList .wallet-item',{timeout:15000});
    await checkAllCards(page,'.command-left>.panel',3);
    await click('#accountButton');await visible('#authModal');
    assert((await page.locator('#authFeedback').innerText()).includes('supabase-schema.sql'),'Окно аккаунта не объясняет настройку базы');
    await click('#closeAuthModal');await hidden('#authModal');
    await checkAllCards(page,'.command-right>.panel',4);

    // Верхняя навигация: контакты, поиск, обновление, FRED, трафик, питание, логотип.
    await click('#navContact');await visible('#toast');
    assert((await page.locator('#toast').innerText()).includes('Контакты'));
    await click('#navRefresh');assert((await page.locator('#toast').innerText()).includes('обновлена'));
    await click('#navFred');await visible('#brainPage');await click('#navBack');
    await click('#navTraffic');await visible('#brainPage');await click('#navBack');
    await click('#navPower');await visible('#brainPage');await click('#navBack');
    await click('#openBrainButton');await visible('#brainPage');
    await click('#brandButton');await visible('#commandPage');
    await click('#navSearch');await visible('#brainPage');
    assert.equal(await page.locator('#fileSearch').evaluate(e=>document.activeElement===e),true,'Кнопка поиска не переводит фокус в поле');
    await page.locator('#fileSearch').fill('DAIANE');
    assert(await page.locator('#brainSvg .group-node').count()>0,'Поиск не показывает карту');
    await page.locator('#fileSearch').fill('');

    // Меню: сброс вида, справка, переходы в оба раздела.
    await click('#navMenu');assert.equal(await page.locator('#navMenu').getAttribute('aria-expanded'),'true');
    await click('#headerMenu [data-menu="help"]');await visible('#shortcuts');
    await click('#closeShortcuts');await hidden('#shortcuts');
    await click('#navMenu');await click('#headerMenu [data-menu="reset"]');
    await hidden('#headerMenu');
    await click('#navMenu');await click('#headerMenu [data-menu="command"]');
    await visible('#commandPage');
    await click('#navBrain');
    await click('#navMenu');await click('#headerMenu [data-menu="brain"]');
    await visible('#brainPage');

    // Презентация и клавиатурное закрытие.
    await click('#navPresent');
    assert(await page.locator('body').evaluate(e=>e.classList.contains('presenting')),'Режим презентации не включился');
    await page.keyboard.press('Escape');
    assert(!(await page.locator('body').evaluate(e=>e.classList.contains('presenting'))),'Escape не выключает презентацию');

    // Масштаб и центрирование.
    const before=await page.locator('#mapViewport').getAttribute('transform');
    await click('#zoomIn');
    const zoomed=await page.locator('#mapViewport').getAttribute('transform');
    assert.notEqual(zoomed,before,'Кнопка + не меняет масштаб');
    await click('#zoomOut');await click('#zoomReset');await click('#recenter');
    await page.locator('#brainSvg').hover();
    await page.mouse.wheel(0,-250);
    await click('#zoomReset');

    // Все четыре раскладки и оба способа просмотра.
    for(const layout of ['rings','circle','hex','force']){
      await click('[data-layout="'+layout+'"]');
      assert.equal(await page.locator('[data-layout="'+layout+'"]').getAttribute('aria-pressed'),'true','Не выбран режим '+layout);
      assert(await page.locator('#brainSvg .group-node').count()>0,'Нет узлов в режиме '+layout);
      if(layout==='hex')assert(await page.locator('#brainSvg .hex-cell').count()>=8,'Соты не отрисованы');
    }
    for(const view of ['folders','departments']){
      await click('[data-view="'+view+'"]');
      assert.equal(await page.locator('[data-view="'+view+'"]').getAttribute('aria-pressed'),'true','Не выбран просмотр '+view);
    }

    // Переключатели слоёв, подписи, ползунки.
    await click('#plaqueToggle');assert.equal(await page.locator('#plaqueToggle').getAttribute('aria-pressed'),'true');
    await click('#hudToggle');assert.equal(await page.locator('#hudToggle').getAttribute('aria-pressed'),'true');
    await page.locator('#fileNames').check();
    assert(await page.locator('#fileNames').isChecked(),'Флажок подписей не включился');
    for(const [id,value,out] of [['ringAngle','0.55','#ringAngleValue'],['ringForce','0.075','#ringForceValue'],['mapSize','0.78','#mapSizeValue']]){
      await page.locator('#'+id).evaluate((e,v)=>{e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));},value);
      assert((await page.locator(out).innerText()).length>0,'Не обновилось значение '+id);
    }

    // Развернуть/свернуть должны реально менять количество файловых узлов.
    await click('#expandAll');
    const expanded=await page.locator('#mapViewport circle').count();
    await click('#collapseAll');
    const collapsed=await page.locator('#mapViewport circle').count();
    assert(expanded>collapsed,'Кнопки «Развернуть всё» и «Свернуть всё» не меняют карту');
    await click('#expandAll');await click('#collapseAll');
    await click('#saveSettings');
    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('tracktor-preferences')||'null'));
    assert(saved&&saved.layout&&saved.theme,'Настройки не сохраняются');
    const pngPromise=page.waitForEvent('download',{timeout:15000});
    await click('#exportPng');
    const png=await pngPromise;
    assert(/\.png$/i.test(png.suggestedFilename()),'Экспорт не создал PNG');

    // Все темы должны выбираться, не оставляя несколько активных.
    const themes=page.locator('#themeList .theme-item');
    assert.equal(await themes.count(),6,'Ожидалось шесть цветовых тем');
    for(let i=0;i<6;i++){
      await themes.nth(i).click();
      assert.equal(await themes.nth(i).getAttribute('aria-pressed'),'true','Не выбрана тема '+i);
      assert.equal(await page.locator('#themeList .theme-item[aria-pressed="true"]').count(),1,'Активно больше одной темы');
    }
    await page.locator('#themeList .theme-item[data-theme="Океан"]').click();

    // Наведение и фильтр узла, затем снятие фильтра клавишей Escape.
    const node=page.locator('#brainSvg .group-node').first();
    await node.hover();
    await visible('#mapTooltip');
    await node.click();
    assert((await page.locator('#canvasHint').innerText()).includes('ФИЛЬТР'),'Клик по узлу не включает фильтр');
    await page.keyboard.press('Escape');
    assert((await page.locator('#canvasHint').innerText()).includes('ПЕРЕТАСКИВАНИЕ'),'Escape не снимает фильтр');

    // Карточка клиента: открытие, закрытие, Escape и переход на карту.
    await click('#navBack');
    await page.locator('#walletList .wallet-item').first().click();
    await visible('#clientModal');
    assert.equal(await page.locator('#clientModalFields>div').count(),4,'В карточке клиента не все поля');
    await click('#closeClientModal');await hidden('#clientModal');
    await page.locator('#walletList .wallet-item').nth(1).click();
    await click('#clientCloseButton');await hidden('#clientModal');
    await page.locator('#walletList .wallet-item').nth(2).click();
    await page.locator('#clientModal').click({position:{x:4,y:4}});
    await hidden('#clientModal');
    await page.locator('#walletList .wallet-item').first().click();
    await page.keyboard.press('Escape');await hidden('#clientModal');
    await page.locator('#walletList .wallet-item').first().click();
    await click('#clientOpenBrain');await visible('#brainPage');
    await click('#navBack');

    // Кнопки навыков: запуск, сведения и добавление (с объяснением демо-ограничения).
    const skillButtons=page.locator('#skillsGrid .skill-controls button');
    assert.equal(await skillButtons.count(),8,'Ожидалось по две кнопки у четырёх навыков');
    for(let i=0;i<await skillButtons.count();i++){
      await skillButtons.nth(i).scrollIntoViewIfNeeded();
      await skillButtons.nth(i).click();
      await visible('#toast');
    }
    await click('#addSkill');
    await visible('#authModal');
    assert((await page.locator('#authFeedback').innerText()).includes('supabase-schema.sql'),'Кнопка добавления навыка не направляет к настройке базы');
    await click('#closeAuthModal');await hidden('#authModal');

    // Возврат и клавиша логотипа.
    await click('#navBrain');await click('#brandButton');await visible('#commandPage');
    console.log('✓ Проверены все кнопки: навигация, меню, модальные окна, карта, настройки, темы, экспорт и навыки');
  }finally{await context.close();}
}

async function screenshot(page,name){
  await page.screenshot({path:path.join(output,name+'.png'),animations:'disabled'});
}
(async()=>{
  const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const errors=[];
  try{
    for(const vp of [{width:390,height:844,id:'phone'},{width:740,height:720,id:'video'},{width:1024,height:768,id:'tablet'},{width:1440,height:900,id:'desktop'}]){
      const page=await browser.newPage({viewport:{width:vp.width,height:vp.height},deviceScaleFactor:1,reducedMotion:'reduce'});
      page.on('pageerror',e=>errors.push(vp.id+': '+e.message));
      await page.goto(site,{waitUntil:'domcontentloaded'});
      await page.waitForSelector('#walletList .wallet-item',{timeout:15000});
      await inspect(page,vp.width,vp.height,'command');
      const axis=vp.width<=700?'x':'y';
      await assertNoPanelOverlap(page,'.command-left>.panel',axis);
      await assertNoPanelOverlap(page,'.command-right>.panel',axis);
      if(vp.width>=1100){
        for(const selector of ['.command-left>.panel','.command-right>.panel']){
          const panels=page.locator(selector);
          for(let i=0;i<await panels.count();i++){
            const b=await panels.nth(i).boundingBox();
            assert(b.y>=48&&b.y+b.height<=vp.height-2,selector+'['+i+'] не помещается в первый экран');
          }
        }
      }
      await screenshot(page,vp.id+'-command');
      await checkAllCards(page,'.command-left>.panel',3);
      await checkAllCards(page,'.command-right>.panel',4);
      await page.locator('.command-left').evaluate(e=>{e.scrollTop=0;e.scrollLeft=0});
      await page.locator('.command-right').evaluate(e=>{e.scrollTop=0;e.scrollLeft=0});
      await page.locator('#commandPage').evaluate(e=>e.scrollTop=0);
      await page.locator('#navBrain').click();
      await page.waitForSelector('#brainSvg .group-node',{timeout:15000});
      await page.locator('#brainLoader').waitFor({state:'hidden',timeout:5000});
      await inspect(page,vp.width,vp.height,'brain');
      await screenshot(page,vp.id+'-rings');
      await page.locator('[data-layout="circle"]').click();
      assert(await page.locator('#brainSvg .group-node').count()>10,'Нет круговых групп');
      await screenshot(page,vp.id+'-circle');
      await page.locator('[data-layout="hex"]').click();
      assert(await page.locator('#brainSvg .hex-cell').count()>=8,'Нет шестиугольных ячеек');
      assert.equal(await page.locator('#brainSvg .center-label').textContent(),'CLAUDE.MD','Центральный CLAUDE.MD не сохранён');
      const hexBounds=await page.locator('#mapViewport').evaluate(e=>{const b=e.getBBox();return {x:b.x,y:b.y,right:b.x+b.width,bottom:b.y+b.height};});
      assert(hexBounds.x>=-2&&hexBounds.y>=-2&&hexBounds.right<=1102&&hexBounds.bottom<=922,
        'Сетка «Соты» обрезана границами карты: '+JSON.stringify(hexBounds));
      await screenshot(page,vp.id+'-hex');
      // Hover tooltips, zoom and filtering should never crash.
      await page.locator('#zoomIn').click();
      await page.locator('#zoomOut').click();
      await page.locator('#fileSearch').fill('DAIANE');
      assert(await page.locator('#brainSvg .group-node').count()>0,'Поиск нарушил карту');
      await page.locator('#fileSearch').fill('');
      await page.locator('#navBack').click();
      assert(await page.locator('#walletList .wallet-item').count()===19, 'Пропали клиенты после возврата');
      await page.close();
    }
    await exerciseEveryControl(browser,errors);
    assert.deepEqual(errors,[],'Ошибки JavaScript в браузере');
    console.log('✓ 4 размера экрана; все панели доступны при прокрутке; все интерактивные кнопки проверены');
    console.log('Скриншоты: '+output);
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
