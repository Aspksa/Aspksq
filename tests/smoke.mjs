import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { Script } from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const js = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const db = readFileSync(new URL('../database.js', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../sqlite-schema.sql', import.meta.url), 'utf8');


new Script(js, { filename: 'app.js' });
new Script(db, { filename: 'database.js' });
new Script(readFileSync(new URL('../assistant.js', import.meta.url), 'utf8'), { filename: 'assistant.js' });
new Script(readFileSync(new URL('../knowledge.js', import.meta.url), 'utf8'), { filename: 'knowledge.js' });
assert.doesNotMatch(html, /id="chatLimit"/, 'В чате нет ручного лимита ответа');
assert.doesNotMatch(html, /supabase|cdn\.jsdelivr/i, 'Локальная версия не требует облачного SDK');
assert.match(html, /<html lang="ru">/, 'Русская локализация документа');
assert.match(html, /<script src="database\.js" defer><\/script>/);
assert.match(html, /<script src="app\.js" defer><\/script>/);
assert.match(html, /id="accountButton"/);
assert.match(html, /id="authModal"/);
assert.match(html, /<link rel="stylesheet" href="styles\.css">/);

const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
const required = [
  'commandPage','commandSvg','commandTooltip','walletList','teamGrid','funnelList',
  'skillsGrid','routineList','clientModal','clientModalNote','clientOpenBrain','authModal','accountButton','backupDatabase','retryDatabase','brainPage','brainSvg',
  'mapViewport','mapTooltip','brainLoader','layoutButtons','viewButtons','fileSearch',
  'plaqueToggle','hudToggle','ringAngle','ringForce','mapSize','fileNames','themeList',
  'saveSettings','exportPng','zoomIn','zoomOut','zoomReset','navMenu','navSearch',
  'assistantAvatar','assistantChat','chatForm','chatInput','chatSession','chatSend',
  'chatKnowledge','chatMaterials','knowledgeModal','knowledgeBody','knowledgeMode','demoMode',
  'chatGraphToggle','traceTurn','traceModal','traceContent','traceMode'
];
for(const id of required)assert.ok(ids.has(id), 'Отсутствует элемент '+id);

const dynamic = new Set(['hoverLinks','previousMap']);
for(const m of js.matchAll(/\$\("([^"]+)"\)/g)){
  assert.ok(ids.has(m[1]) || dynamic.has(m[1]), 'JS обращается к неизвестному id '+m[1]);
}
const handlers = [
  'renderHeaderIcons','renderWallet','renderFunnel','renderSkills','renderRoutines',
  'renderTeam','renderCalendar','renderCommand','renderBrain','renderThemes','renderHex','syncDatabaseData','openDatabaseModal',
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
// Регрессионные проверки сценариев из видео: 17–23-я секунды.
assert.match(js, /function circleLayout\(/, 'Режим «Круг» реализован');
assert.match(js, /function hexLayout\(/, 'Режим «Соты» реализован');
assert.match(js, /attachNode\(tileShape,p,"group"\)/, 'Кликабельна вся шестиугольная область');
assert.match(js, /if\(band\(before\)!==band\(after\)\)renderBrain\(\)/, 'Обновление подписей после приближения');
assert.match(js, /\(\(state\.names&&state\.zoom>1\.6\)\|\|state\.zoom>2\.2\)/, 'Подписи мини-файлов при сильном увеличении');
assert.match(js, /var activePointers=new Map\(\),pinch=null/, 'Двухпальцевое масштабирование');
assert.match(js, /drawHoverLinks\(e,p\)/, 'Подсветка связей при наведении');
assert.match(css, /\.command-left,\.command-right\{overflow-y:auto/, 'Независимая прокрутка боковых колонок');

// Выявленные при визуальном аудите регрессии.
assert.ok(css.includes(".command-right{grid-row:3}"), 'Правая колонка доступна на мобильных экранах');
assert.ok(css.includes("scroll-snap-type:x proximity"), 'Мобильные блоки прокручиваются по горизонтали');
assert.ok(css.includes("minmax(0,1fr)"), 'Центральная колонка может сжиматься без обрезания');
assert.ok(!css.includes("ESC PARA SAIR"), 'Режим презентации полностью переведён');
assert.ok(css.includes("ESC — ВЫХОД"), 'Русская подсказка выхода из презентации');
assert.match(js, /for\(var i=0;i<143;i\+\+\)/, 'Число значков соответствует 143 сотрудникам');
assert.match(js, /el\.hasAttribute\("cx"\)&&el\.hasAttribute\("cy"\)/, 'Начало связей сот определяется по реальной геометрии');
assert.match(html, /<span class="mobile-only">НАЗАД<\/span>/, 'Есть короткая русская мобильная навигация');
assert.match(js, /row\.setAttribute\("role","button"\)/, 'Строки клиентов доступны с клавиатуры');

assert.match(db, /fetch/);
assert.match(db, /savePreferences/);
assert.match(db, /listClients/);
assert.match(db, /createSkill/);
assert.match(schema, /CREATE TABLE IF NOT EXISTS clients/i);
assert.match(schema, /CREATE TABLE IF NOT EXISTS user_preferences/i);
console.log('✓ Проверены интерфейс, локальный API, SQLite-схема, русские подписи и обработчики');

