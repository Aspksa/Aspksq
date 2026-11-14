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
      await screenshot(page,vp.id+'-command');
      await page.locator('#navBrain').click();
      await page.waitForSelector('#brainSvg .group-node',{timeout:15000});
      await inspect(page,vp.width,vp.height,'brain');
      await screenshot(page,vp.id+'-rings');
      await page.locator('[data-layout="circle"]').click();
      assert(await page.locator('#brainSvg .group-node').count()>10,'Нет круговых групп');
      await screenshot(page,vp.id+'-circle');
      await page.locator('[data-layout="hex"]').click();
      assert(await page.locator('#brainSvg .hex-cell').count()>=8,'Нет шестиугольных ячеек');
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
    assert.deepEqual(errors,[],'Ошибки JavaScript в браузере');
    console.log('✓ 4 размера экрана; карты, панели, русские кнопки, переключение режимов и поиск');
    console.log('Скриншоты: '+output);
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
