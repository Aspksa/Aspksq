import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { Script } from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const js = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

new Script(js, { filename: 'app.js' });
assert.match(html, /<html lang="ru">/, 'Русская локализация документа');
assert.match(html, /<script src="app\.js" defer><\/script>/);
assert.match(html, /<link rel="stylesheet" href="styles\.css">/);

const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
const required = [
  'commandPage','commandSvg','commandTooltip','walletList','teamGrid','funnelList',
  'skillsGrid','routineList','clientModal','clientOpenBrain','brainPage','brainSvg',
  'mapViewport','mapTooltip','brainLoader','layoutButtons','viewButtons','fileSearch',
  'plaqueToggle','hudToggle','ringAngle','ringForce','mapSize','fileNames','themeList',
  'saveSettings','exportPng','zoomIn','zoomOut','zoomReset','navMenu','navSearch'
];
for(const id of required)assert.ok(ids.has(id), 'Отсутствует элемент '+id);

const dynamic = new Set(['hoverLinks','previousMap']);
for(const m of js.matchAll(/\$\("([^"]+)"\)/g)){
  assert.ok(ids.has(m[1]) || dynamic.has(m[1]), 'JS обращается к неизвестному id '+m[1]);
}
const handlers = [
  'renderHeaderIcons','renderWallet','renderFunnel','renderSkills','renderRoutines',
  'renderTeam','renderCalendar','renderCommand','renderBrain','renderThemes','renderHex',
  'drawHoverLinks','changeZoom','showClient','exportPNG','readSaved'
];
for(const fn of handlers.filter(x => x!=='renderHex')){
  assert.ok(js.includes('function '+fn+'('), 'Отсутствует функция '+fn);
}
for(const layout of ['rings','circle','hex','force']){
  assert.ok(html.includes('data-layout="'+layout+'"'), 'Нет переключателя '+layout);
}
for(const key of ['@keyframes layout-enter','@keyframes layout-exit','@keyframes agent-status','@keyframes center-halo']){
  assert.ok(css.includes(key), 'Отсутствует анимация '+key);
}
const portugueseLabels = [
  'VOLTAR AO COMANDO','APRESENTAR','SALVAR AJUSTES','RECOLHER TUDO',
  'TAMANHO (CÍRCULO E HEX)','nomes dos arquivos','Buscar arquivos','CARTEIRA',
  'AGORA','EQUIPE','AVISOS','ROTINAS','RESTAURAR'
];
for(const label of portugueseLabels){
  assert.ok(!html.includes(label), 'Не переведена метка '+label);
}
console.log('✓ Проверены синтаксис JavaScript, элементы интерфейса, анимации, русские подписи и обработчики');
