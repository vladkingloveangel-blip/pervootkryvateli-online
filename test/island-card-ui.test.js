const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'public/styles.css'), 'utf8');

test('island overview has hero, back navigation and one own-island primary action', () => {
  assert.ok(index.includes('id="objectSheetHero"'));
  assert.ok(index.includes('id="objectSheetBack"'));
  assert.ok(app.includes("manage.textContent = 'Управлять островом'"));
  assert.equal(app.includes('function ownIslandQuickActions('), false);
});

test('own island management is split into canonical action screens', () => {
  for (const view of ['build', 'upgrade', 'cargo', 'military', 'palace', 'expedition', 'admiralty']) {
    assert.ok(app.includes(view + ": ["), 'missing view ' + view);
  }
  assert.ok(app.includes("build: 'Можно построить'"));
  assert.ok(app.includes("upgrade: 'Построено'"));
  assert.ok(app.includes("cargo: 'Погрузка'"));
  assert.ok(app.includes("military: 'Военная инфраструктура'"));
  assert.ok(app.includes("palace: 'Дворец'"));
  assert.ok(app.includes("moveCanonicalActionGroup($('fleetActions'), 'Персонаж Адмиралтействa'") || app.includes("moveCanonicalActionGroup($('fleetActions'), 'Персонаж Адмиралтейства'"));
  assert.ok(app.includes('renderLegendaryPlaces();'));
});

test('foreign islands keep politics and assault as separate entry points', () => {
  const start = app.indexOf('function renderForeignIslandObjectSheet');
  const end = app.indexOf('function citadelSheetHtml', start);
  const block = app.slice(start, end);
  assert.ok(block.includes('Государство: ${politicalFaction.name}'));
  assert.ok(block.includes("action.textContent = 'Штурм острова'"));
  assert.equal(block.includes('appendCanonicalPoliticsActions'), false);
  assert.equal(block.includes('state-island-politics'), false);
  assert.ok(block.includes('Свободный остров переходит под контроль автоматически'));
});

test('all island action screens place their controls directly under one hint', () => {
  const start = app.indexOf('function renderOwnIslandActionView');
  const end = app.indexOf('function handleObjectSheetBack', start);
  const block = app.slice(start, end);
  assert.ok(block.includes('id="islandPrimaryActions"'));
  assert.ok(block.includes('class="island-action-hint"'));
  assert.ok(block.includes("moveCanonicalActionGroup($('islandActions'), labels[view], primaryActions)"));
  assert.ok(block.includes("moveCanonicalActionGroup($('fleetActions'), 'Рота ландскнехтов', primaryActions)"));
  assert.ok(block.includes("moveCanonicalActionGroup($('fleetActions'), 'Персонаж Адмиралтейства', primaryActions)"));
  assert.equal(app.includes('function islandActionIntroHtml('), false);
  assert.ok(styles.includes('.island-primary-actions'));
  assert.equal(styles.includes('.island-cargo-primary-actions'), false);
});

test('open island screen survives authoritative room refreshes', () => {
  assert.ok(/renderIsland\(\);\s*refreshOpenIslandSheet\(\);/.test(app));
  assert.ok(app.includes('state.islandSheetView = { islandId: island.id, view };'));
});

test('UI-41 owns island card workflow styling', () => {
  assert.equal((styles.match(/UI-41 — canonical island card workflow/g) || []).length, 1);
  assert.ok(styles.includes('.object-sheet.island-card-sheet'));
  assert.ok(styles.includes("background-image: url('/assets/map-base-4096.webp')"));
  assert.ok(styles.includes('.island-management-menu'));
});
