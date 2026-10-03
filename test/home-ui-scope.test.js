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
  for (const id of ['authPanel', 'profilePanel', 'settingsPanel', 'howToPlayPanel', 'rulesPanel', 'homePrimaryAction', 'homeDashboard', 'myGamesPanel', 'entry']) {
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


test('Welcome hides Home controls and keeps only the authored scene controls', () => {
  assert.ok(app.includes("document.body.classList.add('welcome-active')"));
  assert.ok(app.includes("document.body.classList.remove('welcome-active')"));
  assert.ok(homeCss.includes('body.home-active.welcome-active .home-top-actions{display:none}'));
  assert.ok(homeCss.includes('body.home-active.welcome-active .home-topbar>.connection{display:none}'));
  assert.ok(html.includes('class="home-logo" src="/assets/home-logo.png"'));
  assert.ok(html.includes('id="homePlayBtn"'));
});


test('Welcome routes to the Home dashboard or authentication without game mutations', () => {
  assert.match(html, /id="homePrimaryAction"/);
  assert.match(html, /id="homePlayBtn"/);
  assert.ok(app.includes("$('homePlayBtn').addEventListener('click', openWelcomeAction)"));
  assert.ok(app.includes('function openWelcomeAction()'));
  assert.ok(app.includes('function showHomeDashboard()'));
  assert.ok(!app.includes("$('homePlayBtn').addEventListener('click', () => {\n    socket.emit"));
});


test('Home dashboard connects existing non-party actions', () => {
  assert.ok(html.includes('id="homeDashboard" class="home-dashboard hidden"'));
  assert.ok(html.includes('id="homeContinueBtn" class="home-dashboard-action home-dashboard-continue primary hidden"'));
  assert.ok(html.includes('id="homeContinueDetail"'));
  assert.ok(html.includes('id="homeDashboardError"'));
  assert.ok(html.includes('id="homeNewGameBtn"'));
  assert.ok(html.includes('id="homeJoinGameBtn"'));
  assert.ok(html.includes('id="homeDashboardGamesBtn"'));
  assert.ok(html.includes('id="homeDashboardHowToBtn"'));
  assert.ok(html.includes('id="homeDashboardRulesBtn"'));
  assert.ok(html.includes('id="homeDashboardSettingsBtn"'));
  assert.ok(app.includes("$('homeNewGameBtn').addEventListener('click', () => openPlayEntry('create'))"));
  assert.ok(app.includes("$('homeJoinGameBtn').addEventListener('click', () => openPlayEntry('join'))"));
  assert.ok(app.includes("$('homeDashboardGamesBtn').addEventListener('click', openMyGames)"));
  assert.ok(app.includes("$('homeDashboardHowToBtn').addEventListener('click', openHowToPlay)"));
  assert.ok(app.includes("$('homeDashboardRulesBtn').addEventListener('click', () => openRules('home'))"));
  assert.ok(app.includes("$('homeDashboardSettingsBtn').addEventListener('click', openSettings)"));
  assert.ok(homeCss.includes('/* Home v2: dashboard */'));
  assert.ok(homeCss.includes('body.home-active #homeDashboard'));
});

test('Continue is shown only from authoritative unfinished room data', () => {
  assert.ok(app.includes("const result = await apiJson('/api/my-games', { cache: 'no-store' })"));
  assert.ok(app.includes('syncHomeContinue(result.rooms);'));
  assert.ok(app.includes("button.classList.toggle('hidden', !hasRooms)"));
  assert.ok(app.includes("$('homeNewGameBtn').classList.toggle('primary', !hasRooms)"));
  assert.ok(app.includes("$('homeContinueBtn').addEventListener('click', continueFromHome)"));
  assert.ok(app.includes('if (rooms.length > 1) {\n      openMyGames();'));
  assert.ok(app.includes("resumeAvailableRoom(rooms[0], $('homeContinueBtn'), 'homeDashboardError')"));
  assert.ok(app.includes("socket.timeout(15000).emit('resumeRoom', { code: room.code, accountToken: token }"));
  assert.ok(homeCss.includes('body.home-active .home-dashboard-continue.hidden{display:none}'));
});



test('Internal Home screens share one shell and legacy play chooser is removed', () => {
  for (const id of ['entry', 'myGamesPanel', 'profilePanel', 'settingsPanel', 'howToPlayPanel', 'rulesPanel']) {
    assert.match(html, new RegExp('id="' + id + '" class="[^"]*home-screen'));
  }
  for (const headClass of ['entry-head', 'my-games-head', 'profile-home-head', 'settings-home-head', 'how-to-play-head', 'rules-head']) {
    assert.match(html, new RegExp('class="[^"]*home-screen-head[^"]*' + headClass));
  }
  assert.equal(html.includes('id="playFlow"'), false);
  assert.equal(app.includes('function openPlayFlow()'), false);
  assert.equal(app.includes("showHomeScreen('playFlow')"), false);
  assert.equal(homeCss.includes('#playFlow'), false);
  assert.ok(homeCss.includes('/* Home v2: unified internal screen system */'));
  assert.ok(homeCss.includes('body.home-active .home-screen{'));
  assert.ok(homeCss.includes('body.home-active .home-screen-head{'));
  assert.ok(homeCss.includes('body.home-active .home-screen-back,'));
  assert.ok(app.includes("card.className = 'home-game-card'"));
  assert.ok(homeCss.includes('.my-games-list>.home-game-card'));
});


test('Create and Join use separate entry modes while preserving room events', () => {
  assert.ok(html.includes('data-entry-mode="create"'));
  assert.ok(html.includes('id="createEntryActions"'));
  assert.ok(html.includes('id="joinEntryActions" class="join-entry-actions hidden"'));
  assert.ok(html.includes('id="entry" class="panel home-screen entry-panel hidden"'));
  assert.ok(html.includes('id="entryBackBtn" class="home-screen-back"'));
  assert.ok(app.includes("$('entry').dataset.entryMode = joinMode ? 'join' : 'create'"));
  assert.ok(app.includes("$('createEntryActions').classList.toggle('hidden', joinMode)"));
  assert.ok(app.includes("$('joinEntryActions').classList.toggle('hidden', !joinMode)"));
  assert.ok(app.includes("$('entryBackBtn').addEventListener('click', showHomeDashboard)"));
  assert.ok(app.includes("socket.emit('createRoom', profile()"));
  assert.ok(app.includes("socket.emit('joinRoom', { ...profile(), code"));
});


test('My Games is a dedicated Home state and preserves resume flow', () => {
  assert.ok(html.includes('id="myGamesPanel" class="home-screen my-games-panel hidden"'));
  assert.ok(html.includes('id="myGamesBackBtn"'));
  assert.ok(html.includes('id="myGamesRefreshBtn"'));
  assert.ok(html.includes('id="myGamesList" class="my-games-list"'));
  assert.ok(app.includes('function openMyGames()'));
  assert.ok(app.includes("$('myGamesBackBtn').addEventListener('click', showHomeDashboard)"));
  assert.ok(app.includes("$('myGamesRefreshBtn').addEventListener('click', loadMyGames)"));
  assert.ok(app.includes("socket.timeout(15000).emit('resumeRoom'"));
  assert.ok(app.includes("socket.timeout(10000).emit('goHome'"));
});


test('Profile is a dedicated Home screen and preserves account APIs', () => {
  assert.ok(html.includes('id="profilePanel" class="panel home-screen profile-panel hidden"'));
  assert.ok(html.includes('id="profileAvatarInitial"'));
  assert.ok(html.includes('id="profileIdentityName"'));
  assert.ok(html.includes('id="profileIdentityLogin"'));
  assert.ok(app.includes("function openProfile()"));
  assert.ok(app.includes("renderAccountAvatar(state.accountUser)"));
  assert.ok(app.includes("renderAccountAvatar(user)"));
  assert.ok(app.includes("apiJson('/api/auth/profile'"));
  assert.ok(app.includes("apiJson('/api/auth/change-password'"));
});


test('Settings is separate from Profile and persists real sound controls', () => {
  assert.ok(html.includes('id="settingsPanel" class="panel home-screen settings-panel hidden"'));
  assert.ok(html.includes('id="settingsSoundEnabled"'));
  assert.ok(html.includes('id="settingsSoundVolume"'));
  assert.ok(html.includes('id="settingsInstallSection"'));
  assert.ok(app.includes("if (action === 'settings') return openSettings()"));
  assert.ok(app.includes('function syncSettingsControls()'));
  assert.ok(app.includes('localStorage.setItem(SOUND_STORAGE_KEY, JSON.stringify(soundState))'));
  assert.ok(app.includes("$('settingsInstallBtn').addEventListener('click'"));
});


test('How to Play is a dedicated Home guide without changing game help', () => {
  assert.ok(html.includes('id="howToPlayPanel" class="panel home-screen how-to-play-panel hidden"'));
  assert.ok(html.includes('data-home-menu="how-to"'));
  assert.ok(html.includes('id="howToRulesBtn"'));
  assert.ok(app.includes('function openHowToPlay()'));
  assert.ok(app.includes("if (action === 'how-to') return openHowToPlay()"));
  assert.ok(app.includes("$('howToRulesBtn').addEventListener('click', () => openRules('how-to'))"));
  assert.ok(html.includes('data-game-menu="help"'));
});


test('Rules is a dedicated Home reader linked from How to Play', () => {
  assert.ok(html.includes('id="rulesPanel" class="panel home-screen rules-panel hidden"'));
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
  assert.ok(app.includes("if (action === 'logout') return logoutAccount()"));
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


test('Welcome is structurally separate from internal Home screens', () => {
  assert.ok(app.includes("const WELCOME_SCREEN_ID = 'homePrimaryAction'"));
  assert.ok(app.includes("const HOME_SCREEN_IDS = ['homeDashboard', 'entry', 'myGamesPanel', 'profilePanel', 'settingsPanel', 'howToPlayPanel', 'rulesPanel']"));
  assert.ok(app.includes('function hideWelcomeScreen()'));
  assert.ok(app.includes('function hideHomeScreens()'));
  assert.ok(app.includes('function showHomeScreen(id)'));
  assert.ok(app.includes('function showWelcomeScreen()'));
  assert.ok(app.includes('hideWelcomeScreen();'));
  assert.ok(app.includes("$(WELCOME_SCREEN_ID)?.classList.remove('hidden')"));
  assert.ok(app.includes('function showHomePrimary()'));
  assert.ok(app.includes('showWelcomeScreen();'));
  assert.ok(app.includes("showHomeScreen('homeDashboard')"));
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
  assert.ok(homeCss.includes('body.home-active .home-screen{'));
  assert.ok(homeCss.includes('max-height:calc(100dvh - max(88px,env(safe-area-inset-top))'));
  assert.ok(homeCss.includes('body.home-active .home-screen-back,'));
  assert.ok(homeCss.includes('min-width:38px;min-height:38px'));
  assert.ok(homeCss.includes('overscroll-behavior:contain'));
  assert.ok(homeCss.includes('-webkit-overflow-scrolling:touch'));
  assert.ok(homeCss.includes('@media(max-height:620px) and (max-width:520px)'));
  assert.ok(html.includes('viewport-fit=cover'));
});


test('Desktop Home adaptation keeps the scene layout without touching game UI', () => {
  assert.ok(homeCss.includes('/* Step 16: Desktop adaptation */'));
  assert.ok(homeCss.includes('@media(min-width:901px)'));
  assert.ok(homeCss.includes('body.home-active .home-screen{'));
  assert.ok(homeCss.includes('body.home-active #rulesPanel.home-screen{width:min(80vw,980px)}'));
  assert.ok(homeCss.includes('margin:clamp(18px,3dvh,34px) auto 0!important'));
  assert.ok(homeCss.includes('width:min(100%,1280px)'));
  assert.ok(homeCss.includes('.how-to-play-steps{grid-template-columns:repeat(2,minmax(0,1fr))}'));
  assert.ok(homeCss.includes('.rules-content{grid-template-columns:repeat(2,minmax(0,1fr));align-items:start}'));
  assert.ok(homeCss.includes('@media(min-width:1400px)'));
  const step16 = homeCss.slice(homeCss.indexOf('/* Step 16: Desktop adaptation */'));
  assert.equal(step16.includes('body.game-active'), false);
});


test('Legacy Home shell controls are removed after navigation migration', () => {
  assert.equal(html.includes('id="accountBar"'), false);
  assert.equal(html.includes('id="myGamesOpenBtn"'), false);
  assert.equal(html.includes('id="profileOpenBtn"'), false);
  assert.equal(html.includes('id="howToPlayOpenBtn"'), false);
  assert.equal(html.includes('id="adminOpenBtn"'), false);
  assert.equal(html.includes('id="logoutBtn"'), false);
  assert.equal(html.includes('id="loginBtn"'), false);
  assert.equal(html.includes('id="registerBtn"'), false);
  assert.equal(html.includes('id="installAppBtn"'), false);
  assert.ok(app.includes("if (action === 'admin') return showAdminPanel()"));
  assert.ok(app.includes("$('settingsInstallBtn').addEventListener('click', promptAppInstall)"));
  assert.ok(html.includes('id="gameMenuPanel"'));
  assert.ok(html.includes('id="gameAccountBackdrop"'));
});


test('Final Home redesign contract keeps the new shell clean and party UI isolated', () => {
  assert.equal(html.includes('\\n  <link rel="stylesheet" href="/home-shell.css"'), false);
  assert.ok(html.includes('id="homeShell" class="home-shell" data-ui-scope="home"'));
  assert.ok(html.indexOf('<!-- /#homeShell: non-party UI only -->') < html.indexOf('id="game" class="game hidden" data-ui-scope="game"'));
  for (const legacyId of ['accountBar', 'myGamesOpenBtn', 'profileOpenBtn', 'howToPlayOpenBtn', 'adminOpenBtn', 'logoutBtn', 'loginBtn', 'registerBtn', 'installAppBtn']) {
    assert.equal(html.includes(`id="${legacyId}"`), false);
  }
  assert.ok(homeCss.includes('min-width:33px;min-height:33px'));
  assert.ok(homeCss.includes('@media(min-width:901px)'));
  assert.ok(homeCss.includes('/assets/home-background.webp'));
  assert.ok(html.includes('/assets/home-logo.png'));
});


test('Home audio stays outside the active party and shares sound settings', () => {
  assert.ok(app.includes("function homeAudioAllowed()"));
  assert.ok(app.includes("document.body.classList.contains('home-active')"));
  assert.ok(app.includes("function scheduleHomeMusic()"));
  assert.ok(app.includes("function stopHomeMusic()"));
  assert.ok(app.includes("$('homeShell').addEventListener('click'"));
  assert.ok(app.includes("playSoundCue('confirm')"));
  assert.ok(app.includes("document.addEventListener('visibilitychange', syncHomeMusic)"));
  const musicStart = app.indexOf('  function homeAudioAllowed()');
  const musicEnd = app.indexOf('  // Compatibility marker', musicStart);
  const homeAudio = app.slice(musicStart, musicEnd);
  assert.equal(homeAudio.includes("game-active"), false);
  assert.ok(homeAudio.includes("home-active"));
});


test('Profile avatar picker is account-backed and remains Home-only', () => {
  assert.ok(html.includes('id="profileAvatarGrid"'));
  assert.ok(html.includes('id="profileAvatarSaveBtn"'));
  assert.ok(html.includes('id="homeAvatarImage"'));
  assert.ok(app.includes("const AVATAR_IDS = Array.from({ length: 10 }"));
  assert.ok(app.includes("async function saveProfileAvatar()"));
  assert.ok(app.includes("body: JSON.stringify({ displayName, avatarId: selectedAvatarId })"));
  assert.ok(app.includes("$('profileAvatarGrid').addEventListener('click'"));
  assert.equal(app.includes("$('accountName').textContent = result.user.displayName"), false);
  assert.ok(homeCss.includes('.profile-avatar-grid'));
  assert.ok(homeCss.includes('min-width:33px;min-height:33px'));
});


test('Persisted account startup activates the Home surface before rendering Home UI', () => {
  const applyStart = app.indexOf('function applyAccount(user, token = state.accountToken)');
  const applyEnd = app.indexOf('function showConnectionBanner', applyStart);
  const applyAccount = app.slice(applyStart, applyEnd);
  assert.ok(applyStart >= 0);
  assert.ok(applyAccount.includes("if (!state.room && !state.spectating) setGameScreenActive(false);"));
  assert.ok(applyAccount.indexOf('setGameScreenActive(false)') < applyAccount.indexOf('showHomePrimary()'));
});
