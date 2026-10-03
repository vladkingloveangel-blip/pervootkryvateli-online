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
  for (const id of ['authPanel', 'accountBar', 'profilePanel', 'settingsPanel', 'howToPlayPanel', 'rulesPanel', 'homePrimaryAction', 'myGamesPanel', 'playFlow', 'entry']) {
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
  assert.ok(html.includes('id="homeMenuBtn"'));
  assert.ok(app.includes("$('homeProfileBtn').addEventListener('click', openProfile)"));
  assert.ok(app.includes("$('homeMenuBtn').addEventListener('click', openHomeMenu)"));
});


test('central Home action routes to existing entry without game mutations', () => {
  assert.match(html, /id="homePrimaryAction"/);
  assert.match(html, /id="homePlayBtn"/);
  assert.ok(app.includes("$('homePlayBtn').addEventListener('click', openPlayFlow)"));
  assert.ok(app.includes("function openPlayFlow()"));
  assert.ok(!app.includes("$('homePlayBtn').addEventListener('click', () => {\n    socket.emit"));
});


test('Play flow stays client-side until existing create/join actions', () => {
  assert.ok(html.includes('id="playFlow"'));
  assert.ok(html.includes('id="playCreateChoiceBtn"'));
  assert.ok(html.includes('id="playJoinChoiceBtn"'));
  assert.ok(app.includes("$('homePlayBtn').addEventListener('click', openPlayFlow)"));
  assert.ok(app.includes("$('playCreateChoiceBtn').addEventListener('click', () => openPlayEntry('create'))"));
  assert.ok(app.includes("$('playJoinChoiceBtn').addEventListener('click', () => openPlayEntry('join'))"));
  assert.ok(app.includes("socket.emit('createRoom', profile()"));
  assert.ok(app.includes("socket.emit('joinRoom', { ...profile(), code"));
});


test('Create and Join use separate entry modes while preserving room events', () => {
  assert.ok(html.includes('data-entry-mode="create"'));
  assert.ok(html.includes('id="createEntryActions"'));
  assert.ok(html.includes('id="joinEntryActions" class="join-entry-actions hidden"'));
  assert.ok(html.includes('id="entryBackBtn"'));
  assert.ok(app.includes("$('entry').dataset.entryMode = joinMode ? 'join' : 'create'"));
  assert.ok(app.includes("$('createEntryActions').classList.toggle('hidden', joinMode)"));
  assert.ok(app.includes("$('joinEntryActions').classList.toggle('hidden', !joinMode)"));
  assert.ok(app.includes("socket.emit('createRoom', profile()"));
  assert.ok(app.includes("socket.emit('joinRoom', { ...profile(), code"));
});


test('My Games is a dedicated Home state and preserves resume flow', () => {
  assert.ok(html.includes('id="myGamesPanel" class="my-games-panel hidden"'));
  assert.ok(html.includes('id="myGamesBackBtn"'));
  assert.ok(html.includes('id="myGamesRefreshBtn"'));
  assert.ok(html.includes('id="myGamesList" class="my-games-list"'));
  assert.ok(app.includes('function openMyGames()'));
  assert.ok(app.includes("$('myGamesBackBtn').addEventListener('click', showHomePrimary)"));
  assert.ok(app.includes("$('myGamesRefreshBtn').addEventListener('click', loadMyGames)"));
  assert.ok(app.includes("socket.timeout(15000).emit('resumeRoom'"));
  assert.ok(app.includes("socket.timeout(10000).emit('goHome'"));
});


test('Profile is a dedicated Home screen and preserves account APIs', () => {
  assert.ok(html.includes('id="profilePanel" class="panel profile-panel hidden"'));
  assert.ok(html.includes('id="profileAvatarInitial"'));
  assert.ok(html.includes('id="profileIdentityName"'));
  assert.ok(html.includes('id="profileIdentityLogin"'));
  assert.ok(app.includes("function openProfile()"));
  assert.ok(app.includes("$('profileAvatarInitial').textContent"));
  assert.ok(app.includes("$('homeAvatarInitial').textContent"));
  assert.ok(app.includes("apiJson('/api/auth/profile'"));
  assert.ok(app.includes("apiJson('/api/auth/change-password'"));
});


test('Settings is separate from Profile and persists real sound controls', () => {
  assert.ok(html.includes('id="settingsPanel" class="panel settings-panel hidden"'));
  assert.ok(html.includes('id="settingsSoundEnabled"'));
  assert.ok(html.includes('id="settingsSoundVolume"'));
  assert.ok(html.includes('id="settingsInstallSection"'));
  assert.ok(app.includes("if (action === 'settings') return openSettings()"));
  assert.ok(app.includes('function syncSettingsControls()'));
  assert.ok(app.includes('localStorage.setItem(SOUND_STORAGE_KEY, JSON.stringify(soundState))'));
  assert.ok(app.includes("$('settingsInstallBtn').addEventListener('click'"));
});


test('How to Play is a dedicated Home guide without changing game help', () => {
  assert.ok(html.includes('id="howToPlayPanel" class="panel how-to-play-panel hidden"'));
  assert.ok(html.includes('id="howToPlayOpenBtn"'));
  assert.ok(html.includes('id="howToRulesBtn"'));
  assert.ok(app.includes('function openHowToPlay()'));
  assert.ok(app.includes("$('howToPlayOpenBtn').addEventListener('click', openHowToPlay)"));
  assert.ok(app.includes("$('howToRulesBtn').addEventListener('click', () => openRules('how-to'))"));
  assert.ok(html.includes('data-game-menu="help"'));
});


test('Rules is a dedicated Home reader linked from How to Play', () => {
  assert.ok(html.includes('id="rulesPanel" class="panel rules-panel hidden"'));
  assert.ok(html.includes('data-rules-target="rulesBasics"'));
  assert.ok(html.includes('data-rules-target="rulesFleet"'));
  assert.ok(html.includes('data-rules-target="rulesIslands"'));
  assert.ok(html.includes('data-rules-target="rulesCombat"'));
  assert.ok(html.includes('data-rules-target="rulesEvents"'));
  assert.ok(html.includes('data-rules-target="rulesGoals"'));
  assert.ok(app.includes("function openRules(returnTo = 'home')"));
  assert.ok(app.includes("$('howToRulesBtn').addEventListener('click', () => openRules('how-to'))"));
  assert.ok(app.includes("$('rulesBackBtn').addEventListener('click', closeRules)"));
  assert.ok(html.includes('data-game-menu="help"'));
});


test('Secondary Home menu centralizes non-party navigation', () => {
  assert.ok(html.includes('id="homeSecondaryMenu" class="home-secondary-menu hidden"'));
  assert.ok(html.includes('data-home-menu="games"'));
  assert.ok(html.includes('data-home-menu="profile"'));
  assert.ok(html.includes('data-home-menu="settings"'));
  assert.ok(html.includes('data-home-menu="how-to"'));
  assert.ok(html.includes('data-home-menu="rules"'));
  assert.ok(html.includes('data-home-menu="logout"'));
  assert.ok(app.includes('function openHomeMenu()'));
  assert.ok(app.includes('function handleHomeMenuAction(action)'));
  assert.ok(app.includes("if (action === 'logout') return logoutAccount()"));
  assert.ok(app.includes("$('logoutBtn').addEventListener('click', logoutAccount)"));
  assert.ok(app.includes("$('homeMenuAdminBtn').classList.toggle('hidden', user?.role !== 'admin')"));
});


test('Authentication has separate login and registration modes without changing account API', () => {
  assert.ok(html.includes('id="authPanel" class="panel auth-panel entry-panel hidden" data-auth-mode="login"'));
  assert.ok(html.includes('id="authLoginTab"'));
  assert.ok(html.includes('id="authRegisterTab"'));
  assert.ok(html.includes('id="authDisplayNameField" class="hidden"'));
  assert.ok(html.includes('id="authSubmitBtn"'));
  assert.ok(app.includes('function setAuthMode(mode)'));
  assert.ok(app.includes("submitAuth($('authPanel').dataset.authMode || 'login')"));
  assert.ok(app.includes("const endpoint = mode === 'register' ? '/api/auth/register' : '/api/auth/login'"));
  assert.ok(app.includes("const me = await apiJson('/api/auth/me')"));
  assert.ok(app.includes("socket.emit('resumeRoom'"));
});


test('Home navigation keeps exactly one non-party screen active', () => {
  assert.ok(app.includes("const HOME_SCREEN_IDS = ['homePrimaryAction', 'playFlow', 'entry', 'myGamesPanel', 'profilePanel', 'settingsPanel', 'howToPlayPanel', 'rulesPanel']"));
  assert.ok(app.includes('function hideHomeScreens()'));
  assert.ok(app.includes('function showHomeScreen(id)'));
  assert.ok(app.includes("showHomeScreen('homePrimaryAction')"));
  assert.ok(app.includes("showHomeScreen('playFlow')"));
  assert.ok(app.includes("showHomeScreen('entry')"));
  assert.ok(app.includes("showHomeScreen('myGamesPanel')"));
  assert.ok(app.includes("showHomeScreen('profilePanel')"));
  assert.ok(app.includes("showHomeScreen('settingsPanel')"));
  assert.ok(app.includes("showHomeScreen('howToPlayPanel')"));
  assert.ok(app.includes("showHomeScreen('rulesPanel')"));
  assert.ok(app.includes('closeHomeMenu();'));
});


test('Mobile Home polish preserves safe areas, scrolling, and compact touch targets', () => {
  assert.ok(homeCss.includes('/* Step 15: Mobile polish */'));
  assert.ok(homeCss.includes('min-height:100svh'));
  assert.ok(homeCss.includes('height:100dvh'));
  assert.ok(homeCss.includes('env(safe-area-inset-bottom)'));
  assert.ok(homeCss.includes('min-width:33px;min-height:33px'));
  assert.ok(homeCss.includes('overscroll-behavior:contain'));
  assert.ok(homeCss.includes('-webkit-overflow-scrolling:touch'));
  assert.ok(homeCss.includes('@media(max-height:620px) and (max-width:520px)'));
  assert.ok(html.includes('viewport-fit=cover'));
});
