const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const css = fs.readFileSync('public/styles.css', 'utf8');
const app = fs.readFileSync('public/app.js', 'utf8');

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
  assert.match(css, /body\.game-active button:not\(\.map-object-hit\):not\(\.navigation-hit\):not\(\.targeting-hit\):not\(\.targeting-marker\):not\(\.cell-hit\):not\(\.token\):not\(\.game-action-button\) \{[\s\S]*?min-height:\s*44px/);
});

test('compact map tools have explicit square geometry', () => {
  const block = css.match(/body\.game-active \.map-toolbar \.map-tool-icon \{([\s\S]*?)\n  \}/)?.[0] || '';
  assert.match(block, /width:\s*30px/);
  assert.match(block, /height:\s*30px/);
  assert.match(block, /min-width:\s*30px/);
  assert.match(block, /min-height:\s*30px/);
  assert.match(block, /aspect-ratio:\s*1 \/ 1/);
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
  assert.match(canonical, /body\.game-active \.object-sheet-handle,\s*\n\s*body\.game-active #objectSheetExpand \{\s*\n\s*display:\s*none !important/);
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

  assert.match(css, /button:not\(\.map-object-hit\):not\(\.navigation-hit\):not\(\.targeting-hit\):not\(\.targeting-marker\):not\(\.cell-hit\):not\(\.token\):not\(\.game-action-button\)/);
  assert.match(css, /\.game-action-buttons \.game-action-button \{[\s\S]*?min-height:\s*36px;[\s\S]*?height:\s*36px/);
  assert.match(block, /bar\.dataset\.mode = 'navigation-result'/);
  assert.match(block, /Выберите объект или действие\./);
  assert.match(block, /setCopy\('', `Выпало \$\{mine\.roll\} · дальность \$\{mine\.movePoints\}`/);
  assert.match(block, /Выберите клетку · доступно:/);
  assert.match(block, /Бросьте кубик или останьтесь\./);
  assert.match(css, /\.game-action-bar\[data-mode="navigation"\],\s*\n\s*body\.game-active \.game-action-bar\[data-mode="navigation-result"\],\s*\n\s*body\.game-active \.game-action-bar\[data-mode="actions"\] \{[\s\S]*?width:\s*min\(185px, calc\(100% - 20px\)\);[\s\S]*?height:\s*77px;[\s\S]*?min-height:\s*77px/);
  assert.match(css, /grid-template-rows:\s*16px 36px 11px/);
  assert.match(css, /grid-template-areas:\s*\n\s*"status"\s*\n\s*"buttons"\s*\n\s*"detail"/);
  assert.match(css, /\.game-action-bar\[data-mode="actions"\] \.game-action-copy \{\s*\n\s*display:\s*contents/);
  assert.match(css, /white-space:\s*nowrap/);
  assert.doesNotMatch(css, /-webkit-line-clamp:\s*2/);
  assert.match(css, /\.game-action-kicker \{[\s\S]*?color:\s*var\(--accent\)/);
  assert.match(css, /\.game-action-status > strong \{[\s\S]*?color:\s*var\(--accent\)/);
  assert.match(css, /text-overflow:\s*clip;\s*\n\s*transform:\s*translateY\(3px\)/);
  assert.match(css, /\.game-action-bar\[data-mode="actions"\] \.game-action-progress \{\s*\n\s*order:\s*0/);
  assert.match(css, /\.game-action-bar\[data-mode="actions"\] \.game-action-kicker \{\s*\n\s*order:\s*1/);
});
