const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');

test('stage 6.7 UI exposes events, discoveries, expeditions and legendary reactions', () => {
  assert.match(index, /id="legendaryPlacesBadge"/);
  assert.match(index, /id="legendaryPlacesContent"/);
  assert.match(index, /id="legendaryPlacesActions"/);

  assert.match(app, /function renderLegendaryPlaces\(\)/);
  assert.match(app, /renderLegendaryPlaces\(\);/);
  assert.match(app, /r\.namedPlaceCards \|\| \[\]/);
  assert.match(app, /mine\.expeditionHistory \|\| \[\]/);
  assert.match(app, /filter\(player => player\.activeExpedition\)/);
  assert.match(app, /socket\.emit\('takeExpedition'/);
  assert.match(app, /expedition-destination/);

  assert.doesNotMatch(app, /decks\.legendary/);
  assert.match(app, /цифровой случайный пул/);
  assert.match(app, /reaction\.kind === 'sea-curse'/);
  assert.match(app, /Покров отменит карту/);
  assert.match(app, /исходная I удаляется/);

  assert.match(styles, /\.named-place-grid/);
  assert.match(styles, /\.active-expedition/);
  assert.match(styles, /\.expedition-destination/);
});
