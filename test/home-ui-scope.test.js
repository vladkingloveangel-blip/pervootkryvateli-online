const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');

test('home shell and active game are sibling UI scopes', () => {
  const homeOpen = html.indexOf('<div id="homeShell"');
  const homeClose = html.indexOf('</div><!-- /#homeShell: non-party UI only -->');
  const game = html.indexOf('<section id="game"');
  assert.ok(homeOpen >= 0);
  assert.ok(homeClose > homeOpen);
  assert.ok(game > homeClose, '#game must stay outside #homeShell');
  const homeMarkup = html.slice(homeOpen, homeClose);
  for (const id of ['authPanel', 'accountBar', 'profilePanel', 'entry', 'myGamesPanel']) {
    assert.match(homeMarkup, new RegExp('id="' + id + '"'));
  }
});

test('surface switch owns only the home/game boundary', () => {
  assert.match(app, /function syncAppSurface\(activeGame\)/);
  assert.match(app, /document\.body\.classList\.toggle\('home-active', !gameActive\)/);
  assert.match(app, /\$\('homeShell'\)\?\.setAttribute\('aria-hidden'/);
  assert.match(app, /\$\('game'\)\?\.setAttribute\('aria-hidden'/);
  assert.match(app, /function setGameScreenActive\(active\) \{\s*syncAppSurface\(active\);/);
});
