const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const css = fs.readFileSync('public/styles.css', 'utf8');
const app = fs.readFileSync('public/app.js', 'utf8');
const index = fs.readFileSync('public/index.html', 'utf8');
const server = fs.readFileSync('server.js', 'utf8');
const projection = fs.readFileSync('state-projection.js', 'utf8');

test('UI-40 uses one canonical normalization block', () => {
  assert.equal((css.match(/UI-40 — staging visual normalization/g) || []).length, 1);
  assert.equal((css.match(/UI-40 staging (?:micro-)?patch/g) || []).length, 0);
  assert.equal((css.match(/UI-40 quick access (?:correction|refinement|final composition)/g) || []).length, 0);
});

test('map player marker is centered on the authoritative cell center', () => {
  assert.match(app, /t\.style\.left = `calc\(\(\$\{p\.col\} \+ \.5\) \* 100% \/ \$\{cols\}/);
  assert.match(app, /t\.style\.top = `calc\(\(\$\{p\.row\} \+ \.5\) \* 100% \/ \$\{rows\}/);

  const tokenBlock = css.match(/body\.game-active \.token \{([\s\S]*?)\n\}/g)?.at(-1) || '';
  assert.match(tokenBlock, /width:\s*calc\(100% \/ var\(--map-cols, 28\) \* \.4608\)/);
  assert.match(tokenBlock, /height:\s*auto/);
  assert.match(tokenBlock, /aspect-ratio:\s*1 \/ 1/);
  assert.match(tokenBlock, /transform:\s*translate\(-50%, -50%\)/);
  assert.match(tokenBlock, /min-height:\s*0/);
  assert.doesNotMatch(css, /^button\s*\{[^}]*min-height:/m);
  assert.doesNotMatch(css, /body\.game-active button:not\(\.map-object-hit\):not\(\.navigation-hit\):not\(\.targeting-hit\):not\(\.targeting-marker\):not\(\.cell-hit\):not\(\.token\):not\(\.game-action-button\)/);
});

test('compact map tools match roster avatars and align beneath menu', () => {
  const block = css.match(/body\.game-active \.map-toolbar \.map-tool-icon \{([\s\S]*?)\n  \}/)?.[0] || '';
  assert.match(block, /width:\s*30px/);
  assert.match(block, /height:\s*30px/);
  assert.match(block, /min-width:\s*30px/);
  assert.match(block, /min-height:\s*30px/);
  assert.match(block, /border-radius:\s*50%/);
  assert.match(block, /aspect-ratio:\s*1 \/ 1/);
  assert.match(css, /\.roster-token \{[\s\S]*?width:\s*30px;[\s\S]*?height:\s*30px;/);
  assert.match(css, /\.game-world-shell \.map-toolbar \{[\s\S]*?top:\s*55px;[\s\S]*?right:\s*15px;[\s\S]*?gap:\s*6px;/);
  assert.match(css, /\.map-center-me \{\s*\n\s*order:\s*1;/);
  assert.match(css, /\.map-zoom-control \{ order:\s*2; \}/);
  assert.doesNotMatch(css, /\.map-toolbar button\s*\{[^}]*min-height:\s*(?:34|36)px/s);
  assert.doesNotMatch(css, /body\.game-active \.map-toolbar\s*\{[^}]*min-height:\s*43px/s);
  assert.doesNotMatch(css, /body\.game-active\.event-flow-open \.game-world-shell \.map-toolbar/);
  assert.doesNotMatch(css, /\.game-world-shell \.map-toolbar\s*\{[^}]*top:\s*calc\((?:54|112|220)px/s);
  assert.equal((css.match(/body\.game-active \.game-world-shell \.map-toolbar \{/g) || []).length, 1);
});


test('mobile information surfaces use the floating-window architecture', () => {
  const canonical = css.slice(css.indexOf('/* UI-40 — staging visual normalization.'));
  const objectWindow = canonical.match(/body\.game-active \.object-sheet \{([\s\S]*?)\n  \}/)?.[0] || '';
  assert.match(objectWindow, /top:\s*calc\(72px \+ env\(safe-area-inset-top, 0px\)\)/);
  assert.match(objectWindow, /left:\s*max\(12px, env\(safe-area-inset-left, 0px\)\)/);
  assert.match(objectWindow, /right:\s*max\(12px, env\(safe-area-inset-right, 0px\)\)/);
  assert.match(objectWindow, /width:\s*auto/);
  assert.match(objectWindow, /max-width:\s*390px/);
  assert.match(objectWindow, /margin-inline:\s*auto/);
  assert.doesNotMatch(objectWindow, /transform:/);
  assert.match(objectWindow, /border-radius:\s*16px/);
  assert.doesNotMatch(objectWindow, /bottom:\s*0/);
  assert.doesNotMatch(index, /object-sheet-handle|id="objectSheetExpand"/);
  assert.doesNotMatch(app, /objectSheetExpand|toggleObjectSheetExpanded/);
  assert.doesNotMatch(css, /object-sheet-handle|#objectSheetExpand/);
  assert.doesNotMatch(css, /body\.game-active \.object-sheet\s*\{[^}]*bottom:\s*0/s);
  assert.doesNotMatch(css, /body\.game-active \.object-sheet\s*\{[^}]*max-height:\s*min\(46d?vh/s);
  assert.doesNotMatch(css, /body\.game-active \.object-sheet\.expanded\s*\{[^}]*max-height:\s*(?:min\(86d?vh|min\(90d?vh|94dvh)/s);
  assert.match(canonical, /body\.game-active \.object-sheet\.expanded \{\s*\n\s*max-height:\s*min\(74dvh, 680px\)/);
  assert.match(canonical, /body\.game-active \.object-sheet\.expanded ~ \.game-action-bar:not\(\.hidden\)/);
  assert.match(canonical, /body\.game-active \.score-overlay-card,\s*\n\s*body\.game-active \.journal-overlay-card,\s*\n\s*body\.game-active\.game-menu-open \.game-menu-panel/);
});


test('mobile turn controller is compact and keeps canonical turn commands', () => {
  const start = app.indexOf('function renderGameActionBar');
  const end = app.indexOf('function recordJournal', start);
  const block = app.slice(start, end);

  assert.match(block, /socket\.emit\('rollMove'/);
  assert.match(block, /socket\.emit\('skipNavigation'/);
  assert.match(block, /socket\.emit\('endTurn'/);
  assert.doesNotMatch(block, /addButton\('Действия'/);
  assert.match(block, /bar\.dataset\.mode = 'actions'/);
  assert.match(block, /setCopy\('ДЕЙСТВИЯ', '',/);
  assert.doesNotMatch(block, /actionLabel/);
  assert.match(block, /addButton\('Остаться'.*skipNavigation/);
  assert.match(block, /addButton\('🎲 Бросить'.*rollMove/);

  assert.doesNotMatch(css, /button:not\(\.map-object-hit\):not\(\.navigation-hit\):not\(\.targeting-hit\):not\(\.targeting-marker\):not\(\.cell-hit\):not\(\.token\):not\(\.game-action-button\)/);
  assert.match(css, /\.game-action-buttons \.game-action-button \{[\s\S]*?width:\s*66px;[\s\S]*?min-width:\s*66px;[\s\S]*?max-width:\s*66px;[\s\S]*?min-height:\s*33px;[\s\S]*?height:\s*33px/);
  assert.match(block, /bar\.dataset\.mode = 'navigation-result'/);
  assert.match(block, /Выберите объект или действие\./);
  assert.match(block, /setCopy\('', `Выпало \$\{mine\.roll\} · дальность \$\{mine\.movePoints\}`/);
  assert.match(block, /Выберите клетку · доступно:/);
  assert.match(block, /Бросьте кубик или останьтесь\./);
  assert.match(css, /\.game-action-bar\[data-mode="navigation"\],\s*\n\s*body\.game-active \.game-action-bar\[data-mode="navigation-result"\],\s*\n\s*body\.game-active \.game-action-bar\[data-mode="actions"\] \{[\s\S]*?width:\s*min\(165px, calc\(100% - 20px\)\);[\s\S]*?height:\s*66px;[\s\S]*?min-height:\s*66px/);
  assert.match(css, /grid-template-rows:\s*1fr 33px 1fr/);
  assert.match(css, /grid-template-areas:\s*\n\s*"status"\s*\n\s*"buttons"\s*\n\s*"detail"/);
  assert.match(css, /\.game-action-bar\[data-mode="actions"\] \.game-action-copy \{\s*\n\s*display:\s*contents/);
  assert.match(css, /white-space:\s*nowrap/);
  assert.doesNotMatch(css, /-webkit-line-clamp:\s*2/);
  assert.match(css, /\.game-action-kicker \{[\s\S]*?color:\s*var\(--accent\)/);
  assert.match(css, /\.game-action-status > strong \{[\s\S]*?color:\s*var\(--accent\)/);
  assert.match(css, /text-overflow:\s*clip;/);
  const actionDetailCss = css.match(/body\.game-active \.game-action-bar\[data-mode="navigation"\] \.game-action-detail,[\s\S]*?body\.game-active \.game-action-bar\[data-mode="actions"\] \.game-action-detail \{[\s\S]*?\n  \}/)?.[0] || '';
  assert.doesNotMatch(actionDetailCss, /transform:/);
  assert.match(css, /\.game-action-bar\[data-mode="navigation-result"\] \.game-action-buttons \.game-action-button,[\s\S]*?width:\s*132px;[\s\S]*?min-width:\s*132px;[\s\S]*?max-width:\s*132px/);
  assert.doesNotMatch(css, /body\.game-active \.game-action-buttons button\s*\{[^}]*min-height:\s*40px/s);
  assert.doesNotMatch(css, /body\.game-active \.game-action-buttons button\s*\{[^}]*flex:\s*1 1 0/s);
  assert.doesNotMatch(css, /body\.game-active \.game-action-buttons button\s*\{[^}]*min-width:\s*82px/s);
  assert.doesNotMatch(css, /body\.game-active \.game-action-bar\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto/s);
  assert.match(css, /gap:\s*0;\s*\n\s*padding:\s*0 6px;/);
  assert.match(css, /\.game-action-bar\[data-mode="actions"\] \.game-action-progress \{\s*\n\s*order:\s*0/);
  assert.match(css, /\.game-action-bar\[data-mode="actions"\] \.game-action-kicker \{\s*\n\s*order:\s*1/);
});


test('mobile HUD uses one square tile system', () => {
  assert.match(index, /id="hudPlayerBtn" class="hud-player"/);
  assert.match(index, /<div id="hudTurnStatus" class="hud-turn hud-turn-status"/);
  assert.doesNotMatch(index, /id="hudTurnBtn"/);
  assert.match(index, /id="hudCircle"/);

  assert.match(css, /--hud-tile:\s*44px/);
  assert.match(css, /grid-template-columns:\s*calc\(var\(--hud-tile\) \* 2\) minmax\(0,1fr\) var\(--hud-tile\) var\(--hud-tile\)/);
  assert.match(css, /\.hud-player \{[\s\S]*?width:\s*calc\(var\(--hud-tile\) \* 2\);[\s\S]*?height:\s*var\(--hud-tile\)/);
  assert.match(css, /\.hud-chip \{[\s\S]*?width:\s*var\(--hud-tile\);[\s\S]*?height:\s*var\(--hud-tile\)/);
  assert.match(css, /\.hud-turn-status \{[\s\S]*?width:\s*var\(--hud-tile\);[\s\S]*?height:\s*var\(--hud-tile\);[\s\S]*?pointer-events:\s*none/);
  assert.match(css, /\.hud-menu-btn \{[\s\S]*?width:\s*var\(--hud-tile\) !important;[\s\S]*?height:\s*var\(--hud-tile\) !important/);
  assert.match(css, /\.quick-access-btn \{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px/);
  assert.match(css, /\.quick-access-btn \.quick-access-label \{\s*\n\s*display:\s*none !important/);
  assert.match(css, /\.quick-access-btn > strong \{\s*\n\s*display:\s*block !important/);
  assert.doesNotMatch(css, /--hud-row-size:\s*40px/);
  assert.doesNotMatch(css, /--quick-access-size:\s*40px/);
  assert.equal((css.match(/--hud-tile:\s*44px/g) || []).length, 1);
  assert.doesNotMatch(css, /body\.game-active \.game-hud\s*\{[^}]*grid-template-columns:[^}]*(?:92px|112px|82px|76px|74px|36px|38px|40px)/s);
  assert.doesNotMatch(css, /\.game-hud\s*\{[^}]*grid-template-columns:[^}]*(?:95px|90px|112px)/s);
  assert.doesNotMatch(css, /body\.game-active \.hud-menu-btn\s*\{[^}]*(?:width|min-width|min-height):\s*(?:36|38|40)px/s);
  assert.doesNotMatch(css, /\.game-hud button\s*\{[^}]*min-height:\s*(?:40|42)px/s);
  assert.doesNotMatch(css, /body\.game-active \.hud-chip\s*\{[^}]*(?:min-width:\s*48px|min-height:\s*38px)/s);
  assert.doesNotMatch(css, /\.hud-chip\s*\{[^}]*min-width:\s*(?:52|58)px/s);

  assert.doesNotMatch(app, /hudTurnBtn/);
  assert.doesNotMatch(app, /hudPhaseLabel/);
  assert.match(app, /\$\('hudRound'\)\.textContent = r\.started \? `Раунд \$\{r\.round\}` : 'Лобби'/);
  assert.match(app, /\$\('hudCircle'\)\.textContent = r\.started \? `Круг \$\{r\.circle\}` : '—'/);
});


test('HUD metrics use canonical scoring concepts and compact explanations', () => {
  const metrics = [...index.matchAll(/data-hud-metric="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(metrics, ['ducats', 'cargo', 'army', 'artillery', 'army-glory', 'fleet-glory', 'prestige']);
  assert.doesNotMatch(index, /hudGlory/);
  assert.match(index, /id="hudMetricPopover"/);
  assert.match(index, /id="hudArmyGlory"/);
  assert.match(index, /id="hudFleetGlory"/);
  assert.match(index, /id="hudPrestige"/);

  assert.doesNotMatch(app, /hudGlory/);
  assert.match(app, /function hudMetricInfo\(metric\)/);
  assert.match(app, /title: 'АРМЕЙСКАЯ СЛАВА'/);
  assert.match(app, /title: 'МОРСКАЯ СЛАВА'/);
  assert.match(app, /title: 'ПРЕСТИЖ'/);
  assert.match(app, /\$\('hudArmyGlory'\)\.textContent = mine\.armyPoints \?\? 0/);
  assert.match(app, /\$\('hudFleetGlory'\)\.textContent = mine\.fleetPoints \?\? 0/);
  assert.match(app, /\$\('hudPrestige'\)\.textContent = mine\.prestige \?\? 0/);
  assert.match(app, /document\.querySelectorAll\('\[data-hud-metric\]'\)/);
  assert.doesNotMatch(app, /\$\('hudDucatsBtn'\)\.addEventListener\('click', renderFleetOverviewObjectSheet\)/);
  assert.doesNotMatch(app, /\$\('hudCargoBtn'\)\.addEventListener\('click', renderFleetOverviewObjectSheet\)/);
  assert.match(app, /<span>Армейская слава<\/span>/);
  assert.match(app, /<span>Морская слава<\/span>/);

  assert.match(css, /\.hud-metric-popover \{[\s\S]*?position:\s*fixed;[\s\S]*?width:\s*200px/);
  assert.match(css, /\.hud-chip\[data-hud-metric\]\[aria-expanded="true"\]/);

  assert.match(server, /const \{ calculatePlayerFinalMetrics \} = require\('\.\/final-scoring'\)/);
  assert.match(server, /const ownerLiveMetrics = p\.id === viewerId \? calculatePlayerFinalMetrics\(room, p\) : null/);
  assert.match(server, /prestige:\s*ownerLiveMetrics\?\.prestige/);
  assert.match(projection, /ducats:S, debt:S, prestige:S/);
  const publicPlayerBlock = projection.slice(projection.indexOf('const publicPlayer'), projection.indexOf('const ownerPlayer'));
  assert.doesNotMatch(publicPlayerBlock, /prestige/);
});


test('quick access buttons flank the action bar horizontally', () => {
  assert.match(css, /\.game-quick-access \{[\s\S]*?left:\s*0;[\s\S]*?right:\s*0;[\s\S]*?bottom:\s*calc\(19px \+ env\(safe-area-inset-bottom, 0px\)\);[\s\S]*?height:\s*44px;[\s\S]*?display:\s*block/);
  assert.match(css, /#hudCharacterBtn \{ left:\s*calc\(50% - 176\.5px\); \}/);
  assert.match(css, /#hudPoliticsBtn \{ left:\s*calc\(50% - 129\.5px\); \}/);
  assert.match(css, /#hudGoalsBtn \{ left:\s*calc\(50% \+ 85\.5px\); \}/);
  assert.match(css, /#hudCardsBtn \{ left:\s*calc\(50% \+ 132\.5px\); \}/);
  assert.doesNotMatch(css, /\.game-quick-access \{\s*\n\s*bottom:\s*calc\(64px/);
  assert.equal((css.match(/body\.game-active \.game-quick-access \{\s*\n\s*position:\s*absolute/g) || []).length, 1);
  assert.doesNotMatch(css, /body\.game-active \.game-quick-access\s*\{[^}]*(?:display:\s*grid|display:\s*flex)/s);
});


test('anchor and public player UI use canonical glory metrics only', () => {
  const renderMapStart = app.indexOf('  function renderMap()');
  const renderMapEnd = app.indexOf('\n  function ', renderMapStart + 1);
  const renderMapCode = app.slice(renderMapStart, renderMapEnd);
  assert.match(renderMapCode, /a\.fleetPoints \?\? 0/);
  assert.match(renderMapCode, /морской славы/);
  assert.doesNotMatch(renderMapCode, /a\.glory/);
  assert.doesNotMatch(renderMapCode, /undefined.*слав/i);

  const publicStart = app.indexOf('  function playerPublicSheetHtml(');
  const publicEnd = app.indexOf('\n  function renderFleetOverviewObjectSheet(', publicStart);
  const publicCode = app.slice(publicStart, publicEnd);
  assert.doesNotMatch(publicCode, /player\.glory/);
  assert.doesNotMatch(publicCode, /<span>Слава<\/span>/);
});


test('mobile roster keeps one 30px token system and landscape hide wins the cascade', () => {
  assert.doesNotMatch(css, /(?:width|height):\s*26px/);
  assert.match(css, /@media \(min-width: 901px\)[\s\S]*?\.roster-token \{[\s\S]*?width:\s*34px;[\s\S]*?height:\s*34px;/);
  const canonicalStart = css.indexOf('/* UI-40 — staging visual normalization.');
  const landscapeStart = css.lastIndexOf('@media (max-width: 900px) and (orientation: landscape)');
  assert.ok(canonicalStart >= 0 && landscapeStart > canonicalStart);
  const landscape = css.slice(landscapeStart);
  assert.match(landscape, /body\.game-active \.game-roster \{\s*\n\s*display:\s*none !important;/);
});


test('short landscape floating sheet clears the canonical action bar', () => {
  const landscape = css.slice(css.lastIndexOf('@media (max-width: 900px) and (orientation: landscape)'));
  assert.match(landscape, /\.object-sheet,\s*\n\s*body\.game-active \.object-sheet\.expanded/);
  assert.match(landscape, /max-height:\s*calc\(100dvh - 154px - env\(safe-area-inset-top, 0px\) - env\(safe-area-inset-bottom, 0px\)\)/);
});


test('animated ocean is a visual pan buffer outside the authoritative board', () => {
  assert.match(index, /id="mapPanSurface"[\s\S]*id="mapOceanCanvas"[\s\S]*id="mapBoard"/);
  assert.match(index, /<script src="\/ocean\.js"><\/script>\s*<script src="\/app\.js"><\/script>/);
  assert.match(css, /\.map-pan-surface \{[\s\S]*padding:\s*var\(--map-pan-gutter-y\) var\(--map-pan-gutter-x\)/);
  assert.match(css, /\.map-ocean-canvas \{[\s\S]*pointer-events:\s*none/);
  assert.match(css, /\.map-board \{[^}]*z-index:\s*1/);
  assert.match(app, /const gutterX = Math\.round\(Math\.max\(\(px \/ cols\) \* 2, 56\)\)/);
  assert.match(app, /const gutterY = Math\.round\(Math\.max\(\(px \/ rows\) \* 2, 80\)\)/);
  assert.match(app, /left:\s*board\.offsetLeft \+ mine\.col \* cellW/);
  assert.match(app, /top:\s*board\.offsetTop \+ mine\.row \* cellH/);
});
