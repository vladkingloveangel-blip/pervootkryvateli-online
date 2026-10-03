const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const homeCss = fs.readFileSync(path.join(root, 'public', 'home-shell.css'), 'utf8');

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


test('home shell stylesheet is isolated and mobile fullscreen', () => {
  assert.ok(html.includes('href="/home-shell.css"'));
  assert.ok(homeCss.includes('body.home-active #homeShell'));
  assert.ok(homeCss.includes('100dvh'));
  assert.ok(homeCss.includes('safe-area-inset-top'));
  assert.ok(homeCss.includes('home-background.webp'));
  assert.ok(!homeCss.includes('body.game-active'));
});


test('home top area uses authored assets without entering game scope', () => {
  assert.ok(html.includes('class="home-logo" src="/assets/home-logo.png"'));
  assert.match(html, /id="homeProfileBtn"/);
  assert.match(html, /id="homeSettingsBtn"/);
  assert.ok(html.includes('src="/assets/settings-icon.png"'));
  assert.ok(app.includes("$('homeProfileBtn').addEventListener('click', openProfile)"));
  assert.ok(app.includes("$('homeSettingsBtn').addEventListener('click', openProfile)"));
});


test('central Home action routes to existing entry without game mutations', () => {
  assert.match(html, /id="homePrimaryAction"/);
  assert.match(html, /id="homePlayBtn"/);
  assert.match(app, /\$\('homePlayBtn'\)\.addEventListener\('click'/);
  assert.match(app, /\$\('entry'\)\.scrollIntoView/);
  assert.doesNotMatch(app, /homePlayBtn[\s\S]{0,300}socket\.emit/);
});
