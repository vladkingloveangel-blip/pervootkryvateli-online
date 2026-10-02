(() => {
  const socket = io();
  const $ = id => document.getElementById(id);
  const state = { room: null, shipCatalog: null, myId: null, code: null, playerToken: null, zoom: 1, selectedIslandId: null, mapSelection: null, mistCardRef: null, characterPeek: '', accountToken: localStorage.getItem('pervo:accountToken') || '', accountUser: null, accountsEnabled: false, authResolved: false, socketConnected: false, resumeAttempted: false, spectating: false, profileOpen: false, profileReturn: 'entry', everConnected: false, mapMovePending: false, lastAutoCenterSignature: '', resultQueue: [], activeResult: null, toastQueue: [], journalEntries: [], ambientSnapshot: null, targeting: null, rehydrateOnNextRoomState: false };
  const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
  const shipName = id => state.room?.shipCatalog?.[id]?.name || state.shipCatalog?.[id]?.name || $('shipSelect').querySelector(`option[value="${id}"]`)?.textContent || 'Корабль';
  fetch('/api/rules').then(response => response.ok ? response.json() : null).then(rules => {
    if (!rules?.fleet?.ships) return;
    state.shipCatalog = rules.fleet.ships;
    const terrain = { shoal: 'мели', reef: 'рифы', land1: '1 клетка суши', ice: 'льды' };
    for (const option of $('shipSelect').options) {
      const ship = state.shipCatalog[option.value];
      if (!ship) continue;
      option.textContent = `${ship.name} — арт. ${ship.artillery} · войско ${ship.army} · трюм ${ship.cargo} · ход ${ship.moveMod >= 0 ? '+' : ''}${ship.moveMod} · ${terrain[ship.passability] || ''}`;
    }
  }).catch(() => {});
  let deferredInstallPrompt = null;
  const pendingDataActions = new Set();
  function emitDataAction(button, event, payload) {
    const key = `${event}:${JSON.stringify(payload)}`;
    if (pendingDataActions.has(key) || button.disabled) return;
    pendingDataActions.add(key);
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    socket.timeout(10000).emit(event, payload, (error, result) => {
      pendingDataActions.delete(key);
      button.removeAttribute('aria-busy');
      // A fresh server snapshot decides availability; never blindly re-enable.
      handleGameAck(error ? { ok: false, error: 'Не удалось подтвердить действие. Дождитесь обновления игры.' } : result);
      if (!error && result?.ok === false) render();
    });
  }

  const roomFromUrl = new URLSearchParams(location.search).get('room');
  const inviteRoomCode = String(roomFromUrl || '').toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 5);
  let inviteJoinAttempted = false;
  if (inviteRoomCode) $('codeInput').value = inviteRoomCode;

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    $('installAppBtn').classList.remove('hidden');
  });
  $('installAppBtn').addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    try { await deferredInstallPrompt.userChoice; } catch {}
    deferredInstallPrompt = null;
    $('installAppBtn').classList.add('hidden');
  });


  async function apiJson(url, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (state.accountToken) headers.Authorization = `Bearer ${state.accountToken}`;
    const res = await fetch(url, { ...options, headers });
    let data = null;
    try { data = await res.json(); } catch { data = { ok: false, error: 'Некорректный ответ сервера.' }; }
    if (!res.ok && data?.ok !== false) data.ok = false;
    return data;
  }


  function setGameScreenActive(active) {
    document.body.classList.toggle('game-active', Boolean(active));
    if (!active) {
      closeGameMenu();
      closeGameAccountMenu();
    }
  }

  function openGameMenu() {
    if (!document.body.classList.contains('game-active') || !state.room) return;
    closeEndGameVoteOverlay();
    closeScoreOverlay();
    closeJournalOverlay();
    closeGameAccountMenu();
    closeMapInfo();
    $('gameMenuPanel').classList.remove('hidden');
    $('gameMenuBackdrop').classList.remove('hidden');
    document.body.classList.add('game-menu-open');
  }

  function closeGameMenu() {
    $('gameMenuPanel')?.classList.add('hidden');
    $('gameMenuBackdrop')?.classList.add('hidden');
    document.body.classList.remove('game-menu-open');
  }

  function toggleGameMenu() {
    if (document.body.classList.contains('game-menu-open')) closeGameMenu();
    else openGameMenu();
  }

  function openGameAccountMenu() {
    if (!state.accountUser || !document.body.classList.contains('game-active')) return;
    closeGameMenu();
    document.body.classList.add('game-account-open');
    $('gameAccountBackdrop').classList.remove('hidden');
  }

  function closeGameAccountMenu() {
    document.body.classList.remove('game-account-open');
    $('gameAccountBackdrop').classList.add('hidden');
  }

  function toggleGameAccountMenu() {
    if (document.body.classList.contains('game-account-open')) closeGameAccountMenu();
    else openGameAccountMenu();
  }

  function showAuth(message = '') {
    setGameScreenActive(false);
    state.profileOpen = false;
    $('profilePanel').classList.add('hidden');
    $('authPanel').classList.remove('hidden');
    $('accountBar').classList.add('hidden');
    $('entry').classList.add('hidden');
    $('adminPanel').classList.add('hidden');
    if (!state.spectating) $('game').classList.add('hidden');
    setError('authError', message);
  }

  function applyAccount(user, token = state.accountToken) {
    state.accountUser = user;
    state.accountToken = token || '';
    if (state.accountToken) localStorage.setItem('pervo:accountToken', state.accountToken);
    $('authPanel').classList.add('hidden');
    $('accountBar').classList.remove('hidden');
    $('accountName').textContent = user?.displayName || user?.username || 'Игрок';
    $('accountRole').textContent = user?.role === 'admin' ? 'администратор' : 'игрок';
    $('adminOpenBtn').classList.toggle('hidden', user?.role !== 'admin');
    loadMyGames();
    if (!$('nameInput').value) $('nameInput').value = user?.displayName || user?.username || '';
    if (!state.profileOpen && !state.spectating && !state.room && $('adminPanel').classList.contains('hidden')) $('entry').classList.remove('hidden');
    maybeJoinInvite();
  }


  function showConnectionBanner(message, kind = 'warning', autoHideMs = 0) {
    const el = $('connectionBanner');
    if (!el) return;
    clearTimeout(showConnectionBanner.timer);
    el.textContent = message;
    el.className = 'connection-banner ' + kind;
    if (autoHideMs) {
      showConnectionBanner.timer = setTimeout(() => el.classList.add('hidden'), autoHideMs);
    }
  }

  function hideConnectionBanner() {
    const el = $('connectionBanner');
    if (!el) return;
    clearTimeout(showConnectionBanner.timer);
    el.classList.add('hidden');
  }

  function openProfile() {
    if (!state.accountUser) return;
    closeGameAccountMenu();
    setGameScreenActive(false);
    state.profileReturn = !$('adminPanel').classList.contains('hidden') ? 'admin' : (!state.room ? 'entry' : 'game');
    state.profileOpen = true;
    $('profileUsername').value = state.accountUser.username || '';
    $('profileDisplayName').value = state.accountUser.displayName || '';
    $('profileOldPassword').value = '';
    $('profileNewPassword').value = '';
    $('profileNewPassword2').value = '';
    $('profileSaveStatus').textContent = '';
    $('profilePasswordStatus').textContent = '';
    $('entry').classList.add('hidden');
    $('adminPanel').classList.add('hidden');
    $('game').classList.add('hidden');
    $('authPanel').classList.add('hidden');
    $('profilePanel').classList.remove('hidden');
  }

  function closeProfile() {
    state.profileOpen = false;
    $('profilePanel').classList.add('hidden');
    if (state.profileReturn === 'admin' && state.accountUser?.role === 'admin') {
      $('adminPanel').classList.remove('hidden');
      loadAdminRooms();
    } else if (state.room) {
      $('game').classList.remove('hidden');
      setGameScreenActive(true);
      render();
    } else {
      $('entry').classList.remove('hidden');
      loadMyGames();
    }
  }

  async function saveProfileName() {
    const button = $('profileSaveBtn');
    const displayName = $('profileDisplayName').value.trim();
    $('profileSaveStatus').textContent = '';
    button.disabled = true;
    try {
      const result = await apiJson('/api/auth/profile', { method: 'POST', body: JSON.stringify({ displayName }) });
      if (!result?.ok) throw new Error(result?.error || 'Не удалось сохранить имя.');
      state.accountUser = result.user;
      state.accountToken = result.token;
      localStorage.setItem('pervo:accountToken', result.token);
      $('accountName').textContent = result.user.displayName || result.user.username;
      $('nameInput').value = result.user.displayName || result.user.username;
      $('profileDisplayName').value = result.user.displayName || '';
      $('profileSaveStatus').textContent = 'Имя сохранено.';
    } catch (err) {
      $('profileSaveStatus').textContent = err.message || 'Не удалось сохранить имя.';
    } finally {
      button.disabled = false;
    }
  }

  async function changeProfilePassword() {
    const button = $('profilePasswordBtn');
    const oldPassword = $('profileOldPassword').value;
    const newPassword = $('profileNewPassword').value;
    const repeated = $('profileNewPassword2').value;
    $('profilePasswordStatus').textContent = '';
    if (newPassword !== repeated) {
      $('profilePasswordStatus').textContent = 'Новые пароли не совпадают.';
      return;
    }
    if (newPassword.length < 6) {
      $('profilePasswordStatus').textContent = 'Новый пароль должен быть не короче 6 символов.';
      return;
    }
    button.disabled = true;
    try {
      const result = await apiJson('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ oldPassword, newPassword }) });
      if (!result?.ok) throw new Error(result?.error || 'Не удалось сменить пароль.');
      $('profileOldPassword').value = '';
      $('profileNewPassword').value = '';
      $('profileNewPassword2').value = '';
      $('profilePasswordStatus').textContent = 'Пароль изменён.';
    } catch (err) {
      $('profilePasswordStatus').textContent = err.message || 'Не удалось сменить пароль.';
    } finally {
      button.disabled = false;
    }
  }

  function maybeJoinInvite() {
    if (!inviteRoomCode || inviteJoinAttempted || state.room || state.spectating) return false;
    if (!state.authResolved || !state.socketConnected || (state.accountsEnabled && !state.accountToken)) return false;
    inviteJoinAttempted = true;
    setError('entryError', `Входим по приглашению в комнату ${inviteRoomCode}…`);
    joinRoomByCode(inviteRoomCode, true);
    return true;
  }

  let myGamesRequest = 0;
  async function loadMyGames() {
    const token = state.accountToken;
    const request = ++myGamesRequest;
    const enabled = Boolean(state.accountUser && token);
    $('myGamesPanel').classList.toggle('hidden', !enabled);
    if (!enabled) { $('myGamesList').replaceChildren(); return; }
    setError('myGamesError');
    try {
      const result = await apiJson('/api/my-games', { cache: 'no-store' });
      if (request !== myGamesRequest || token !== state.accountToken) return;
      if (!result?.ok) throw new Error(result?.error || 'Не удалось загрузить игры.');
      const box = $('myGamesList');
      box.replaceChildren();
      if (!result.rooms.length) {
        box.textContent = 'Активных игр пока нет. Создай комнату или присоединись к друзьям.';
        return;
      }
      for (const room of result.rooms) {
        const card = document.createElement('div');
        card.className = 'admin-room-card';
        const info = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = 'Комната ' + room.code;
        const detail = document.createElement('div');
        detail.className = 'muted';
        detail.textContent = (room.started ? 'Игра · раунд ' + room.round + ', круг ' + room.circle : 'Лобби') +
          ' · игроков ' + room.playerCount + (room.isYourTurn ? ' · Твой ход' : room.activePlayerName ? ' · ход: ' + room.activePlayerName : '');
        const names = document.createElement('div');
        names.className = 'muted';
        names.textContent = room.players.map(p => p.name).join(', ');
        info.append(title, detail, names);
        const button = document.createElement('button');
        button.className = 'small primary';
        button.textContent = 'Вернуться в игру';
        button.addEventListener('click', () => {
          if (!state.socketConnected) return setError('myGamesError', 'Нет связи с сервером. Дождись подключения.');
          button.disabled = true;
          state.rehydrateOnNextRoomState = true;
          socket.timeout(15000).emit('resumeRoom', { code: room.code, accountToken: state.accountToken }, (err, res) => {
            button.disabled = false;
            if (token !== state.accountToken) return;
            if (err || !res?.ok) return setError('myGamesError', res?.error || 'Сервер не ответил. Попробуй ещё раз.');
            acceptSession(res);
          });
        });
        card.append(info, button);
        box.append(card);
      }
    } catch (err) {
      if (request === myGamesRequest && token === state.accountToken) setError('myGamesError', err.message || 'Не удалось загрузить игры.');
    }
  }

  async function initAuth() {
    try {
      const status = await apiJson('/api/auth/status');
      state.accountsEnabled = Boolean(status?.accountsEnabled);
      if (!state.accountsEnabled) {
        state.authResolved = true;
        $('authPanel').classList.add('hidden');
        $('accountBar').classList.add('hidden');
        $('entry').classList.remove('hidden');
        maybeResumeLastRoom();
        return;
      }
      if (state.accountToken) {
        const me = await apiJson('/api/auth/me');
        if (me?.ok) {
          applyAccount(me.user, state.accountToken);
        } else {
          localStorage.removeItem('pervo:accountToken');
          state.accountToken = '';
          showAuth('Войдите в аккаунт.');
        }
      } else {
        showAuth(status?.databaseReady === false ? 'База аккаунтов подключается. Попробуйте обновить страницу.' : '');
      }
    } catch {
      showAuth('Не удалось проверить аккаунт.');
    } finally {
      state.authResolved = true;
      maybeResumeLastRoom();
    }
  }

  async function submitAuth(mode) {
    setError('authError');
    const username = $('authUsername').value.trim();
    const password = $('authPassword').value;
    const displayName = $('authDisplayName').value.trim();
    const endpoint = mode === 'register' ? '/api/auth/register' : '/api/auth/login';
    const data = await apiJson(endpoint, { method: 'POST', body: JSON.stringify({ username, password, displayName }) });
    if (!data?.ok) return setError('authError', data?.error || 'Не удалось войти.');
    applyAccount(data.user, data.token);
    state.resumeAttempted = false;
    maybeResumeLastRoom();
  }

  function maybeResumeLastRoom() {
    if (!state.socketConnected || !state.authResolved || state.resumeAttempted || state.spectating) return;
    if (state.accountsEnabled && !state.accountToken) return;
    if (inviteRoomCode) {
      maybeJoinInvite();
      return;
    }
    const last = localStorage.getItem('pervo:lastRoom');
    if (!last) return;
    state.resumeAttempted = true;
    try {
      const sess = JSON.parse(localStorage.getItem(keyFor(last)) || 'null');
      if (sess?.code && sess?.playerToken) {
        state.rehydrateOnNextRoomState = true;
        socket.emit('resumeRoom', { ...sess, accountToken: state.accountToken }, res => {
          if (res?.ok) {
            acceptSession(res);
            if (state.everConnected) showConnectionBanner('Связь восстановлена. Вы снова в партии.', 'success', 2200);
          } else if (res?.error === 'Комната больше не существует.') {
            localStorage.removeItem(keyFor(last));
            localStorage.removeItem('pervo:lastRoom');
            hideConnectionBanner();
          } else if (state.everConnected) {
            showConnectionBanner(res?.error || 'Связь восстановлена, но вернуться в партию не удалось.', 'error');
          }
        });
      }
    } catch {}
  }

  function renderAdminRooms(rooms) {
    const box = $('adminRooms');
    box.innerHTML = '';
    if (!rooms?.length) {
      box.innerHTML = '<div class="muted">Активных комнат сейчас нет.</div>';
      return;
    }
    rooms.forEach(room => {
      const card = document.createElement('div');
      card.className = 'admin-room-card';
      const players = room.players.map(p => `${escapeHtml(p.name)}${p.username ? ` (@${escapeHtml(p.username)})` : ''}${p.connected ? '' : ' · офлайн'}`).join('<br>');
      card.innerHTML = `<div><strong>Комната ${escapeHtml(room.code)}</strong><div class="muted">${room.started ? `Игра · раунд ${room.round}, круг ${room.circle}` : 'Лобби'} · игроков ${room.players.length}${room.activePlayerName ? ` · ход: ${escapeHtml(room.activePlayerName)}` : ''}</div><div class="admin-players">${players}</div></div><div class="admin-room-actions"></div>`;
      const actions = card.querySelector('.admin-room-actions');
      const watch = document.createElement('button');
      watch.className = 'small primary';
      watch.textContent = 'Наблюдать';
      watch.addEventListener('click', () => {
        socket.emit('adminWatchRoom', { accountToken: state.accountToken, code: room.code }, res => {
          if (!res?.ok) return setError('adminError', res?.error || 'Не удалось открыть комнату.');
          state.spectating = true;
          state.room = res.room;
          state.myId = null;
          state.code = null;
          state.playerToken = null;
          document.body.classList.add('spectator-mode');
          $('adminPanel').classList.add('hidden');
          $('entry').classList.add('hidden');
          $('game').classList.remove('hidden');
          $('spectatorBanner').classList.remove('hidden');
          $('spectatorRoomCode').textContent = res.room.code;
          render();
        });
      });
      const close = document.createElement('button');
      close.className = 'small danger-soft';
      close.textContent = 'Закрыть';
      close.addEventListener('click', () => {
        if (!confirm(`Закрыть комнату ${room.code} для всех игроков?`)) return;
        socket.emit('adminCloseRoom', { accountToken: state.accountToken, code: room.code }, res => {
          if (!res?.ok) return setError('adminError', res?.error || 'Не удалось закрыть комнату.');
          loadAdminRooms();
        });
      });
      actions.append(watch, close);
      box.appendChild(card);
    });
  }

  function loadAdminRooms() {
    if (state.accountUser?.role !== 'admin') return;
    setError('adminError');
    socket.emit('adminListRooms', { accountToken: state.accountToken }, res => {
      if (!res?.ok) return setError('adminError', res?.error || 'Не удалось загрузить комнаты.');
      renderAdminRooms(res.rooms || []);
    });
  }

  function showAdminPanel() {
    if (state.accountUser?.role !== 'admin') return;
    closeGameAccountMenu();
    setGameScreenActive(false);
    state.spectating = false;
    state.room = null;
    document.body.classList.remove('spectator-mode');
    $('spectatorBanner').classList.add('hidden');
    $('game').classList.add('hidden');
    $('entry').classList.add('hidden');
    $('authPanel').classList.add('hidden');
    $('adminPanel').classList.remove('hidden');
    loadAdminRooms();
  }

  function keyFor(code) { return `pervo:${String(code || '').toUpperCase()}`; }
  function saveSession() {
    if (state.code && state.playerToken) localStorage.setItem(keyFor(state.code), JSON.stringify({ code: state.code, playerToken: state.playerToken }));
    if (state.code) localStorage.setItem('pervo:lastRoom', state.code);
  }

  function resetTransientPresentationState() {
    state.selectedIslandId = null;
    state.mapSelection = null;
    state.mistCardRef = null;
    state.characterPeek = '';
    state.mapMovePending = false;
    state.lastAutoCenterSignature = '';
    state.targeting = null;
    state.resultQueue = [];
    state.activeResult = null;
    state.toastQueue = [];

    if (typeof closeGameMenu === 'function') closeGameMenu();
    if (typeof closeGameAccountMenu === 'function') closeGameAccountMenu();
    if (typeof closeScoreOverlay === 'function') closeScoreOverlay();
    if (typeof closeJournalOverlay === 'function') closeJournalOverlay();
    if (typeof closeEndGameVoteOverlay === 'function') closeEndGameVoteOverlay();
    if (typeof closeMapInfo === 'function') closeMapInfo();

    $('decisionLayer')?.classList.add('hidden');
    $('resultLayer')?.classList.add('hidden');
    $('targetingBar')?.classList.add('hidden');
    $('eventFlowOverlay')?.classList.add('hidden');
    document.body?.classList?.remove(
      'decision-layer-open', 'result-layer-open', 'object-sheet-open', 'targeting-open',
      'mobile-sheet-open', 'score-overlay-open', 'journal-overlay-open', 'end-game-vote-open'
    );
  }

  function setError(id, msg = '') { $(id).textContent = msg; }
  function setConnected(yes) {
    $('connection').textContent = yes ? '● онлайн' : '○ нет связи';
    const hudConnection = $('hudConnection');
    if (hudConnection) {
      hudConnection.textContent = yes ? '● онлайн' : '○ нет связи';
      hudConnection.classList.toggle('offline', !yes);
    }
  }

  function clearSession(message = '') {
    const code = state.code;
    if (code) {
      localStorage.removeItem(keyFor(code));
      if (localStorage.getItem('pervo:lastRoom') === code) localStorage.removeItem('pervo:lastRoom');
    }
    state.room = null;
    state.myId = null;
    state.code = null;
    state.playerToken = null;
    state.resultQueue = [];
    state.activeResult = null;
    state.toastQueue = [];
    state.journalEntries = [];
    state.ambientSnapshot = null;
    state.targeting = null;
    state.rehydrateOnNextRoomState = false;
    closeMapInfo();
    closeMapInfo();
    setGameScreenActive(false);
    $('game').classList.add('hidden');
    $('entry').classList.remove('hidden');
    setError('gameError', '');
    setError('entryError', message);
    loadMyGames();
    try {
      const url = new URL(location.href);
      url.searchParams.delete('room');
      history.replaceState(null, '', url.pathname + url.search + url.hash);
    } catch {}
  }

  socket.on('connect', () => {
    const wasReconnecting = state.everConnected && !state.socketConnected;
    setConnected(true);
    state.socketConnected = true;
    document.body.classList.remove('connection-lost');
    loadMyGames();
    state.resumeAttempted = false;
    if (wasReconnecting) showConnectionBanner(state.code || state.room ? 'Связь восстановлена. Возвращаем вас в партию…' : 'Связь восстановлена.', 'success', state.code || state.room ? 0 : 2200);
    if (!maybeJoinInvite()) maybeResumeLastRoom();
    state.everConnected = true;
  });
  socket.on('disconnect', () => {
    setConnected(false);
    state.socketConnected = false;
    state.resumeAttempted = false;
    state.rehydrateOnNextRoomState = Boolean(state.code || state.room);
    document.body.classList.add('connection-lost');
    showConnectionBanner('Связь потеряна. Переподключаемся автоматически…', 'warning');
  });
  socket.io.on('reconnect_attempt', () => {
    showConnectionBanner('Переподключаемся к серверу…', 'warning');
  });
  socket.io.on('reconnect_failed', () => {
    showConnectionBanner('Не удалось восстановить связь. Проверьте интернет и обновите страницу.', 'error');
  });
  socket.on('connect_error', () => {
    if (state.everConnected) showConnectionBanner('Сервер пока недоступен. Продолжаем переподключение…', 'warning');
  });
  socket.on('eventResolved', data => {
    if (state.spectating) return;
    const card = eventResolvedResultCard(data);
    if (card) {
      enqueueResultCard(card);
      playSoundCue(card.tone === 'danger' ? 'danger' : card.tone === 'success' ? 'reward' : 'event');
    }
  });

  socket.on('battleResolved', data => {
    if (state.spectating || !data?.result) return;
    playSoundCue('battle');
    if (data.kind === 'sea') {
      const target = state.room?.players?.find(player => player.id === data.targetPlayerId);
      const attacker = state.room?.players?.find(player => player.id === data.attackerId);
      const opponentName = data.attackerId === state.myId ? target?.name : attacker?.name;
      const card = seaBattleResultCard({ ok: true, result: data.result }, opponentName || 'противник');
      if (card) enqueueResultCard(card);
      return;
    }
    if (data.kind === 'assault') {
      const card = jointAssaultResultCard(data);
      if (card) enqueueResultCard(card);
    }
  });

  socket.on('roomState', room => {
    if (state.spectating) return;
    const rehydrating = state.rehydrateOnNextRoomState
      || !state.room
      || (state.room?.code && room?.code && state.room.code !== room.code);
    if (rehydrating) {
      resetTransientPresentationState();
      state.rehydrateOnNextRoomState = false;
    }
    processAmbientRoomState(room, { silent: rehydrating });
    state.room = room;
    if (room?.shipCatalog) state.shipCatalog = room.shipCatalog;
    const incomingMine = room?.players?.find(p => p.id === state.myId);
    if (!incomingMine || incomingMine.phase !== 'navigation') state.mapMovePending = false;
    render();
  });
  socket.on('adminRoomState', room => {
    if (!state.spectating) return;
    state.room = room;
    if (room?.shipCatalog) state.shipCatalog = room.shipCatalog;
    setGameScreenActive(true);
    $('spectatorRoomCode').textContent = room.code;
    render();
  });
  socket.on('adminRoomClosed', data => {
    if (!state.spectating) return;
    state.spectating = false;
    state.room = null;
    document.body.classList.remove('spectator-mode');
    setGameScreenActive(false);
    $('game').classList.add('hidden');
    $('spectatorBanner').classList.add('hidden');
    showAdminPanel();
    setError('adminError', data?.reason || 'Комната закрыта.');
  });
  socket.on('roomClosed', data => clearSession(data?.reason || 'Комната закрыта.'));
  socket.on('removedFromRoom', data => clearSession(data?.reason || 'Вы удалены из комнаты.'));

  function acceptSession(res) {
    state.spectating = false;
    const sameSession = state.code === res.code && state.myId === res.playerId && Boolean(state.room);
    if (sameSession || state.rehydrateOnNextRoomState) {
      state.rehydrateOnNextRoomState = true;
      resetTransientPresentationState();
    }
    document.body.classList.remove('spectator-mode');
    $('spectatorBanner').classList.add('hidden');
    $('adminPanel').classList.add('hidden');
    state.code = res.code;
    state.myId = res.playerId;
    state.playerToken = res.playerToken;
    closeMapInfo();
    setGameScreenActive(true);
    saveSession();
    if (state.room && !state.rehydrateOnNextRoomState) render();
    $('entry').classList.add('hidden');
    $('game').classList.remove('hidden');
    try {
      const url = new URL(location.href);
      url.searchParams.set('room', state.code);
      history.replaceState(null, '', url);
    } catch {}
  }

  function profile() { return { name: $('nameInput').value, shipClass: $('shipSelect').value, accountToken: state.accountToken }; }

  $('createBtn').addEventListener('click', () => {
    setError('entryError');
    socket.emit('createRoom', profile(), res => {
      if (!res?.ok) return setError('entryError', res?.error || 'Не удалось создать комнату.');
      acceptSession(res);
    });
  });

  function joinRoomByCode(rawCode, automatic = false) {
    setError('entryError');
    const code = String(rawCode || '').trim().toUpperCase();
    if (code.length < 4) return setError('entryError', 'Введите код комнаты.');
    const saved = (() => { try { return JSON.parse(localStorage.getItem(keyFor(code)) || 'null'); } catch { return null; } })();
    socket.emit('joinRoom', { ...profile(), code, playerToken: saved?.playerToken || null }, res => {
      if (!res?.ok) {
        if (automatic) {
          $('entry').classList.remove('hidden');
          return setError('entryError', `Не удалось войти по приглашению: ${res?.error || 'комната недоступна.'}`);
        }
        return setError('entryError', res?.error || 'Не удалось войти.');
      }
      acceptSession(res);
    });
  }

  $('joinBtn').addEventListener('click', () => joinRoomByCode($('codeInput').value));

  $('codeInput').addEventListener('input', e => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 5);
  });

  $('lobbyCopyBtn').addEventListener('click', () => $('copyCodeBtn').click());
  $('lobbyShareBtn').addEventListener('click', () => $('shareInviteBtn').click());
  $('lobbyExitBtn').addEventListener('click', () => {
    if (state.spectating) {
      $('adminBackBtn').click();
      return;
    }
    if (state.room?.hostId === state.myId) $('closeRoomBtn').click();
    else $('leaveRoomBtn').click();
  });
  $('copyCodeBtn').addEventListener('click', async () => {
    const code = state.room?.code || '';
    try {
      await navigator.clipboard.writeText(code);
      $('copyCodeBtn').textContent = 'Скопировано';
      setTimeout(() => $('copyCodeBtn').textContent = 'Скопировать код', 1000);
    } catch {
      $('copyCodeBtn').textContent = code;
    }
  });

  $('shareInviteBtn').addEventListener('click', async () => {
    const code = state.room?.code || '';
    if (!code) return;
    const url = new URL(location.href);
    url.searchParams.set('room', code);
    const inviteUrl = url.toString();
    const shareData = { title: 'Первооткрыватели Online', text: `Комната ${code}`, url: inviteUrl };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(inviteUrl);
        $('shareInviteBtn').textContent = 'Ссылка скопирована';
        setTimeout(() => $('shareInviteBtn').textContent = 'Поделиться ссылкой', 1200);
      }
    } catch (err) {
      if (err?.name !== 'AbortError') {
        try { await navigator.clipboard.writeText(inviteUrl); } catch {}
      }
    }
  });

  $('loginBtn').addEventListener('click', () => submitAuth('login'));
  $('registerBtn').addEventListener('click', () => submitAuth('register'));
  $('authPassword').addEventListener('keydown', e => { if (e.key === 'Enter') submitAuth('login'); });
  $('profileOpenBtn').addEventListener('click', openProfile);
  $('gameAccountBackdrop').addEventListener('click', closeGameAccountMenu);
  $('profileBackBtn').addEventListener('click', closeProfile);
  $('profileSaveBtn').addEventListener('click', saveProfileName);
  $('profilePasswordBtn').addEventListener('click', changeProfilePassword);
  $('profileNewPassword2').addEventListener('keydown', e => { if (e.key === 'Enter') changeProfilePassword(); });
  $('adminOpenBtn').addEventListener('click', showAdminPanel);
  $('adminHomeBtn').addEventListener('click', () => {
    socket.emit('adminStopWatching', {}, () => {});
    loadMyGames();
    state.spectating = false;
    document.body.classList.remove('spectator-mode');
    $('adminPanel').classList.add('hidden');
    $('spectatorBanner').classList.add('hidden');
    $('game').classList.add('hidden');
    $('authPanel').classList.add('hidden');

    if (state.code && state.playerToken) {
      state.rehydrateOnNextRoomState = true;
      socket.emit('resumeRoom', { code: state.code, playerToken: state.playerToken, accountToken: state.accountToken }, res => {
        if (res?.ok) {
          acceptSession(res);
          return;
        }
        state.room = null;
        state.myId = null;
        state.code = null;
        state.playerToken = null;
        $('entry').classList.remove('hidden');
      });
    } else {
      state.room = null;
      state.myId = null;
      $('entry').classList.remove('hidden');
    }
  });
  $('myGamesRefreshBtn').addEventListener('click', loadMyGames);
  $('myGamesOpenBtn').addEventListener('click', () => {
    closeGameAccountMenu();
    socket.emit('goHome', {}, res => {
      if (!res?.ok) return handleGameAck(res);
      state.spectating = false;
      document.body.classList.remove('spectator-mode');
      $('adminPanel').classList.add('hidden');
      $('spectatorBanner').classList.add('hidden');
      clearSession();
    });
  });
  $('adminRefreshBtn').addEventListener('click', loadAdminRooms);
  $('adminBackBtn').addEventListener('click', () => {
    socket.emit('adminStopWatching', {}, () => {});
    showAdminPanel();
  });
  $('logoutBtn').addEventListener('click', () => {
    closeGameAccountMenu();
    if (!confirm('Выйти из аккаунта на этом устройстве?')) return;
    localStorage.removeItem('pervo:accountToken');
    state.accountToken = '';
    state.accountUser = null;
    state.profileOpen = false;
    $('profilePanel').classList.add('hidden');
    loadMyGames();
    socket.disconnect();
    socket.connect();
    state.spectating = false;
    state.room = null;
    state.myId = null;
    state.code = null;
    state.playerToken = null;
    document.body.classList.remove('spectator-mode');
    $('game').classList.add('hidden');
    $('adminPanel').classList.add('hidden');
    $('accountBar').classList.add('hidden');
    showAuth('Вы вышли из аккаунта.');
  });

  $('resultContinueBtn').addEventListener('click', dismissResultCard);
  $('objectSheetClose').addEventListener('click', closeMapInfo);
  $('objectSheetExpand').addEventListener('click', toggleObjectSheetExpanded);
  $('targetingCancelBtn').addEventListener('click', cancelTargeting);
  $('hudPlayerBtn').addEventListener('click', () => { if (!state.spectating) renderFleetOverviewObjectSheet(); });
  $('hudDucatsBtn').addEventListener('click', renderFleetOverviewObjectSheet);
  $('hudGloryBtn').addEventListener('click', () => renderScoreOverlay());
  $('hudArmyBtn').addEventListener('click', renderFleetOverviewObjectSheet);
  $('hudArtilleryBtn').addEventListener('click', renderFleetOverviewObjectSheet);
  $('hudCharacterBtn').addEventListener('click', () => {
    if (state.spectating) return;
    if (isMobileGameplayUi()) renderCharacterObjectSheet();
    else renderFleetOverviewObjectSheet();
  });
  $('hudCardsBtn').addEventListener('click', () => {
    if (state.spectating) return;
    if (isMobileGameplayUi()) renderCardsObjectSheet();
    else renderCardsObjectSheet();
  });
  $('hudGoalsBtn').addEventListener('click', () => {
    if (!state.spectating) renderGoalsObjectSheet();
  });
  $('hudPoliticsBtn').addEventListener('click', () => {
    if (state.spectating) return;
    if (isMobileGameplayUi()) renderDiplomacyObjectSheet(me()?.suzerainId || null);
    else renderDiplomacyObjectSheet(me()?.suzerainId || null);
  });
  $('hudCargoBtn').addEventListener('click', renderFleetOverviewObjectSheet);
  $('hudTurnBtn').addEventListener('click', () => {
    if (isDecisionPending()) renderDecisionLayer();
    else if (!state.spectating) renderFleetOverviewObjectSheet();
  });
  $('hudMenuBtn').addEventListener('click', toggleGameMenu);
  $('gameMenuCloseBtn').addEventListener('click', closeGameMenu);
  $('gameMenuBackdrop').addEventListener('click', closeGameMenu);
  document.querySelectorAll('[data-game-menu]').forEach(button => {
    button.addEventListener('click', () => handleGameMenuAction(button.dataset.gameMenu));
  });
  $('scoreOverlayCloseBtn').addEventListener('click', closeScoreOverlay);
  $('scoreOverlay').querySelector('.score-overlay-backdrop').addEventListener('click', closeScoreOverlay);
  $('journalOverlayCloseBtn').addEventListener('click', closeJournalOverlay);
  $('journalOverlay').querySelector('.journal-overlay-backdrop').addEventListener('click', closeJournalOverlay);
  $('endGameVoteCloseBtn').addEventListener('click', closeEndGameVoteOverlay);
  $('endGameVoteOverlay').querySelector('.end-game-vote-backdrop').addEventListener('click', closeEndGameVoteOverlay);

  $('startBtn').addEventListener('click', () => {
    $('startBtn').disabled = true;
    socket.emit('startGame', {}, res => { handleGameAck(res); if (!res?.ok) renderPlayers(); });
  });

  $('leaveRoomBtn').addEventListener('click', () => {
    if (!state.room || state.room.started) return;
    if (!confirm('Выйти из этой комнаты?')) return;
    socket.emit('leaveRoom', {}, res => {
      if (!res?.ok) return handleGameAck(res);
      clearSession('Вы вышли из комнаты.');
    });
  });

  $('closeRoomBtn').addEventListener('click', () => {
    if (!state.room || state.room.hostId !== state.myId) return;
    if (!confirm('Закрыть комнату для всех игроков? Код комнаты перестанет работать.')) return;
    socket.emit('closeRoom', {}, res => {
      if (res && !res.ok) handleGameAck(res);
    });
  });
  $('rollBtn').addEventListener('click', () => socket.emit('rollMove', {}, res => handleSoundAck(res, 'dice')));
  $('skipBtn').addEventListener('click', () => socket.emit('skipNavigation', {}, handleGameAck));
  $('endTurnBtn').addEventListener('click', () => socket.emit('endTurn', {}, handleGameAck));
  $('mapNavRollBtn').addEventListener('click', () => socket.emit('rollMove', {}, res => handleSoundAck(res, 'dice')));
  $('mapNavStayBtn').addEventListener('click', () => socket.emit('skipNavigation', {}, handleGameAck));
  $('sellCargoBtn').addEventListener('click', () => socket.emit('sellCargo', {}, res => handleSoundAck(res, 'coins')));

  function emitEndGameCommand(event) {
    setError('gameError');
    socket.emit(event, {}, handleGameAck);
  }

  function handleGameAck(res) { setError('gameError', res?.ok ? '' : (res?.error || 'Действие отклонено.')); }
  function handleSoundAck(res, cue) {
    handleGameAck(res);
    if (res?.ok) playSoundCue(cue);
    else if (res && res.ok === false) playSoundCue('error');
  }
  function me() { return state.room?.players.find(p => p.id === state.myId) || null; }
  function active() { return state.room?.players.find(p => p.id === state.room?.activePlayerId) || null; }

  function currentIslands() {
    const mine = me();
    if (!mine) return [];
    return (state.room?.islands || []).filter(island => island.cells.some(([r, c]) => r === mine.row && c === mine.col));
  }

  function currentAnchorCell() {
    const mine = me();
    if (!mine) return null;
    return (state.room?.anchorCells || []).find(a => a.row === mine.row && a.col === mine.col) || null;
  }

  function currentLegendaryPlace() {
    const mine = me();
    if (!mine) return null;
    return (state.room?.map?.legendaryPlaces || []).find(p => p.row === mine.row && p.col === mine.col) || null;
  }

  function playerName(id) { return state.room?.players.find(p => p.id === id)?.name || 'Игрок'; }
  function isDecisionPending() { return Boolean(state.room?.pendingDecision || state.room?.pendingAlliance || state.room?.pendingBattle || state.room?.pendingEvent || state.room?.pendingFeud || state.room?.pendingAssignmentChoice || state.room?.pendingIslandCorrection || state.room?.pendingFleetAdjustment || state.room?.pendingLegendaryReaction); }
  function areAlliesClient(aId, bId) {
    return (state.room?.alliances || []).some(pair => (pair[0] === aId && pair[1] === bId) || (pair[0] === bId && pair[1] === aId));
  }
  function seaAttackPositionClient(attacker, target) {
    if (!attacker || !target) return false;
    return Math.abs(Number(attacker.row) - Number(target.row)) <= 1
      && Math.abs(Number(attacker.col) - Number(target.col)) <= 1;
  }
  function playerOnIslandClient(player, island) {
    return Boolean(player && island?.cells?.some(([r, c]) => r === player.row && c === player.col));
  }
  function islandOwnerLabel(island) {
    if (island.ownerId) return playerName(island.ownerId);
    if (island.kind === 'free') return 'Свободен';
    if (island.kind === 'independent') return 'Независим';
    return island.faction || 'Государство';
  }


  function metricValue(value, hidden = 'скрыто') {
    return value == null ? hidden : String(value);
  }

  function projectedWealthLabel(player) {
    if (!player || !Object.hasOwn(player, 'ducats')) return 'скрыто';
    const debt = Object.hasOwn(player, 'debt') ? Number(player.debt) || 0 : 0;
    return String((Number(player.ducats) || 0) - debt);
  }

  function renderScoreOverlay() {
    const room = state.room;
    if (!room) return;
    closeGameMenu();
    closeMapInfo();
    const finished = Boolean(room.finished || room.phase === 'finished');
    $('scoreOverlayTitle').textContent = finished ? 'Финальные показатели' : 'Текущие показатели';
    $('scoreOverlayNote').textContent = finished
      ? 'Финальные значения взяты из canonical finalResult.'
      : 'Показываются только данные, уже разрешённые server-side visibility. Скрытые показатели не вычисляются на клиенте.';
    const body = $('scoreOverlayBody');
    body.innerHTML = '';
    if (finished) {
      const rows = room.finalResult?.playerMetrics || [];
      for (const row of rows) {
        const player = room.players?.find(item => item.id === row.playerId);
        const metrics = row.metrics || {};
        const card = document.createElement('article');
        card.className = 'score-player-card';
        card.innerHTML = '<h3>' + escapeHtml(player?.name || playerName(row.playerId)) + '</h3>'
          + '<div class="score-metric-grid">'
          + '<span>Острова</span><strong>' + metricValue(metrics.islands) + '</strong>'
          + '<span>Богатство</span><strong>' + metricValue(metrics.wealth) + '</strong>'
          + '<span>Army points</span><strong>' + metricValue(metrics.army) + '</strong>'
          + '<span>Fleet points</span><strong>' + metricValue(metrics.fleet) + '</strong>'
          + '<span>Престиж</span><strong>' + metricValue(metrics.prestige) + '</strong>'
          + '<span>Легендарные места</span><strong>' + metricValue(metrics.legendaryPlaces) + '</strong></div>';
        body.appendChild(card);
      }
    } else {
      for (const player of room.players || []) {
        const card = document.createElement('article');
        card.className = 'score-player-card';
        card.innerHTML = '<h3>' + escapeHtml(player.name) + '</h3>'
          + '<div class="score-metric-grid">'
          + '<span>Острова</span><strong>' + metricValue(player.islandCount) + '</strong>'
          + '<span>Богатство</span><strong>' + projectedWealthLabel(player) + '</strong>'
          + '<span>Army points</span><strong>' + metricValue(player.armyPoints) + '</strong>'
          + '<span>Fleet points</span><strong>' + metricValue(player.fleetPoints) + '</strong>'
          + '<span>Престиж</span><strong>скрыто</strong>'
          + '<span>Легендарные места</span><strong>скрыто</strong></div>';
        body.appendChild(card);
      }
    }
    $('scoreOverlay').classList.remove('hidden');
    document.body.classList.add('score-overlay-open');
  }

  function closeScoreOverlay() {
    $('scoreOverlay')?.classList.add('hidden');
    document.body.classList.remove('score-overlay-open');
  }

  function openMenuInfoSheet(kind) {
    const room = state.room;
    if (!room) return;
    closeGameMenu();
    state.mapSelection = { kind: 'menu', id: kind };
    $('objectSheetKind').textContent = 'МЕНЮ';
    const body = $('objectSheetBody');
    const actions = $('objectSheetActions');
    actions.innerHTML = '';
  
    if (kind === 'holdings') {
      $('objectSheetTitle').textContent = 'Мои владения';
      const islands = (room.islands || []).filter(island => island.ownerId === state.myId);
      body.innerHTML = islands.map(island =>
        '<div class="menu-holding-row"><strong>' + escapeHtml(island.name) + '</strong><span>'
        + escapeHtml(island.status || '—') + ' · площадь ' + (island.usedArea ?? 0) + '/'
        + (island.effectiveArea ?? island.area ?? 0) + '</span></div>'
      ).join('') || '<div class="menu-note">У вас пока нет островов.</div>';
    } else if (kind === 'help') {
      $('objectSheetTitle').textContent = 'Справка';
      body.innerHTML = '<div class="menu-help-block"><strong>Карта</strong><span>Основное игровое пространство. Нажимайте на острова, корабли, якоря и другие объекты.</span></div>'
        + '<div class="menu-help-block"><strong>Нижняя панель</strong><span>Показывает главное действие текущего состояния хода.</span></div>'
        + '<div class="menu-help-block"><strong>Обязательные решения</strong><span>Появляются поверх карты и блокируют продолжение, пока сервер ждёт ваш выбор.</span></div>';
    } else if (kind === 'endgame') {
      $('objectSheetTitle').textContent = 'Завершение игры';
      renderEndGame();
      body.innerHTML = '<div class="menu-help-block"><strong>' + escapeHtml($('endGameTitle').textContent)
        + '</strong><span>' + escapeHtml($('endGameSummary').textContent) + '</span></div>';
      const openLegacy = document.createElement('button');
      openLegacy.type = 'button';
      openLegacy.className = 'primary';
      openLegacy.textContent = 'Открыть согласование';
      openLegacy.addEventListener('click', () => { closeMapInfo(); closeMapInfo(); });
      actions.appendChild(openLegacy);
    }
  
    $('objectSheet').classList.remove('hidden');
    $('objectSheet').classList.add('expanded');
    $('objectSheetExpand').textContent = '⌄';
    $('objectSheetExpand').setAttribute('aria-label', 'Свернуть карточку');
    document.body.classList.add('object-sheet-open');
  }

  function handleGameMenuAction(kind) {
    if (kind === 'metrics') {
      renderScoreOverlay();
      return;
    }
    if (kind === 'journal') {
      renderJournalOverlay();
      return;
    }
    if (kind === 'endgame') {
      openEndGameVoteOverlay();
      return;
    }
    if (kind === 'diplomacy') {
      closeGameMenu();
      renderDiplomacyObjectSheet(null);
      return;
    }
    if (kind === 'settings') {
      closeGameMenu();
      openGameAccountMenu();
      return;
    }
    if (kind === 'exit') {
      closeGameMenu();
      $('logoutBtn').click();
      return;
    }
    openMenuInfoSheet(kind);
  }


  function cargoSummary(player, room) {
    if (!player) return { quantity: 0, capacity: 0 };
    const escortCatalog = room?.escortCatalog || {};
    // Временно неактивное из-за уровня грузовое сопровождение сохраняет уже
    // погруженный груз. HUD поэтому показывает его груз и физический трюм,
    // хотя грузить/продавать через это судно до восстановления уровня нельзя.
    const cargoEscorts = (player.escorts || []).filter(e => (escortCatalog[e.type]?.cargo || 0) > 0);
    const quantity = (player.cargo?.quantity || 0) + cargoEscorts.reduce((sum, e) => sum + (e.cargo?.quantity || 0), 0);
    const capacity = (player.cargoCapacity || 0) + cargoEscorts.reduce((sum, e) => sum + (escortCatalog[e.type]?.cargo || 0), 0);
    return { quantity, capacity };
  }

  function hudPhaseLabel(room, activePlayer) {
    if (!room?.started) return 'ЛОББИ';
    if (room.finished || room.phase === 'finished') return 'ЗАВЕРШЕНО';
    if (room.eventPhase?.active || room.phase === 'event') return 'СОБЫТИЯ';
    const phase = activePlayer?.phase || room.phase;
    if (phase === 'navigation') return 'НАВИГАЦИЯ';
    if (phase === 'actions') return 'ДЕЙСТВИЯ';
    return String(phase || 'ОЖИДАНИЕ').toUpperCase();
  }

  function renderMobileHud() {
    const r = state.room;
    if (!r) return;
    const mine = me();
    const activePlayer = active();
    $('hudResources').classList.toggle('hidden', !mine);

    if (mine) {
      const cargo = cargoSummary(mine, r);
      $('hudPlayerName').textContent = mine.name;
      $('hudShipLevel').textContent = `${shipName(mine.shipClass)} · ${ROMAN[mine.level] || mine.level}`;
      $('hudDucats').textContent = mine.ducats ?? 0;
      $('hudGlory').textContent = mine.glory ?? 0;
      $('hudArmy').textContent = mine.assaultArmy ?? mine.stats?.army ?? 0;
      $('hudArtillery').textContent = mine.fleetArtillery ?? mine.stats?.artillery ?? 0;
      $('hudCargo').textContent = `${cargo.quantity}/${cargo.capacity}`;
      $('hudCharacter').textContent = mine.character?.name ? mine.character.name.slice(0, 3) : '—';
      $('hudCharacterBtn').title = mine.character?.name || 'Персонаж не нанят';
      $('hudCards').textContent = String(digitalCardEntries(mine).length);
      $('hudGoals').textContent = String(activeGoalCount(mine));
      const suzerain = mine.suzerainId ? r.factions?.find(faction => faction.id === mine.suzerainId) : null;
      $('hudPolitics').textContent = suzerain ? String(suzerain.name || '⚜').slice(0, 3) : ((mine.enemyFactionIds || []).length ? '⚔' : '—');
      $('hudPoliticsBtn').title = suzerain
        ? `Сюзерен: ${suzerain.name}`
        : ((mine.enemyFactionIds || []).length ? `Вражда с государствами: ${(mine.enemyFactionIds || []).length}` : 'Дипломатия');
    } else {
      $('hudPlayerName').textContent = state.spectating ? 'Наблюдение' : 'Игрок';
      $('hudShipLevel').textContent = state.spectating ? `Комната ${r.code}` : '—';
      $('hudCharacter').textContent = '—';
      $('hudCards').textContent = '0';
      $('hudGoals').textContent = '0';
      $('hudPolitics').textContent = '—';
      $('hudPoliticsBtn').title = 'Дипломатия';
    }

    const lastRound = r.endGameConsensus?.status === 'accepted';
    $('hudRound').textContent = !r.started
      ? `Лобби · ${r.players.length}/${r.balanceCatalog.session.players.max}`
      : lastRound
        ? `Последний раунд · ${r.round} · круг ${r.circle}/${r.balanceCatalog.session.circlesPerRound}`
        : `Раунд ${r.round} · круг ${r.circle}/${r.balanceCatalog.session.circlesPerRound}`;
    $('hudTurn').textContent = !r.started
      ? 'Ожидание старта'
      : r.eventPhase?.active
        ? (r.eventPhase.currentPlayerId ? `События · ${playerName(r.eventPhase.currentPlayerId)}` : 'Фаза событий')
        : activePlayer
          ? (activePlayer.id === state.myId ? 'Ваш ход' : `Ход: ${activePlayer.name}`)
          : 'Ожидание';
    $('hudPhase').textContent = hudPhaseLabel(r, activePlayer);
  }


  function updateContextualActionPanels() {
    const r = state.room;
    const mine = me();
    if (!r) return;

    const set = (selector, relevant, order = 50) => {
      const el = document.querySelector(selector);
      if (!el) return;
      el.classList.toggle('context-hidden', !relevant);
      el.style.order = String(order);
    };

    const pendingEventForMe = Boolean(r.pendingEvent?.viewerCanRespond || r.pendingFeud?.viewerCanRespond);
    const pendingIslandCorrection = Boolean(r.pendingIslandCorrection);
    const pendingFleetAdjustment = Boolean(r.pendingFleetAdjustment);
    const pendingAssignment = Boolean(r.pendingAssignmentChoice?.viewerCanRespond);
    const activeAssignment = Boolean(mine?.activeAssignment);
    const legendsRelevant = Boolean(r.started);
    const onIsland = currentIslands().length > 0;
    const anchorRelevant = Boolean(currentAnchorCell());
    const pendingCombat = Boolean(r.pendingBattle || r.pendingLegendaryReaction);
    const myTurnActions = Boolean(r.started && mine && r.activePlayerId === state.myId && mine.phase === 'actions' && (mine.actionsLeft ?? 0) > 0);
    const seaTargets = mine ? r.players.some(p => p.id !== state.myId && seaAttackPositionClient(mine, p) && !areAlliesClient(state.myId, p.id)) : false;
    const islandTargets = mine ? currentIslands().some(i => i.ownerId !== state.myId && !(i.kind === 'free' && !i.ownerId) && (!i.ownerId || !areAlliesClient(state.myId, i.ownerId))) : false;
    const combatRelevant = pendingCombat || (myTurnActions && !mine?.inPeaceZone && (seaTargets || islandTargets));

    set('.controls', true, 20);
    set('.event-panel', Boolean(r.eventPhase?.active || pendingEventForMe), pendingEventForMe ? 1 : 12);
    set('.island-correction-panel', pendingIslandCorrection, r.pendingIslandCorrection?.viewerCanRespond ? 0 : 4);
    set('.fleet-adjustment-panel', pendingFleetAdjustment, r.pendingFleetAdjustment?.viewerCanRespond ? 0 : 4);
    set('.assignment-panel', pendingAssignment || activeAssignment, pendingAssignment ? 2 : 30);
    set('.legendary-places-panel', legendsRelevant, mine?.activeExpedition || mine?.canTakeExpedition ? 18 : 32);
    set('.anchor-panel', anchorRelevant, 40);
    set('.island-panel', onIsland, 25);
    set('.combat-panel', combatRelevant, pendingCombat ? 3 : 27);

  }

  function openEndGameVoteOverlay() {
    if (!state.room?.started || state.room.finished || state.room.phase === 'finished') return;
    closeGameMenu();
    closeMapInfo();
    renderEndGameVoteOverlay(true);
  }

  function closeEndGameVoteOverlay() {
    const consensus = state.room?.endGameConsensus;
    const confirmed = new Set((consensus?.confirmedPlayerIds || []).map(String));
    const mustRespond = consensus?.status === 'proposed' && !state.spectating && !confirmed.has(String(state.myId));
    if (mustRespond) return;
    $('endGameVoteOverlay')?.classList.add('hidden');
    document.body.classList.remove('end-game-vote-open');
  }

  function renderEndGameVoteOverlay(forceOpen = false) {
    const room = state.room;
    const overlay = $('endGameVoteOverlay');
    if (!overlay) return;
    const consensus = room?.endGameConsensus;
    const proposed = consensus?.status === 'proposed';
    const accepted = consensus?.status === 'accepted';
    if (!room?.started || room.finished || room.phase === 'finished' || accepted) {
      overlay.classList.add('hidden');
      document.body.classList.remove('end-game-vote-open');
      return;
    }

    const confirmed = new Set((consensus?.confirmedPlayerIds || []).map(String));
    const mineConfirmed = confirmed.has(String(state.myId));
    const shouldOpen = forceOpen || proposed;
    if (!shouldOpen) return;

    $('endGameVoteTitle').textContent = proposed ? 'Завершить партию после этого раунда?' : 'Завершение игры';
    $('endGameVoteSummary').textContent = proposed
      ? `Предложил: ${playerName(consensus.proposedById)}. Нужно согласие всех игроков.`
      : 'Если все игроки согласятся, партия завершится после полного текущего раунда.';

    const players = $('endGameVotePlayers');
    players.innerHTML = '';
    if (proposed) {
      for (const player of room.players || []) {
        const row = document.createElement('div');
        row.className = 'end-game-vote-player';
        const yes = confirmed.has(String(player.id));
        row.innerHTML = `<span>${escapeHtml(player.name)}</span><strong>${yes ? 'Согласился' : 'Ожидается ответ'}</strong>`;
        players.appendChild(row);
      }
    }

    const actions = $('endGameVoteActions');
    actions.innerHTML = '';
    if (!state.spectating && !proposed) {
      const propose = document.createElement('button');
      propose.type = 'button';
      propose.className = 'primary';
      propose.textContent = 'Предложить завершение партии';
      propose.addEventListener('click', () => emitEndGameCommand('proposeEndGame'));
      actions.appendChild(propose);
    } else if (!state.spectating && proposed && !mineConfirmed) {
      const confirmButton = document.createElement('button');
      confirmButton.type = 'button';
      confirmButton.className = 'primary';
      confirmButton.textContent = 'Согласиться';
      confirmButton.addEventListener('click', () => emitEndGameCommand('confirmEndGame'));
      const rejectButton = document.createElement('button');
      rejectButton.type = 'button';
      rejectButton.className = 'danger-soft';
      rejectButton.textContent = 'Отклонить';
      rejectButton.addEventListener('click', () => emitEndGameCommand('rejectEndGame'));
      actions.append(confirmButton, rejectButton);
    } else if (proposed) {
      const waiting = document.createElement('div');
      waiting.className = 'end-game-vote-waiting';
      waiting.textContent = state.spectating ? 'Ожидается решение игроков.' : 'Ваш голос учтён. Ожидаем остальных игроков.';
      actions.appendChild(waiting);
    }

    $('endGameVoteCloseBtn').classList.toggle('hidden', proposed && !state.spectating && !mineConfirmed);
    overlay.classList.remove('hidden');
    document.body.classList.add('end-game-vote-open');
  }

  function renderEndGame() {
    const r = state.room;
    if (typeof renderEndGameVoteOverlay === 'function') renderEndGameVoteOverlay();
    const panel = $('endGamePanel');
    const finalPanel = $('finalResultsPanel');
    const finished = Boolean(r?.finished || r?.phase === 'finished');
    $('game').classList.toggle('finished-state', finished);
    finalPanel.classList.toggle('hidden', !finished);

    if (finished) {
      panel.classList.add('hidden');
      if (typeof closeGameMenu === 'function') closeGameMenu();
      if (typeof closeGameAccountMenu === 'function') closeGameAccountMenu();
      if (typeof closeScoreOverlay === 'function') closeScoreOverlay();
      if (typeof closeJournalOverlay === 'function') closeJournalOverlay();
      if (typeof closeEndGameVoteOverlay === 'function') closeEndGameVoteOverlay();
      if (typeof closeMapInfo === 'function') closeMapInfo();
      state.targeting = null;
      state.activeResult = null;
      state.resultQueue = [];
      state.toastQueue = [];
      $('decisionLayer')?.classList.add('hidden');
      $('resultLayer')?.classList.add('hidden');
      $('targetingBar')?.classList.add('hidden');
      $('eventFlowOverlay')?.classList.add('hidden');
      document.body?.classList?.remove('decision-layer-open', 'result-layer-open', 'object-sheet-open', 'mobile-sheet-open', 'score-overlay-open', 'journal-overlay-open', 'end-game-vote-open');
      const result = r.finalResult || { titles: [], playerMetrics: [] };
      $('finalResultsRound').textContent = result.finishedRound == null ? '' : `Финальная граница: раунд ${result.finishedRound}`;

      const titles = $('finalTitles');
      titles.innerHTML = '';
      for (const title of result.titles || []) {
        const card = document.createElement('article');
        card.className = 'final-title-card';
        const winners = (title.winnerIds || []).map(playerName).join(', ') || 'Нет обладателя';
        card.innerHTML = `<span class="final-title-name">${escapeHtml(title.name)}</span><strong>${title.maxValue ?? 0}</strong><span class="final-title-metric">${escapeHtml(title.metric || '')}</span><div class="final-title-winners">${escapeHtml(winners)}</div>`;
        titles.appendChild(card);
      }

      const metrics = $('finalPlayerMetrics');
      metrics.innerHTML = '';
      const labels = [
        ['islands', 'Владения'],
        ['wealth', 'Казна'],
        ['army', 'Армия'],
        ['fleet', 'Флот'],
        ['prestige', 'Престиж'],
        ['legendaryPlaces', 'Легендарные места'],
      ];
      for (const row of result.playerMetrics || []) {
        const card = document.createElement('article');
        card.className = 'final-player-card';
        const name = document.createElement('h3');
        name.textContent = playerName(row.playerId);
        const grid = document.createElement('div');
        grid.className = 'final-player-metrics';
        for (const [key, label] of labels) {
          const metricLabel = document.createElement('span');
          metricLabel.textContent = label;
          const value = document.createElement('strong');
          value.textContent = String(row.metrics?.[key] ?? 0);
          grid.append(metricLabel, value);
        }
        card.append(name, grid);
        metrics.appendChild(card);
      }
      return;
    }

    if (!r?.started) {
      panel.classList.add('hidden');
      return;
    }

    panel.classList.remove('hidden');
    const consensus = r.endGameConsensus;
    const actions = $('endGameActions');
    const confirmations = $('endGameConfirmations');
    actions.innerHTML = '';
    confirmations.innerHTML = '';

    if (consensus?.status === 'accepted') {
      $('endGameBadge').textContent = 'принято';
      $('endGameTitle').textContent = 'Завершение согласовано';
      $('endGameSummary').textContent = `Партия завершится после окончания раунда ${consensus.finishAfterRound}`;
      return;
    }

    if (consensus?.status === 'proposed') {
      const confirmed = new Set((consensus.confirmedPlayerIds || []).map(String));
      $('endGameBadge').textContent = `${confirmed.size}/${r.players.length}`;
      $('endGameTitle').textContent = 'Предложено завершить партию';
      $('endGameSummary').textContent = `Предложил: ${playerName(consensus.proposedById)}. Согласились ${confirmed.size} из ${r.players.length}.`;

      for (const player of r.players) {
        const item = document.createElement('div');
        item.className = 'end-game-confirmation';
        const accepted = confirmed.has(String(player.id));
        item.innerHTML = `<span>${escapeHtml(player.name)}</span><strong>${accepted ? 'Согласился' : 'Ожидается ответ'}</strong>`;
        confirmations.appendChild(item);
      }

      const mineConfirmed = confirmed.has(String(state.myId));
      if (!state.spectating && !mineConfirmed) {
        const confirmButton = document.createElement('button');
        confirmButton.type = 'button';
        confirmButton.className = 'primary';
        confirmButton.textContent = 'Согласиться';
        confirmButton.addEventListener('click', () => emitEndGameCommand('confirmEndGame'));
        const rejectButton = document.createElement('button');
        rejectButton.type = 'button';
        rejectButton.className = 'danger-soft';
        rejectButton.textContent = 'Отклонить';
        rejectButton.addEventListener('click', () => emitEndGameCommand('rejectEndGame'));
        actions.append(confirmButton, rejectButton);
      } else if (!state.spectating) {
        const waiting = document.createElement('div');
        waiting.className = 'muted end-game-waiting';
        waiting.textContent = 'Ваше согласие учтено. Ожидаем остальных игроков.';
        actions.appendChild(waiting);
      }
      return;
    }

    $('endGameBadge').textContent = 'служебное';
    $('endGameTitle').textContent = 'Завершение партии';
    $('endGameSummary').textContent = 'Если все игроки согласятся, партия завершится после полного текущего раунда.';
    if (!state.spectating) {
      const propose = document.createElement('button');
      propose.type = 'button';
      propose.className = 'end-game-propose';
      propose.textContent = 'Предложить завершение партии';
      propose.addEventListener('click', () => emitEndGameCommand('proposeEndGame'));
      actions.appendChild(propose);
    }
  }

  function render() {
    const r = state.room;
    if (!r) return;
    setGameScreenActive(true);
    $('entry').classList.add('hidden');
    $('game').classList.remove('hidden');
    $('roomCode').textContent = r.code;
    $('roundLabel').textContent = !r.started ? 'Лобби' : `Раунд ${r.round} · круг ${r.circle}/${r.balanceCatalog.session.circlesPerRound}${r.eventPhase?.active ? ' · события' : ''}`;
    const a = active();
    const eventPlayer = r.eventPhase?.currentPlayerId ? r.players.find(p => p.id === r.eventPhase.currentPlayerId) : null;
    $('turnLabel').textContent = !r.started ? `Игроков: ${r.players.length}/${r.balanceCatalog.session.players.max}` : r.eventPhase?.active ? `Событие: ${eventPlayer?.name || '—'}` : (a ? `Ход: ${a.name}` : '—');

    const mine = me();
    renderLobbyShell();
    renderMobileHud();
    renderEndGame();
    if (r.finished || r.phase === 'finished') return;
    if (mine) {
      const cards = mine.specialCards?.length ? ` · особые карты: ${mine.specialCards.join(', ')}` : '';
      const cargo = mine.landCompany ? ` · трюм: рота +${mine.landCompany.army}` : (mine.cargo ? ` · трюм: ${state.room.goodsCatalog?.[mine.cargo.goodId]?.name || mine.cargo.goodId} ×${mine.cargo.quantity}` : ' · трюм пуст');
      const eventHand = mine.savedEventCardCount ? ` · событий в руке: ${mine.savedEventCardCount}` : '';
      const legendary = mine.legendaryCardCount ? ` · легендарных: ${mine.legendaryCardCount}` : '';
      const skip = mine.skipTurns ? ` · пропусков хода: ${mine.skipTurns}` : '';
      const suzerain = mine.suzerainId ? r.factions?.find(f => f.id === mine.suzerainId)?.name : null;
      const politics = suzerain ? ` · вассал: ${suzerain}` : (mine.enemyFactionIds?.length ? ` · вражда: ${mine.enemyFactionIds.length}` : '');
      $('youStatus').innerHTML = `<strong>${escapeHtml(mine.name)}</strong><br><span class="muted">${escapeHtml(shipName(mine.shipClass))} ${ROMAN[mine.level] || mine.level} · ${mine.ducats} дукатов${mine.debt ? ` · долг ${mine.debt}` : ''} · очки армии ${mine.armyPoints || 0} · очки флота ${mine.fleetPoints || 0} · слава ${mine.glory || 0} · островов ${mine.islandCount} · клетка ${mine.col + 1}:${mine.row + 1}${escapeHtml(cargo)}${escapeHtml(cards)}${escapeHtml(eventHand)}${escapeHtml(legendary)}${escapeHtml(skip)}${escapeHtml(politics)}</span>`;
    }

    renderGameRoster();
    renderPlayers();
    renderControls();
    renderGameActionBar();
    renderMapNavigation();
    renderMapContext();
    renderEvents();
    renderPolitics();
    renderIslandCorrection();
    renderFleetAdjustment();
    renderAssignments();
    renderLegendaryPlaces();
    refreshOpenGoalsSheet();
    renderLegendary();
    refreshOpenCardsSheet();
    renderFleet();
    refreshOpenCharacterSheet();
    renderTrade();
    refreshOpenCitadelSheet();
    renderAnchors();
    refreshOpenAnchorSheet();
    renderIsland();
    renderAlliances();
    renderCombat();
    refreshOpenSeaBattleFlow();
    refreshOpenAssaultFlow();
    renderEventFlowOverlay();
    renderDecisionLayer();
    renderResultLayer();
    renderToastStack();
    renderTargetingBar();
    renderMap();
    updateContextualActionPanels();
  }

  function renderGameRoster() {
    const roster = $('gameRoster');
    const r = state.room;
    if (!roster || !r?.started || r.finished || r.phase === 'finished') {
      roster?.classList.add('hidden');
      if (roster) roster.innerHTML = '';
      return;
    }

    roster.innerHTML = '';
    roster.classList.remove('hidden');
    const orderedIds = Array.isArray(r.order) && r.order.length ? r.order : r.players.map(player => player.id);
    const activeIndex = orderedIds.indexOf(r.activePlayerId);
    const nextPlayerId = orderedIds.length > 1 && activeIndex >= 0
      ? orderedIds[(activeIndex + 1) % orderedIds.length]
      : null;

    for (const id of orderedIds) {
      const player = r.players.find(item => item.id === id);
      if (!player) continue;
      const isActive = player.id === r.activePlayerId;
      const isNext = !isActive && player.id === nextPlayerId;
      const turnStatus = isActive ? 'active' : isNext ? 'next' : 'waiting';

      const button = document.createElement('button');
      button.type = 'button';
      button.className = `roster-player turn-${turnStatus}`;
      if (player.id === state.myId) button.classList.add('you');
      if (player.id !== state.myId && areAlliesClient(state.myId, player.id)) button.classList.add('ally');
      button.setAttribute('aria-label', `${player.name}: ${shipName(player.shipClass)}; ${isActive ? 'ходит сейчас' : isNext ? 'ходит следующим' : 'ожидает хода'}`);

      const token = document.createElement('span');
      token.className = 'roster-token';
      token.style.background = player.color;
      token.textContent = String(player.name || '?').trim().slice(0, 1).toUpperCase() || '?';

      const copy = document.createElement('span');
      copy.className = 'roster-copy';

      const nameRow = document.createElement('span');
      nameRow.className = 'roster-name-row';

      const name = document.createElement('span');
      name.className = 'roster-name';
      name.textContent = player.id === state.myId ? 'Вы' : player.name;

      const status = document.createElement('span');
      status.className = `roster-turn-dot roster-turn-dot-${turnStatus}`;
      status.setAttribute('aria-hidden', 'true');

      const ship = document.createElement('span');
      ship.className = 'roster-ship';
      ship.textContent = shipName(player.shipClass);

      nameRow.append(name, status);
      copy.append(nameRow, ship);
      button.append(token, copy);
      button.addEventListener('click', () => {
        if (isDecisionPending()) return;
        showPlayerMapInfo(player);
      });
      roster.appendChild(button);
    }
  }

  function renderLobbyShell() {
    const r = state.room;
    const game = $('game');
    const lobby = Boolean(r && !r.started && !r.finished && r.phase !== 'finished');
    game.classList.toggle('lobby-state', lobby);
    document.body.classList.toggle('game-lobby-active', lobby);
    $('lobbyHero')?.classList.toggle('hidden', !lobby);
    $('lobbyToolbar')?.classList.toggle('hidden', !lobby);
    if (!lobby) return;

    const min = Number(r.balanceCatalog?.session?.players?.min) || 2;
    const max = Number(r.balanceCatalog?.session?.players?.max) || 6;
    const connected = (r.players || []).filter(player => player.connected).length;
    const ready = (r.players || []).filter(player => player.ready && player.connected).length;
    const isHost = r.hostId === state.myId;
    const mine = me();

    $('lobbyRoomCode').textContent = r.code || '—';
    $('lobbyCapacity').textContent = `${r.players.length}/${max} игроков · минимум ${min}`;
    $('lobbyRole').textContent = state.spectating ? 'Наблюдатель' : isHost ? 'Организатор' : (mine?.id === r.leaderId ? 'Ведущий' : 'Игрок');
    $('lobbyConnectionStatus').textContent = connected === r.players.length
      ? `Все подключены · готовы ${ready}/${r.players.length}`
      : `Подключены ${connected}/${r.players.length} · ждём reconnect`;
    $('lobbyReadySummary').textContent = r.players.length < min
      ? `Нужно минимум ${min} игрока`
      : `Готовы ${ready} из ${r.players.length}`;
    $('lobbyStatusText').textContent = state.spectating
      ? 'Наблюдение за подготовкой партии. Игровые настройки доступны участникам комнаты.'
      : isHost
        ? 'Настройте порядок мест и ведущего, затем дождитесь готовности всех игроков.'
        : 'Выберите корабль, подтвердите готовность и дождитесь старта организатором.';

    $('lobbyExitBtn').textContent = state.spectating ? 'Назад' : isHost ? 'Закрыть комнату' : 'Выйти';
    $('lobbyExitBtn').classList.toggle('hidden', false);
  }

  function renderPlayers() {
    const r = state.room;
    if (!r.started) renderLobbyShell();
    $('players').innerHTML = '';
    const isHost = r.hostId === state.myId;
    const isSpectator = state.spectating;
    const seats = r.seatingOrder?.length === r.players.length ? r.seatingOrder : r.players.map(p => p.id);
    const shown = r.started ? r.order : seats;
    const sendLobbyChange = (button, event, payload) => {
      button.disabled = true;
      socket.emit(event, payload, res => { handleGameAck(res); if (!res?.ok) button.disabled = false; });
    };
    shown.map(id => r.players.find(p => p.id === id)).filter(Boolean).forEach(p => {
      const order = r.started ? r.order.indexOf(p.id) + 1 : seats.indexOf(p.id) + 1;
      const el = document.createElement('div');
      el.className = 'player-card';
      const cargoLabel = p.landCompany ? ` · рота +${p.landCompany.army}` : (p.cargo ? ` · груз ${state.room.goodsCatalog?.[p.cargo.goodId]?.name || p.cargo.goodId} ×${p.cargo.quantity}` : '');
      const suzerainName = p.suzerainId ? state.room.factions?.find(f => f.id === p.suzerainId)?.name : null;
      const politicalLabel = suzerainName ? ` · вассал ${suzerainName}` : (p.enemyFactionIds?.length ? ` · вражда ${p.enemyFactionIds.length}` : '');
      const readyLabel = !r.started ? (p.ready ? ' · ✓ готов' : ' · не готов') : '';
      const moneyLabel = Object.hasOwn(p, 'ducats') ? ` · ${p.ducats} дукатов${Object.hasOwn(p, 'debt') && p.debt ? ` · долг ${p.debt}` : ''}` : '';
      el.innerHTML = `<span class="player-dot" style="background:${p.color}"></span><div class="player-meta"><div class="player-name">${escapeHtml(p.name)}${p.isYou ? ' · вы' : ''}${p.id === r.leaderId ? ' · ведущий' : ''}${!p.connected ? ' · офлайн' : ''}${readyLabel}</div><div class="player-sub">${r.started ? `Ход ${order}` : `Место ${order} по часовой стрелке`} · ${escapeHtml(shipName(p.shipClass))} ${ROMAN[p.level] || p.level}${moneyLabel} · армия ${p.armyPoints || 0} · флот ${p.fleetPoints || 0} · слава ${p.glory || 0} · островов ${p.islandCount} · именных ${p.namedPlaceCardCount || 0} · экспедиций ${p.expeditionHistoryCount || 0} · эскорт ${p.escorts?.length || 0}${p.skipTurns ? ` · пропуск ${p.skipTurns}` : ''}${escapeHtml(cargoLabel)}${escapeHtml(politicalLabel)}</div></div><div class="player-side-actions"><span class="order-badge">${r.started ? `#${order}` : ''}</span></div>`;
      if (!isSpectator && isHost && !r.started) {
        const actions = el.querySelector('.player-side-actions');
        if (p.id !== r.leaderId) {
          const leader = document.createElement('button'); leader.className = 'seat-btn'; leader.textContent = 'Ведущий';
          leader.addEventListener('click', () => sendLobbyChange(leader, 'setLeader', { playerId: p.id }));
          actions.appendChild(leader);
        }
        for (const [step, label] of [[-1, 'Раньше'], [1, 'Позже']]) {
          const target = seats.indexOf(p.id) + step;
          if (target < 0 || target >= seats.length) continue;
          const button = document.createElement('button'); button.className = 'seat-btn'; button.textContent = label;
          button.addEventListener('click', () => {
            const ids = [...seats]; [ids[target], ids[target - step]] = [ids[target - step], ids[target]];
            sendLobbyChange(button, 'setSeatingOrder', { playerIds: ids });
          });
          actions.appendChild(button);
        }
      }
      if (!isSpectator && !r.started && p.isYou) {
        const label = document.createElement('label');
        label.className = 'lobby-ship-label';
        label.textContent = 'Класс корабля';
        const shipSelect = document.createElement('select');
        shipSelect.setAttribute('aria-label', 'Класс вашего корабля');
        for (const [id, ship] of Object.entries(r.shipCatalog || {})) {
          const option = document.createElement('option');
          option.value = id; option.textContent = ship.name;
          shipSelect.appendChild(option);
        }
        shipSelect.value = p.shipClass;
        shipSelect.disabled = p.id === r.leaderId;
        shipSelect.addEventListener('change', () => {
          shipSelect.disabled = true;
          socket.emit('changeShip', { shipClass: shipSelect.value }, res => {
            handleGameAck(res);
            if (!res?.ok) { shipSelect.value = p.shipClass; shipSelect.disabled = p.id === r.leaderId; }
          });
        });
        label.appendChild(shipSelect);
        el.querySelector('.player-meta').appendChild(label);
        const readyBtn = document.createElement('button');
        readyBtn.className = p.ready ? 'small danger-soft' : 'small primary';
        readyBtn.textContent = p.ready ? 'Снять готовность' : 'Готов';
        readyBtn.addEventListener('click', () => socket.emit('setReady', { ready: !p.ready }, handleGameAck));
        el.querySelector('.player-side-actions').appendChild(readyBtn);
      }
      if (!isSpectator && isHost && !r.started && !p.isYou) {
        const kick = document.createElement('button');
        kick.className = 'small danger-soft';
        kick.textContent = 'Удалить';
        kick.addEventListener('click', () => {
          if (!confirm(`Удалить ${p.name} из комнаты?`)) return;
          socket.emit('kickPlayer', { playerId: p.id }, handleGameAck);
        });
        el.querySelector('.player-side-actions').appendChild(kick);
      }
      $('players').appendChild(el);
    });
    const allReady = r.players.length >= r.balanceCatalog.session.players.min && r.players.every(p => p.ready && p.connected);
    const waitingReady = r.players.filter(p => !p.ready || !p.connected).length;
    $('startBtn').classList.toggle('hidden', isSpectator || r.started || !isHost);
    $('startBtn').disabled = r.players.length < r.balanceCatalog.session.players.min || r.players.length > r.balanceCatalog.session.players.max || !r.leaderId || !allReady;
    $('startBtn').textContent = r.players.length < r.balanceCatalog.session.players.min ? `Нужно ещё игроков: ${r.balanceCatalog.session.players.min - r.players.length}` : (!r.leaderId ? 'Выберите ведущего' : (!allReady ? `Ждём готовности: ${waitingReady}` : 'Начать игру'));

    $('closeRoomBtn').classList.toggle('hidden', isSpectator || !isHost);
    $('leaveRoomBtn').classList.toggle('hidden', isSpectator || isHost || r.started);
  }

  function centerMapOnMe(behavior = 'smooth') {
    const mine = me();
    if (!mine) return;
    const vp = $('mapViewport');
    const board = $('mapBoard');
    const { rows, cols } = mapSize();
    const cellW = board.clientWidth / cols;
    const cellH = board.clientHeight / rows;
    vp.scrollTo({
      left: mine.col * cellW - vp.clientWidth / 2 + cellW / 2,
      top: mine.row * cellH - vp.clientHeight / 2 + cellH / 2,
      behavior,
    });
  }

  function renderMapNavigation() {
    const r = state.room;
    const mine = me();
    const overlay = $('mapNavOverlay');
    const title = $('mapNavTitle');
    const text = $('mapNavText');
    const roll = $('mapNavRollBtn');
    const stay = $('mapNavStayBtn');
    const blocked = isDecisionPending();
    const myTurn = Boolean(r?.started && mine && r.activePlayerId === state.myId);
    const activeNavigation = Boolean(myTurn && mine.phase === 'navigation' && !blocked && !state.spectating);

    overlay.classList.toggle('hidden', !activeNavigation);
    if (!activeNavigation) {
      state.mapMovePending = false;
      return;
    }

    stay.disabled = state.mapMovePending;
    if (mine.roll === null) {
      title.textContent = 'Ваш ход';
      text.textContent = 'Бросьте кубик, затем выберите точку назначения прямо на карте.';
      roll.classList.remove('hidden');
      roll.disabled = false;
      stay.textContent = 'Остаться';
      state.lastAutoCenterSignature = '';
      return;
    }

    const destinations = (r.reachableCells || []).filter(c => c.row !== mine.row || c.col !== mine.col);
    title.textContent = `Дальность: ${mine.movePoints}`;
    text.textContent = destinations.length
      ? `Доступно точек: ${destinations.length}. Нажмите на подсвеченную клетку.`
      : 'Доступных точек нет — останьтесь на месте.';
    roll.classList.add('hidden');
    stay.textContent = 'Остаться здесь';

    const signature = [r.round, r.circle, r.activePlayerId, mine.roll, mine.movePoints, mine.row, mine.col].join(':');
    if (state.lastAutoCenterSignature !== signature) {
      state.lastAutoCenterSignature = signature;
      requestAnimationFrame(() => centerMapOnMe('smooth'));
    }
  }

  function moveToMapCell(cell) {
    if (state.mapMovePending) return;
    state.mapMovePending = true;
    $('mapBoard').classList.add('move-pending');
    document.querySelectorAll('#highlightLayer .navigation-hit').forEach(button => { button.disabled = true; });
    $('mapNavStayBtn').disabled = true;
    socket.emit('moveTo', { row: cell.row, col: cell.col }, res => {
      handleGameAck(res);
      if (res?.ok) playSoundCue('ship');
      if (res?.ok) return;
      state.mapMovePending = false;
      $('mapBoard').classList.remove('move-pending');
      renderMapNavigation();
      renderMap();
    });
  }

  function renderMapContext() {
    const r = state.room;
    const mine = me();
    const overlay = $('mapContextOverlay');
    const title = $('mapContextTitle');
    const text = $('mapContextText');
    const actions = $('mapContextActions');
    actions.innerHTML = '';

    if (!r?.started || !mine || state.spectating) {
      overlay.classList.add('hidden');
      return;
    }

    const myTurn = r.activePlayerId === state.myId;
    const blocked = isDecisionPending();
    if (!myTurn || mine.phase !== 'actions') {
      overlay.classList.add('hidden');
      return;
    }

    const addAction = (label, handler, className = '') => {
      const b = document.createElement('button');
      b.type = 'button';
      if (className) b.className = className;
      b.textContent = label;
      b.addEventListener('click', handler);
      actions.appendChild(b);
    };

    if (blocked) {
      let label = 'Требуется решение';
      if (r.pendingBattle?.viewerInvite) label = 'Решение по совместному бою';
      else if (r.pendingEvent?.viewerCanRespond) label = 'Решение по событию';
      else if (r.pendingFeud?.viewerCanRespond) label = 'Решение по вражде';
      else if (r.pendingAssignmentChoice?.viewerCanRespond) label = 'Решение по поручению';
      else if (r.pendingIslandCorrection?.viewerCanRespond) label = 'Исправление острова';
      else if (r.pendingFleetAdjustment?.viewerCanRespond) label = 'Настройка флотилии';
      else if (r.pendingLegendaryReaction) label = 'Решение по легендарной карте';
      title.textContent = label;
      text.textContent = 'Продолжение хода ждёт вашего выбора.';
      addAction('Открыть решение', renderDecisionLayer, 'primary');
      overlay.classList.remove('hidden');
      return;
    }

    const hereIslands = currentIslands();
    const hereIsland = hereIslands.find(i => i.id === state.selectedIslandId) || hereIslands[0] || null;
    const hereAnchor = currentAnchorCell();
    const hereLegendary = currentLegendaryPlace();
    const seaTargets = r.players.filter(p => p.id !== state.myId && seaAttackPositionClient(mine, p) && !areAlliesClient(state.myId, p.id));
    const islandTargets = hereIslands.filter(i => i.ownerId !== state.myId && !(i.kind === 'free' && !i.ownerId) && (!i.ownerId || !areAlliesClient(state.myId, i.ownerId)));

    if (mine.atCitadel) {
      title.textContent = 'Цитадель';
      text.textContent = `Торговля, улучшения и сопровождение · действий осталось: ${mine.actionsLeft ?? 0}`;
      addAction('Открыть Цитадель', () => renderCitadelObjectSheet(r.map?.citadel || { name: 'Цитадель' }), 'primary');
      overlay.classList.remove('hidden');
      return;
    }

    if (hereIsland) {
      state.selectedIslandId = hereIsland.id;
      title.textContent = hereIsland.name;
      const legendaryIsland = (r.legendaryPlaces || []).find(place => place.kind === 'island' && place.islandId === hereIsland.id);
      const legendarySuffix = legendaryIsland
        ? ` · легендарное место: ${legendaryIsland.exploredBy ? `открыто ${playerName(legendaryIsland.exploredBy)}` : 'ещё не открыто'}`
        : '';
      if (hereIsland.ownerId === state.myId) {
        text.textContent = `Ваш остров · действий осталось: ${mine.actionsLeft ?? 0}${legendarySuffix}`;
        addAction('Управление островом', () => renderOwnIslandObjectSheet(hereIsland), 'primary');
      } else {
        const owner = islandOwnerLabel(hereIsland);
        text.textContent = `${owner} · защита ${hereIsland.defenseArmy ?? hereIsland.army ?? 0} · действий: ${mine.actionsLeft ?? 0}${legendarySuffix}`;
        if (islandTargets.length && !mine.inPeaceZone) addAction('Штурм и действия', () => renderForeignIslandObjectSheet(hereIsland), 'danger-soft');
        else addAction('Информация', () => renderForeignIslandObjectSheet(hereIsland));
      }
      if (seaTargets.length && !mine.inPeaceZone) addAction('Морской бой', () => renderPlayerObjectSheet(seaTargets[0]), 'danger-soft');
      overlay.classList.remove('hidden');
      return;
    }

    if (seaTargets.length && !mine.inPeaceZone) {
      title.textContent = 'Корабль противника рядом';
      text.textContent = `Целей: ${seaTargets.length} · ваша артиллерия: ${mine.fleetArtillery ?? 0}`;
      addAction('Открыть морской бой', () => renderPlayerObjectSheet(seaTargets[0]), 'danger-soft');
      overlay.classList.remove('hidden');
      return;
    }

    if (hereAnchor) {
      const visitKey = `${mine.row},${mine.col}`;
      const visitedHere = (mine.visitedAnchors || []).includes(visitKey);
      const encounter = Number(mine.lastAnchorEncounter?.round) === Number(r.round)
        && Number(mine.lastAnchorEncounter?.row) === Number(mine.row)
        && Number(mine.lastAnchorEncounter?.col) === Number(mine.col)
        ? mine.lastAnchorEncounter
        : null;
      title.textContent = hereAnchor.name;
      if (encounter) {
        const outcome = encounter.outcome === 'win' ? 'Победа' : encounter.outcome === 'loss' ? 'Поражение' : encounter.outcome === 'tie' ? 'Ничья' : 'Тихое море';
        text.textContent = `${outcome} · карта этой клетки уже разыграна в текущем раунде`;
        addAction('Посмотреть результат', () => renderAnchorEncounterSheet(hereAnchor));
      } else if (visitedHere) {
        text.textContent = 'Эта клетка якоря уже дала вам карту в текущем раунде.';
        addAction('Открыть морские якоря', () => renderAnchorEncounterSheet(hereAnchor));
      } else {
        text.textContent = 'Бой на якоре добровольный и объявляется в фазе действий.';
        addAction('Открыть морские якоря', () => renderAnchorEncounterSheet(hereAnchor), 'danger-soft');
      }
      overlay.classList.remove('hidden');
      return;
    }

    if (hereLegendary) {
      title.textContent = hereLegendary.name;
      text.textContent = hereLegendary.exploredBy
        ? `Место уже исследовано: ${playerName(hereLegendary.exploredBy)}`
        : 'Разовая награда разыгрывается автоматически при остановке.';
      overlay.classList.remove('hidden');
      return;
    }

    overlay.classList.add('hidden');
  }

  function actionBarDecisionLabel(room) {
    if (room?.pendingEvent?.viewerCanRespond) return 'Решение по событию';
    if (room?.pendingFeud?.viewerCanRespond) return 'Решение по вражде';
    if (room?.pendingAssignmentChoice?.viewerCanRespond) return 'Выберите поручение';
    if (room?.pendingIslandCorrection?.viewerCanRespond) return 'Исправьте остров';
    if (room?.pendingFleetAdjustment?.viewerCanRespond) return 'Настройте флотилию';
    if (room?.pendingLegendaryReaction) return 'Ответьте на легендарный эффект';
    if (room?.pendingBattle?.viewerInvite) return 'Ответьте на приглашение в бой';
    if (room?.pendingAlliance?.viewerRole === 'recipient') return 'Ответьте на предложение союза';
    return null;
  }

  function eventStageLabel(phase) {
    if (!phase?.active) return 'СОБЫТИЯ';
    if (phase.stage === 'political' || phase.stage === 'feud') return 'ВРАЖДА';
    if (phase.stage === 'assignment') return 'ПОРУЧЕНИЕ';
    return 'СОБЫТИЕ';
  }

  function renderGameActionBar() {
    const r = state.room;
    const bar = $('gameActionBar');
    const buttons = $('gameActionButtons');
    const progress = $('gameActionProgress');
    if (!r || !r.started || r.finished || r.phase === 'finished') {
      bar.classList.add('hidden');
      return;
    }

    bar.classList.remove('hidden');
    buttons.innerHTML = '';
    progress.innerHTML = '';
    progress.classList.add('hidden');

    const mine = me();
    const activePlayer = active();
    const myTurn = Boolean(mine && r.activePlayerId === state.myId && !state.spectating);
    const decisionLabel = actionBarDecisionLabel(r);
    const waitingActor = r.pendingDecision?.waiting ? playerName(r.pendingDecision.actorPlayerId) : null;

    const setCopy = (kicker, title, detail = '') => {
      $('gameActionKicker').textContent = kicker;
      $('gameActionTitle').textContent = title;
      $('gameActionDetail').textContent = detail;
    };
    const addButton = (label, onClick, className = '') => {
      const button = document.createElement('button');
      button.type = 'button';
      if (className) button.className = className;
      button.textContent = label;
      button.addEventListener('click', onClick);
      buttons.appendChild(button);
      return button;
    };

    if (decisionLabel) {
      setCopy('ТРЕБУЕТСЯ РЕШЕНИЕ', decisionLabel, 'Продолжение партии ждёт вашего выбора.');
      addButton('Открыть решение', () => closeMapInfo(), 'primary');
      return;
    }

    if (waitingActor) {
      setCopy('ОЖИДАНИЕ', `Ждём решения: ${waitingActor}`, 'Карта остаётся доступна для просмотра.');
      return;
    }

    if (r.eventPhase?.active || r.phase === 'event') {
      const actor = r.eventPhase?.currentPlayerId ? playerName(r.eventPhase.currentPlayerId) : null;
      setCopy(eventStageLabel(r.eventPhase), actor ? `Сейчас: ${actor}` : 'Фаза событий', 'Событие → Вражда → Поручение');
      return;
    }

    if (!myTurn) {
      const name = activePlayer?.name || 'другого игрока';
      const phase = activePlayer?.phase === 'navigation' ? 'навигация' : activePlayer?.phase === 'actions' ? 'действия' : 'ход';
      setCopy('ОЖИДАНИЕ', `Ход: ${name}`, `Сейчас выполняется: ${phase}.`);
      return;
    }

    if (mine.phase === 'navigation' && mine.roll === null) {
      setCopy('НАВИГАЦИЯ', 'Куда отправится корабль?', 'Бросьте навигацию или останьтесь на месте.');
      addButton('🎲 Бросить', () => socket.emit('rollMove', {}, handleGameAck), 'primary');
      addButton('Остаться', () => socket.emit('skipNavigation', {}, handleGameAck));
      return;
    }

    if (mine.phase === 'navigation') {
      const destinations = (r.reachableCells || []).filter(cell => cell.row !== mine.row || cell.col !== mine.col);
      setCopy('НАВИГАЦИЯ', `Выпало ${mine.roll} · дальность ${mine.movePoints}`,
        destinations.length ? `Выберите подсвеченную клетку · доступно: ${destinations.length}` : 'Доступных клеток нет.');
      addButton('Остаться здесь', () => socket.emit('skipNavigation', {}, handleGameAck));
      return;
    }

    if (mine.phase === 'actions') {
      const left = Math.max(0, Number(mine.actionsLeft) || 0);
      setCopy('ДЕЙСТВИЯ', left > 0 ? `Осталось действий: ${left}` : 'Действия закончились',
        left > 0 ? 'Выберите объект на карте или откройте доступные действия.' : 'Завершите ход.');
      progress.classList.remove('hidden');
      const total = Number(r.balanceCatalog?.session?.actionsPerTurn) || 3;
      for (let i = 0; i < total; i += 1) {
        const dot = document.createElement('span');
        dot.className = i < left ? 'active' : '';
        progress.appendChild(dot);
      }
      if (left > 0) addButton('Действия', () => closeMapInfo(), 'primary');
      addButton('Завершить ход', () => socket.emit('endTurn', {}, handleGameAck), left > 0 ? 'danger-soft' : 'primary');
      return;
    }

    setCopy('ОЖИДАНИЕ', 'Состояние обновляется', 'Ожидаем следующего шага партии.');
  }

  function recordJournal(message, tone = 'neutral', detail = '') {
    if (!message) return;
    const entry = { id: `${Date.now()}:${Math.random()}`, at: Date.now(), message: String(message), detail: detail ? String(detail) : '', tone };
    state.journalEntries.push(entry);
    if (state.journalEntries.length > 120) state.journalEntries.splice(0, state.journalEntries.length - 120);
  }

  function renderJournalOverlay() {
    closeGameMenu();
    closeMapInfo();
    const body = $('journalOverlayBody');
    body.innerHTML = '';
    const entries = state.journalEntries.slice().reverse();
    if (!entries.length) {
      body.innerHTML = '<div class="journal-empty">Пока нет событий, показанных этому игроку в текущей сессии.</div>';
    } else {
      for (const entry of entries) {
        const row = document.createElement('article');
        row.className = `journal-entry journal-${entry.tone}`;
        const time = new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        row.innerHTML = `<span>${escapeHtml(time)}</span><strong>${escapeHtml(entry.message)}</strong>${entry.detail ? `<small>${escapeHtml(entry.detail)}</small>` : ''}`;
        body.appendChild(row);
      }
    }
    $('journalOverlay').classList.remove('hidden');
    document.body.classList.add('journal-overlay-open');
  }

  function closeJournalOverlay() {
    $('journalOverlay')?.classList.add('hidden');
    document.body.classList.remove('journal-overlay-open');
  }

  function processAmbientRoomState(room, { silent = false } = {}) {
    if (!room?.started || room.finished || room.phase === 'finished') {
      state.ambientSnapshot = room ? { round: room.round, circle: room.circle, activePlayerId: room.activePlayerId, eventActive: Boolean(room.eventPhase?.active), eventPlayerId: room.eventPhase?.currentPlayerId || null } : null;
      return;
    }
    const next = { round: room.round, circle: room.circle, activePlayerId: room.activePlayerId, eventActive: Boolean(room.eventPhase?.active), eventPlayerId: room.eventPhase?.currentPlayerId || null };
    const prev = state.ambientSnapshot;
    state.ambientSnapshot = next;
    if (!prev || silent) return;
    if (next.round !== prev.round) {
      const message = `Начался раунд ${next.round}`;
      recordJournal(message);
      enqueueToast(message, 'neutral', false);
      playSoundCue('round');
      return;
    }
    if (next.circle !== prev.circle) {
      const message = `Круг ${next.circle}`;
      recordJournal(message);
      enqueueToast(message, 'neutral', false);
    }
    if (next.eventActive && (!prev.eventActive || next.eventPlayerId !== prev.eventPlayerId)) {
      const player = room.players?.find(item => item.id === next.eventPlayerId);
      const message = player ? `События: ${player.name}` : 'Фаза событий';
      recordJournal(message);
      enqueueToast(message, 'neutral', false);
      playSoundCue('event');
    } else if (!next.eventActive && next.activePlayerId && next.activePlayerId !== prev.activePlayerId) {
      const player = room.players?.find(item => item.id === next.activePlayerId);
      const message = player ? `Ход: ${player.name}` : 'Следующий ход';
      recordJournal(message);
      enqueueToast(message, 'neutral', false);
      if (next.activePlayerId === state.myId) playSoundCue('turn');
    }
  }

  let uiAudioContext = null;
  let lastUiCueKey = '';
  const SOUND_STORAGE_KEY = 'pervo:sound';
  const soundState = (() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SOUND_STORAGE_KEY) || 'null');
      return { muted: Boolean(saved?.muted), volume: Math.max(0, Math.min(1, Number(saved?.volume ?? .72))) };
    } catch {
      return { muted: false, volume: .72 };
    }
  })();
  const soundCooldowns = new Map();

  function playSoundCue(kind = 'confirm') {
    if (soundState.muted || soundState.volume <= 0 || document.visibilityState === 'hidden' || state.spectating) return;
    const now = performance.now();
    const cooldown = kind === 'turn' || kind === 'round' ? 700 : 180;
    if (now - (soundCooldowns.get(kind) || 0) < cooldown) return;
    soundCooldowns.set(kind, now);
    const map = {
      turn: 'turn',
      round: 'turn',
      event: 'event',
      battle: 'battle',
      danger: 'danger',
      reward: 'reward',
      confirm: 'confirm',
      dice: 'dice',
      ship: 'ship',
      coins: 'coins',
      cargo: 'cargo',
      construction: 'construction',
      legendary: 'legendary',
      error: 'error',
    };
    playUiCue(map[kind] || 'confirm');
  }

  function motionReduced() {
    return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  }

  function playUiCue(kind = 'confirm') {
    const masterVolume = soundState.muted ? 0 : soundState.volume;
    if (document.visibilityState === 'hidden' || state.spectating) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    try {
      uiAudioContext ||= new AudioCtx();
      if (uiAudioContext.state === 'suspended') uiAudioContext.resume().catch(() => {});
      const profiles = {
        confirm: [[440, .035, .035]],
        event: [[330, .04, .045], [392, .055, .035]],
        reward: [[523, .04, .045], [659, .055, .035], [784, .075, .03]],
        battle: [[130, .055, .05], [98, .08, .04]],
        danger: [[196, .05, .04], [147, .08, .035]],
        turn: [[392, .07, .04], [523, .11, .035]],
        dice: [[190, .025, .045], [145, .028, .04], [220, .025, .035], [165, .035, .03]],
        ship: [[105, .09, .035], [132, .11, .025]],
        coins: [[880, .025, .035], [1175, .035, .028], [988, .03, .025]],
        cargo: [[150, .045, .045], [110, .055, .03]],
        construction: [[125, .035, .05], [210, .045, .035]],
        legendary: [[98, .09, .045], [392, .1, .028], [659, .13, .025]],
        error: [[120, .06, .045]],
      };
      let offset = 0;
      for (const [frequency, duration, gain] of profiles[kind] || profiles.confirm) {
        const oscillator = uiAudioContext.createOscillator();
        const volume = uiAudioContext.createGain();
        oscillator.type = kind === 'battle' || kind === 'danger' ? 'triangle' : 'sine';
        oscillator.frequency.value = frequency;
        volume.gain.setValueAtTime(0.0001, uiAudioContext.currentTime + offset);
        volume.gain.exponentialRampToValueAtTime(Math.max(.0001, gain * masterVolume), uiAudioContext.currentTime + offset + .008);
        volume.gain.exponentialRampToValueAtTime(0.0001, uiAudioContext.currentTime + offset + duration);
        oscillator.connect(volume).connect(uiAudioContext.destination);
        oscillator.start(uiAudioContext.currentTime + offset);
        oscillator.stop(uiAudioContext.currentTime + offset + duration + .01);
        offset += duration * .72;
      }
    } catch (_) {}
  }

  function cueForResult(result) {
    if (!result) return;
    const text = (result.kicker + ' ' + result.title).toLowerCase();
    if (/бой|сраж|штурм|якор/.test(text)) return result.tone === 'danger' ? 'danger' : 'battle';
    if (/событ|вражд/.test(text)) return 'event';
    if (result.tone === 'success' || /награ|слава|сокров|побед|открыт/.test(text)) return 'reward';
    if (result.tone === 'danger') return 'danger';
    return 'confirm';
  }

  function enqueueResultCard(result) {
    if (!result || !result.title) return;
    const entry = {
      kicker: result.kicker || 'РЕЗУЛЬТАТ',
      title: result.title,
      body: result.body || '',
      details: Array.isArray(result.details) ? result.details.slice(0, 8) : [],
      tone: result.tone || 'neutral',
    };
    state.resultQueue.push(entry);
    recordJournal(entry.title, entry.tone, entry.body);
    if (state.resultQueue.length > 5) state.resultQueue.splice(0, state.resultQueue.length - 5);
    // Do not render immediately from the ack callback. The next authoritative
    // roomState render gets first chance to expose a higher-priority Decision Layer.
  }

  function enqueueToast(message, tone = 'neutral', journal = true) {
    if (!message) return;
    const toast = { id: `${Date.now()}:${Math.random()}`, message: String(message), tone };
    state.toastQueue.push(toast);
    if (journal) recordJournal(toast.message, toast.tone);
    if (state.toastQueue.length > 4) state.toastQueue.splice(0, state.toastQueue.length - 4);
    renderToastStack();
    setTimeout(() => {
      state.toastQueue = state.toastQueue.filter(item => item.id !== toast.id);
      renderToastStack();
    }, 2800);
  }

  function renderToastStack() {
    const stack = $('toastStack');
    if (!stack) return;
    stack.innerHTML = '';
    for (const toast of state.toastQueue.slice(-3)) {
      const item = document.createElement('div');
      item.className = `game-toast toast-${toast.tone}`;
      item.textContent = toast.message;
      stack.appendChild(item);
    }
  }

  function dismissResultCard() {
    state.activeResult = null;
    renderResultLayer();
    if (state.mapSelection?.kind === 'anchor') refreshOpenAnchorSheet();
  }

  function renderResultLayer() {
    const layer = $('resultLayer');
    if (!layer) return;
    const decision = mobileDecisionDescriptor(state.room);
    if (!state.room?.started || state.room.finished || state.room.phase === 'finished' || decision) {
      layer.classList.add('hidden');
      document.body.classList.remove('result-layer-open');
      return;
    }

    if (!state.activeResult && state.resultQueue.length) state.activeResult = state.resultQueue.shift();
    const result = state.activeResult;
    layer.classList.toggle('hidden', !result);
    document.body.classList.toggle('result-layer-open', Boolean(result));
    if (!result) return;

    $('resultKicker').textContent = result.kicker;
    $('resultTitle').textContent = result.title;
    $('resultBody').textContent = result.body || '';
    const details = $('resultDetails');
    details.innerHTML = '';
    for (const detail of result.details || []) {
      const row = document.createElement('div');
      row.className = 'result-detail';
      const label = document.createElement('span');
      label.textContent = detail.label || '';
      const value = document.createElement('strong');
      value.textContent = detail.value == null ? '' : String(detail.value);
      row.append(label, value);
      details.appendChild(row);
    }
    layer.dataset.tone = result.tone || 'neutral';
    const cueKey = [result.kicker, result.title, result.tone].join(':');
    if (lastUiCueKey !== cueKey) {
      lastUiCueKey = cueKey;
      playUiCue(cueForResult(result));
    }
  }

  function anchorResultCard(res) {
    const result = res?.result;
    if (!res?.ok || !result?.triggered) return null;
    const outcome = result.outcome;
    const title = outcome === 'win' ? 'Победа на морском якоре'
      : outcome === 'loss' ? 'Поражение на морском якоре'
      : outcome === 'tie' ? 'Ничья на морском якоре'
      : 'На море тихо';
    const details = [
      { label: 'Встреча', value: result.card?.name || '—' },
      { label: 'Ваша артиллерия', value: result.fleetPower ?? '—' },
      { label: 'Противник', value: result.card?.artillery ?? '—' },
    ];
    let body = result.anchor?.name || 'Морское столкновение';
    if (outcome === 'win') {
      details.push({ label: 'Награда', value: `+${result.reward?.gross ?? result.card?.reward ?? 0} дукатов` });
      if (result.reward?.debtPaid) details.push({ label: 'В погашение долга', value: result.reward.debtPaid });
      if (result.fleetPoints) details.push({ label: 'Очки флота', value: `+${result.fleetPoints}` });
      body = 'Вы выиграли столкновение и получили награду.';
    } else if (outcome === 'loss') {
      details.push({ label: 'Штраф', value: result.penalty?.required ?? 0 });
      if (result.penalty?.addedDebt) details.push({ label: 'Новый долг', value: `+${result.penalty.addedDebt}` });
      body = 'Флотилия уступила противнику. Уровень корабля от этого столкновения не снижается.';
    } else if (outcome === 'tie') {
      body = 'Силы равны. Награды и дополнительных последствий нет.';
    } else {
      body = 'Опасности не встретилось. Действие не расходуется.';
    }
    return { kicker: 'МОРСКОЙ ЯКОРЬ', title, body, details, tone: outcome === 'win' ? 'success' : outcome === 'loss' ? 'danger' : 'neutral' };
  }

  function seaBattleResultCard(res, targetName) {
    const result = res?.result;
    if (!res?.ok || !result || res.pending) return null;
    const outcome = result.outcome;
    const mineWon = outcome === 'attacker';
    const title = outcome === 'tie' ? 'Морской бой завершён вничью' : mineWon ? 'Победа в морском бою' : 'Поражение в морском бою';
    const details = [
      { label: 'Вы', value: result.attackerPower ?? '—' },
      { label: targetName || 'Противник', value: result.defenderPower ?? '—' },
    ];
    if (Number(result.loot) > 0) details.push({ label: 'Добыча', value: `${result.loot} дукатов` });
    const myFleetAward = (result.fleetPointAwards || []).find(item => String(item.playerId) === String(state.myId));
    if (myFleetAward?.points) details.push({ label: 'Ваши очки флота', value: `+${myFleetAward.points}` });
    const myLoot = Number(result.lootShares?.[state.myId]) || 0;
    if (myLoot > 0) details.push({ label: 'Ваша доля добычи', value: `+${myLoot} дукатов` });
    const ownLoss = (result.levelLosses || []).find(item => String(item.playerId) === String(state.myId));
    if (ownLoss) details.push({ label: 'Ваш корабль', value: ownLoss.prevented ? 'Потеря уровня предотвращена' : 'Потерян уровень' });
    return {
      kicker: 'МОРСКОЙ БОЙ',
      title,
      body: outcome === 'tie' ? 'Контроль и уровни не меняются.' : `Бой против ${targetName || 'противника'} разрешён сервером.`,
      details,
      tone: mineWon ? 'success' : outcome === 'tie' ? 'neutral' : 'danger',
    };
  }

  function assaultResultCard(res, islandName) {
    const result = res?.result;
    if (!res?.ok || !result || res.pending) return null;
    const outcome = result.outcome;
    const title = outcome === 'attacker' ? 'Остров захвачен' : outcome === 'defender' ? 'Штурм отражён' : 'Штурм завершён вничью';
    const details = [
      { label: 'Ваше войско', value: result.attackerPower ?? '—' },
      { label: 'Защита острова', value: result.defense?.total ?? '—' },
    ];
    const myAward = (result.armyPointAwards || []).find(item => String(item.playerId) === String(state.myId));
    if (myAward?.points) details.push({ label: 'Ваши очки армии', value: `+${myAward.points}` });
    if (result.captureRetention) details.push({ label: 'Инфраструктура', value: `сохранится ${result.captureRetention.keepCount}/${result.captureRetention.initialCount}` });
    if ((result.rewardNotes || []).length) details.push({ label: 'Награда', value: result.rewardNotes.join(', ') });
    return {
      kicker: 'ШТУРМ',
      title,
      body: outcome === 'attacker' ? `${islandName || 'Остров'} переходит под ваш контроль.`
        : outcome === 'defender' ? `Защита ${islandName || 'острова'} устояла.`
        : 'Контроль над островом не меняется.',
      details,
      tone: outcome === 'attacker' ? 'success' : outcome === 'defender' ? 'danger' : 'neutral',
    };
  }

  function handleAnchorResultAck(res) {
    handleGameAck(res);
    const card = anchorResultCard(res);
    if (card) enqueueResultCard(card);
  }

  function handleSeaBattleResultAck(res, targetName) {
    handleGameAck(res);
    const card = seaBattleResultCard(res, targetName);
    if (card) enqueueResultCard(card);
  }

  function handleAssaultResultAck(res, islandName) {
    handleGameAck(res);
    const card = assaultResultCard(res, islandName);
    if (card) enqueueResultCard(card);
  }

  function eventFlowStageKey(phase) {
    const stage = phase?.stage || 'sailing';
    if (stage === 'political' || stage === 'feud') return 'feud';
    if (stage === 'assignment' || stage === 'assignment-replace') return 'assignment';
    return 'sailing';
  }

  function eventFlowStageIndex(phase) {
    const key = eventFlowStageKey(phase);
    return key === 'feud' ? 1 : key === 'assignment' ? 2 : 0;
  }

  function eventFlowStageStatus(room, phase) {
    const key = eventFlowStageKey(phase);
    if (room.pendingEvent) return room.pendingEvent.viewerCanRespond ? 'Нужно ваше решение по событию.' : `Ждём решения: ${playerName(room.pendingEvent.playerId)}.`;
    if (room.pendingFeud) return room.pendingFeud.viewerCanRespond ? 'Нужно ваше решение по карте вражды.' : `Ждём решения: ${playerName(room.pendingFeud.playerId)}.`;
    if (room.pendingAssignmentChoice) return room.pendingAssignmentChoice.viewerCanRespond ? 'Выберите поручение сюзерена.' : `Ждём выбора поручения: ${playerName(room.pendingAssignmentChoice.playerId)}.`;
    if (room.pendingIslandCorrection?.viewerCanRespond || room.pendingFleetAdjustment?.viewerCanRespond) return 'Сначала завершите обязательное последствие карты.';
    if (key === 'sailing') return 'Разрешается личное событие плавания.';
    if (key === 'feud') return phase?.feudTotal ? `Разрешается вражда · ${Math.min((phase.feudIndex || 0) + 1, phase.feudTotal)}/${phase.feudTotal}.` : 'Проверяется вражда государств.';
    return phase?.assignmentTotal ? `Выдаётся поручение · ${Math.min((phase.assignmentIndex || 0) + 1, phase.assignmentTotal)}/${phase.assignmentTotal}.` : 'Проверяется выдача поручения.';
  }

  function renderEventFlowOverlay() {
    const overlay = $('eventFlowOverlay');
    const room = state.room;
    const phase = room?.eventPhase;
    if (!overlay || !room?.started || room.finished || room.phase !== 'event' || !phase?.active) {
      overlay?.classList.add('hidden');
      document.body.classList.remove('event-flow-open');
      return;
    }

    const currentName = playerName(phase.currentPlayerId);
    const mine = phase.currentPlayerId === state.myId;
    $('eventFlowKicker').textContent = phase.personalTurn ? 'ШЕСТОЙ КРУГ' : 'ФАЗА СОБЫТИЙ';
    $('eventFlowTitle').textContent = mine ? 'Ваши предходовые события' : `Ход: ${currentName}`;
    $('eventFlowStatus').textContent = eventFlowStageStatus(room, phase);

    const currentIndex = eventFlowStageIndex(phase);
    const steps = [
      { key: 'sailing', label: 'Событие', icon: 'Ⅰ' },
      { key: 'feud', label: 'Вражда', icon: 'Ⅱ' },
      { key: 'assignment', label: 'Поручение', icon: 'Ⅲ' },
    ];
    const holder = $('eventFlowSteps');
    holder.innerHTML = '';
    steps.forEach((step, index) => {
      const item = document.createElement('div');
      item.className = 'event-flow-step';
      if (index < currentIndex) item.classList.add('done');
      if (index === currentIndex) item.classList.add('current');
      item.innerHTML = `<span>${step.icon}</span><strong>${step.label}</strong>`;
      holder.appendChild(item);
    });

    const last = $('eventFlowLastCard');
    if (phase.lastCard?.cardName) {
      const faction = phase.lastCard.factionName ? ` · ${phase.lastCard.factionName}` : '';
      last.textContent = `Последнее: «${phase.lastCard.cardName}»${faction}${phase.lastCard.pending ? ' · ожидает решения' : ''}`;
      last.classList.remove('hidden');
    } else {
      last.classList.add('hidden');
      last.textContent = '';
    }

    overlay.classList.remove('hidden');
    document.body.classList.add('event-flow-open');
  }

  function feudDecisionSceneHtml(pending) {
    if (!pending) return '';
    const descriptions = {
      'downgrade-building': 'Выберите свою постройку для обязательного понижения.',
      'remove-building': 'Выберите свою постройку, которую государство удалит.',
      'reclaim-island': 'Выберите остров, который возвращается государству.',
      'building-downgrade': 'Выберите постройку для понижения.',
      'building-choice': 'Для выбранной постройки решите: удалить её или понизить.',
      'remove-forts': 'Удалите требуемое число оборонительных построек.',
      'remove-upgrade': 'Снимите одно установленное улучшение корабля.',
      'remove-cargo': 'Выберите трюм, груз которого будет потерян.',
    };
    const remaining = Number(pending.remaining) > 1 ? ` Осталось решений: ${pending.remaining}.` : '';
    return `
      <section class="event-scene-card feud-scene-card">
        <span>ВРАЖДА · ${escapeHtml(pending.factionName || 'ГОСУДАРСТВО')}</span>
        <strong>«${escapeHtml(pending.cardName || 'Карта вражды')}»</strong>
        <small>${escapeHtml(descriptions[pending.kind] || 'Карта вражды требует обязательного решения.')}${escapeHtml(remaining)}</small>
      </section>
    `;
  }

  function assignmentDecisionSceneHtml(pending) {
    if (!pending) return '';
    const options = pending.options || [];
    const rewardText = options.length
      ? `Предложено вариантов: ${options.length}. Награды указаны на кнопках выбора.`
      : 'Выберите одно допустимое поручение.';
    return `
      <section class="event-scene-card assignment-scene-card">
        <span>ПОРУЧЕНИЕ · ${escapeHtml(pending.factionName || 'СЮЗЕРЕН')}</span>
        <strong>Посольство предлагает выбор</strong>
        <small>${escapeHtml(rewardText)}</small>
      </section>
    `;
  }

  function eventDecisionSceneHtml(pending) {
    if (!pending) return '';
    const scene = {
      observatory: ['ОБСЕРВАТОРИЯ', 'Оставить первую карту или заменить её обязательной второй.'],
      cargo: ['РАЗМЕЩЕНИЕ ГРУЗА', 'Выберите один свободный трюм для результата события.'],
      raid: ['НАБЕГ', 'Событие требует выбрать одну вашу постройку для понижения.'],
      boarding: ['АБОРДАЖ', 'Событие требует снять одно установленное улучшение корабля.'],
      storm: ['ШТОРМ', 'Выберите допустимую клетку берега. После выбора флотилия будет перенесена немедленно.'],
      'treasure-choice': ['ИСКАТЕЛЬ СОКРОВИЩ', 'Выберите один из двух независимых результатов сокровища.'],
    }[pending.kind] || ['СОБЫТИЕ', 'Требуется ваш выбор для продолжения партии.'];
    return `
      <section class="event-scene-card">
        <span>${escapeHtml(scene[0])}</span>
        <strong>«${escapeHtml(pending.cardName || 'Событие')}»</strong>
        <small>${escapeHtml(scene[1])}</small>
      </section>
    `;
  }

  function eventResolvedResultCard(data) {
    if (!data || data.source !== 'sailing' || !data.title) return null;
    return {
      kicker: 'СОБЫТИЕ',
      title: data.title,
      body: data.body || 'Событие разрешено.',
      details: Array.isArray(data.details) ? data.details : [],
      tone: data.tone || 'neutral',
    };
  }

  function mobileDecisionDescriptor(room) {
    if (!room) return null;
    if (room.pendingLegendaryReaction?.viewerCanRespond) return {
      kind: 'decision', kicker: 'ТРЕБУЕТСЯ ВАШЕ РЕШЕНИЕ', title: 'Легендарная реакция',
      contentId: 'legendaryContent', actionsId: 'legendaryActions',
    };
    if (room.pendingEvent?.viewerCanRespond) return {
      kind: 'decision', kicker: 'СОБЫТИЕ', title: room.pendingEvent.cardName || 'Решение по событию',
      bodyHtml: eventDecisionSceneHtml(room.pendingEvent),
      actionsId: 'eventActions',
    };
    if (room.pendingFeud?.viewerCanRespond) return {
      kind: 'decision', kicker: 'ВРАЖДА', title: room.pendingFeud.cardName || 'Решение по вражде',
      bodyHtml: feudDecisionSceneHtml(room.pendingFeud),
      actionsId: 'eventActions',
    };
    if (room.pendingAssignmentChoice?.viewerCanRespond) return {
      kind: 'decision', kicker: 'ПОРУЧЕНИЕ', title: 'Выберите поручение сюзерена',
      bodyHtml: assignmentDecisionSceneHtml(room.pendingAssignmentChoice),
      actionsId: 'assignmentActions',
    };
    if (room.pendingIslandCorrection?.viewerCanRespond) return {
      kind: 'decision', kicker: 'ОБЯЗАТЕЛЬНОЕ РЕШЕНИЕ', title: room.pendingIslandCorrection.islandName || 'Исправление острова',
      contentId: 'islandCorrectionContent', actionsId: 'islandCorrectionActions',
    };
    if (room.pendingFleetAdjustment?.viewerCanRespond) return {
      kind: 'decision', kicker: 'ОБЯЗАТЕЛЬНОЕ РЕШЕНИЕ', title: 'Настройка флотилии',
      contentId: 'fleetAdjustmentContent', actionsId: 'fleetAdjustmentActions',
    };
    if (room.pendingBattle?.viewerInvite) return {
      kind: 'decision', kicker: 'СОВМЕСТНЫЙ БОЙ', title: 'Присоединиться к бою?',
      bodyHtml: battleFlowStatusHtml(room.pendingBattle),
      actionsId: 'combatActions',
    };
    if (room.pendingAlliance?.viewerRole === 'recipient') return {
      kind: 'decision', kicker: 'ПРЕДЛОЖЕНИЕ СОЮЗА', title: `${playerName(room.pendingAlliance.fromId)} предлагает союз`,
      contentId: 'allianceContent', actionsId: 'allianceActions',
    };
    if (room.pendingAlliance?.viewerRole === 'sender') return {
      kind: 'waiting', kicker: 'ОЖИДАНИЕ', title: `Ждём ответа: ${playerName(room.pendingAlliance.toId)}`,
      contentId: 'allianceContent', actionsId: 'allianceActions',
    };
    if (room.pendingBattle) return {
      kind: 'waiting', kicker: 'БОЙ', title: 'Ожидаются ответы участников',
      bodyHtml: battleFlowStatusHtml(room.pendingBattle),
      actionsId: 'combatActions',
    };
    if (room.phase === 'event' && room.eventPhase?.active && room.pendingDecision?.waiting) return {
      kind: 'waiting', kicker: 'ШЕСТОЙ КРУГ', title: `Ждём: ${playerName(room.pendingDecision.actorPlayerId)}`,
      body: eventFlowStageStatus(room, room.eventPhase),
    };
    if (room.pendingDecision?.waiting) return {
      kind: 'waiting', kicker: 'ОЖИДАНИЕ', title: `Ждём решения: ${playerName(room.pendingDecision.actorPlayerId)}`,
      body: 'Продолжение партии заблокировано до обязательного решения этого игрока.',
    };
    return null;
  }

  function renderDecisionLayer() {
    const layer = $('decisionLayer');
    const actions = $('decisionActions');
    const body = $('decisionBody');
    if (!state.room?.started || state.room.finished || state.room.phase === 'finished') {
      layer.classList.add('hidden');
      document.body.classList.remove('decision-layer-open');
      actions.innerHTML = '';
      body.innerHTML = '';
      return;
    }

    const descriptor = mobileDecisionDescriptor(state.room);
    if (descriptor && state.targeting) state.targeting = null;
    if (descriptor && state.mapSelection) closeMapInfo();
    layer.classList.toggle('hidden', !descriptor);
    document.body.classList.toggle('decision-layer-open', Boolean(descriptor));
    if (!descriptor) {
      actions.innerHTML = '';
      body.innerHTML = '';
      return;
    }


    $('decisionKicker').textContent = descriptor.kicker;
    $('decisionTitle').textContent = descriptor.title;
    const sourceContent = descriptor.contentId ? $(descriptor.contentId) : null;
    if (descriptor.bodyHtml) body.innerHTML = descriptor.bodyHtml;
    else body.textContent = descriptor.body || sourceContent?.textContent?.trim() || (descriptor.kind === 'waiting' ? 'Ожидается решение другого игрока.' : 'Выберите один из доступных вариантов.');

    actions.innerHTML = '';
    const sourceActions = descriptor.actionsId ? $(descriptor.actionsId) : null;
    if (sourceActions) {
      while (sourceActions.firstChild) actions.appendChild(sourceActions.firstChild);
    }

    if (descriptor.kind === 'decision' && !actions.children.length) {
      const fallback = document.createElement('div');
      fallback.className = 'decision-empty';
      fallback.textContent = 'Варианты решения обновляются. Если они не появились, дождитесь следующего обновления состояния.';
      actions.appendChild(fallback);
    }
  }

  function renderControls() {
    const r = state.room;
    const mine = me();

    const myTurn = r.started && r.activePlayerId === state.myId;
    const phase = myTurn ? mine?.phase : 'waiting';
    const rolled = myTurn && mine?.roll !== null;
    const blocked = isDecisionPending();

    $('rollBtn').disabled = !myTurn || phase !== 'navigation' || rolled || blocked;
    $('skipBtn').disabled = !myTurn || phase !== 'navigation' || blocked;
    $('endTurnBtn').disabled = !myTurn || blocked;


    if (!r.started) $('moveResult').textContent = 'Выберите корабль. Организатор назначает ведущего и порядок мест; затем все нажимают «Готов».';
    else if (r.pendingDecision?.waiting) $('moveResult').textContent = `Ожидается обязательное решение игрока ${playerName(r.pendingDecision.actorPlayerId)}.`;
    else if (r.eventPhase?.active) $('moveResult').textContent = r.pendingIslandCorrection?.viewerCanRespond ? `Остров ${r.pendingIslandCorrection.islandName} нужно исправить перед продолжением.` : r.pendingAssignmentChoice?.viewerCanRespond ? 'Нужно решить, оставить или заменить поручение сюзерена.' : r.pendingFeud?.viewerCanRespond ? 'Нужно разрешить вашу карту вражды.' : r.pendingEvent?.viewerCanRespond ? 'Нужно принять решение по вашей карте события.' : `Карты получает ${playerName(r.eventPhase.currentPlayerId)}.`;
    else if (r.pendingIslandCorrection?.viewerCanRespond) $('moveResult').textContent = `Остров ${r.pendingIslandCorrection.islandName} нужно немедленно привести к допустимым ограничениям.`;
    else if (r.pendingIslandCorrection) $('moveResult').textContent = `Ожидается исправление острова игроком ${playerName(r.pendingIslandCorrection.playerId)}.`;
    else if (!myTurn) $('moveResult').textContent = aText();
    else if (phase === 'navigation' && mine.roll === null) $('moveResult').textContent = 'Можно бросить d6 или остаться на месте.';
    else if (phase === 'navigation') $('moveResult').textContent = `d6 = ${mine.roll}. Дальность ${mine.movePoints}; подсвечены только клетки, куда реально можно доплыть.`;
    else if (r.pendingAlliance) $('moveResult').textContent = 'Ожидается решение по предложению союза.';
    else if (r.pendingBattle) $('moveResult').textContent = 'Совместный бой ожидает ответов приглашённых союзников.';
    else $('moveResult').textContent = `Навигация завершена. Действий осталось: ${mine.actionsLeft}.`;
  }

  function aText() {
    if (state.room?.eventPhase?.active) return `Карты получает ${playerName(state.room.eventPhase.currentPlayerId)}.`;
    const a = active();
    return a ? `Сейчас ходит ${a.name}.` : 'Ожидание.';
  }

  function renderEvents() {
    const r = state.room;
    const mine = me();
    const content = $('eventContent');
    const actions = $('eventActions');
    const badge = $('eventBadge');
    actions.innerHTML = '';
    if (!mine) {
      badge.textContent = '—';
      content.textContent = 'Данные событий недоступны.';
      return;
    }

    const phase = r.eventPhase;
    const pending = r.pendingEvent;
    const nextEffects = mine.nextTurnEffects || {};
    const activeEffects = mine.activeTurnEffects || {};
    const effectLabels = effects => {
      const out = [];
      if (effects.moveBonus) out.push(`ход +${effects.moveBonus}`);
      if (effects.movePenalty) out.push(`ход −${effects.movePenalty}`);
      if (effects.bestOfTwo) out.push('2d6, лучший');
      if (effects.noNavigation) out.push('без навигации');
      if (effects.noIncome) out.push('без дохода');
      return out;
    };

    const stageLabel = phase?.stage === 'feud' ? 'вражда' : phase?.stage === 'assignment' ? 'поручения' : phase?.stage === 'assignment-replace' ? 'замена поручений' : phase?.stage ? 'плавание' : 'личное событие';
    badge.textContent = phase?.active
      ? (phase.stage === 'feud' ? `вражда ${(phase.feudIndex || 0) + 1}/${phase.feudTotal || 0}`
        : phase.stage === 'assignment' ? `поручения ${(phase.assignmentIndex || 0) + 1}/${phase.assignmentTotal || 0}`
        : phase.stage === 'assignment-replace' ? `замена ${(phase.replacementIndex || 0) + 1}/${phase.replacementTotal || 0}`
        : Number.isInteger(phase.playerIndex) ? `${phase.playerIndex + 1}/${phase.totalPlayers || r.players.length}`
        : 'ожидание')
      : 'события';
    let html = `<div class="event-decks">Колоды событий, экспедиций, вражды и поручений скрыты.</div><div class="event-decks">Сокровища: цифровой случайный пул из ${r.treasurePool?.typeIds?.length || 4} равновероятных результатов, независимый выбор.</div><div class="event-decks">Легендарные карты: цифровой случайный пул из ${r.legendaryPool?.typeIds?.length || 4} видов, без отдельной колоды и сброса.</div>`;
    if (phase?.active) {
      const currentName = playerName(phase.currentPlayerId);
      html += `<div class="event-current"><strong>${phase.personalTurn ? 'Шестой круг' : 'Фаза событий'} · ${escapeHtml(stageLabel)}</strong><br>Текущий игрок: ${escapeHtml(currentName)}.</div>`;
      if (phase.lastCard) html += `<div class="event-card-line">Последняя карта: <strong>«${escapeHtml(phase.lastCard.cardName)}»</strong>${phase.lastCard.factionName ? ` · ${escapeHtml(phase.lastCard.factionName)}` : ''}${phase.lastCard.pending ? ' · ожидает выбора' : ''}.</div>`;
    } else {
      html += '<div class="event-current">В шестом круге каждый игрок получает карты в начале своего хода, затем выполняет обычный ход.</div>';
    }

    const queued = effectLabels(nextEffects);
    const activeNow = effectLabels(activeEffects);
    if (queued.length) html += `<div class="event-effect">На ближайший личный ход: ${escapeHtml(queued.join(', '))}.</div>`;
    if (activeNow.length) html += `<div class="event-effect">Действует сейчас: ${escapeHtml(activeNow.join(', '))}.</div>`;

    if (mine.legendaryCards?.length) html += `<div class="event-hand"><strong>Легендарные карты:</strong> ${mine.legendaryCards.map(c => escapeHtml(c.name)).join(', ')}.</div>`;
    if (mine.specialCards?.length) html += `<div class="event-hand"><strong>Одноразовые карты:</strong> ${mine.specialCards.map(escapeHtml).join(', ')}.</div>`;
    if (mine.savedEventCards?.length) html += `<div class="event-hand"><strong>Сохранённые события:</strong> ${mine.savedEventCards.map(c => escapeHtml(c.name)).join(', ')}.</div>`;
    content.innerHTML = html;

    if (pending?.viewerCanRespond) {
      const label = document.createElement('div');
      label.className = 'action-group-label';
      label.textContent = `Решение: «${pending.cardName}»`;
      actions.appendChild(label);
      if (pending.kind === 'treasure-choice') {
        for (const option of pending.options || []) {
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'build-btn primary';
          b.textContent = `Вариант ${Number(option.id) + 1}: ${option.name}`;
          b.addEventListener('click', () => socket.emit('respondEvent', { eventId: pending.id, choice: option.id }, handleGameAck));
          actions.appendChild(b);
        }
      } else if (pending.kind === 'observatory') {
        for (const option of pending.options || []) {
          const b = document.createElement('button');
          b.type = 'button'; b.className = option.id === 'replace' ? 'build-btn primary' : 'build-btn';
          b.textContent = option.name;
          b.addEventListener('click', () => socket.emit('respondEvent', { eventId: pending.id, choice: option.id }, handleGameAck));
          actions.appendChild(b);
        }
      } else if (pending.kind === 'cargo') {
        for (const option of pending.options || []) {
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'build-btn primary';
          b.textContent = `${option.name} · вместимость ${option.capacity}`;
          b.addEventListener('click', () => socket.emit('respondEvent', { eventId: pending.id, holdId: option.id }, handleGameAck));
          actions.appendChild(b);
        }
      } else if (pending.kind === 'raid') {
        for (const option of pending.options || []) {
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'build-btn danger-soft';
          b.textContent = `${option.islandName}: ${option.name}`;
          b.addEventListener('click', () => socket.emit('respondEvent', { eventId: pending.id, islandId: option.islandId, buildingIndex: option.buildingIndex }, handleGameAck));
          actions.appendChild(b);
        }
      } else if (pending.kind === 'boarding') {
        for (const option of pending.options || []) {
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'build-btn danger-soft';
          b.textContent = `Снять «${option.name}»`;
          b.addEventListener('click', () => socket.emit('respondEvent', { eventId: pending.id, upgradeId: option.id }, handleGameAck));
          actions.appendChild(b);
        }
      } else if (pending.kind === 'storm') {
        for (const option of pending.options || []) {
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'build-btn';
          b.textContent = `Клетка ${option.col + 1}:${option.row + 1}`;
          b.addEventListener('click', () => socket.emit('respondEvent', { eventId: pending.id, row: option.row, col: option.col }, handleGameAck));
          actions.appendChild(b);
        }
      }
      return;
    }

    const pendingFeud = r.pendingFeud;
    if (pendingFeud?.viewerCanRespond) {
      const label = document.createElement('div');
      label.className = 'action-group-label';
      label.textContent = `Вражда: ${pendingFeud.factionName} — «${pendingFeud.cardName}»`;
      actions.appendChild(label);
      const emitChoice = payload => socket.emit('respondFeud', { feudId: pendingFeud.id, ...payload }, handleGameAck);
      if (pendingFeud.kind === 'downgrade-building') {
        if ((pendingFeud.remaining || 1) > 1) {
          const note = document.createElement('div'); note.className = 'cargo-meta'; note.textContent = `Осталось понизить: ${pendingFeud.remaining}`; actions.appendChild(note);
        }
        for (const option of pendingFeud.options || []) {
          const b = document.createElement('button'); b.type = 'button'; b.className = 'build-btn danger-soft';
          b.textContent = `Понизить (I удаляется): ${option.islandName} · ${option.name}`;
          b.addEventListener('click', () => emitChoice({ islandId: option.islandId, buildingIndex: option.buildingIndex })); actions.appendChild(b);
        }
      } else if (pendingFeud.kind === 'remove-building') {
        for (const option of pendingFeud.options || []) {
          const b = document.createElement('button'); b.type = 'button'; b.className = 'build-btn danger-soft';
          b.textContent = `Удалить: ${option.islandName} · ${option.name}`;
          b.addEventListener('click', () => emitChoice({ islandId: option.islandId, buildingIndex: option.buildingIndex })); actions.appendChild(b);
        }
      } else if (pendingFeud.kind === 'reclaim-island') {
        for (const option of pendingFeud.options || []) {
          const b = document.createElement('button'); b.type = 'button'; b.className = 'build-btn danger-soft';
          b.textContent = `Вернуть государству: ${option.name}`;
          b.addEventListener('click', () => emitChoice({ islandId: option.islandId })); actions.appendChild(b);
        }
      } else if (pendingFeud.kind === 'building-downgrade') {
        for (const option of pendingFeud.options || []) {
          const b = document.createElement('button'); b.type = 'button'; b.className = 'build-btn danger-soft';
          b.textContent = `Понизить: ${option.islandName} · ${option.name}`;
          b.addEventListener('click', () => emitChoice({ islandId: option.islandId, buildingIndex: option.buildingIndex })); actions.appendChild(b);
        }
      } else if (pendingFeud.kind === 'building-choice') {
        for (const option of pendingFeud.options || []) {
          const card = document.createElement('div'); card.className = 'saved-event-card';
          card.innerHTML = `<strong>${escapeHtml(option.islandName)} · ${escapeHtml(option.name)}</strong>`;
          const del = document.createElement('button'); del.type = 'button'; del.className = 'build-btn danger-soft'; del.textContent = 'Удалить';
          del.addEventListener('click', () => emitChoice({ islandId: option.islandId, buildingIndex: option.buildingIndex, mode: 'delete' }));
          card.appendChild(del);
          const down = document.createElement('button'); down.type = 'button'; down.className = 'build-btn'; down.textContent = 'Понизить на уровень'; down.disabled = !option.canDowngrade;
          down.addEventListener('click', () => emitChoice({ islandId: option.islandId, buildingIndex: option.buildingIndex, mode: 'downgrade' }));
          card.appendChild(down); actions.appendChild(card);
        }
      } else if (pendingFeud.kind === 'remove-forts') {
        const note = document.createElement('div'); note.className = 'cargo-meta'; note.textContent = `Осталось удалить: ${pendingFeud.remaining || 1}`; actions.appendChild(note);
        for (const option of pendingFeud.options || []) {
          const b = document.createElement('button'); b.type = 'button'; b.className = 'build-btn danger-soft';
          b.textContent = `Удалить: ${option.islandName} · ${option.name}`;
          b.addEventListener('click', () => emitChoice({ islandId: option.islandId, buildingIndex: option.buildingIndex })); actions.appendChild(b);
        }
      } else if (pendingFeud.kind === 'remove-upgrade') {
        for (const option of pendingFeud.options || []) {
          const b = document.createElement('button'); b.type = 'button'; b.className = 'build-btn danger-soft'; b.textContent = `Снять «${option.name}»`;
          b.addEventListener('click', () => emitChoice({ upgradeId: option.id })); actions.appendChild(b);
        }
      } else if (pendingFeud.kind === 'remove-cargo') {
        for (const option of pendingFeud.options || []) {
          const good = r.goodsCatalog?.[option.goodId]?.name || option.goodId;
          const b = document.createElement('button'); b.type = 'button'; b.className = 'build-btn danger-soft'; b.textContent = `${option.name}: сбросить ${good} ×${option.quantity}`;
          b.addEventListener('click', () => emitChoice({ holdId: option.id })); actions.appendChild(b);
        }
      }
      return;
    }

    const myTurn = r.started && r.activePlayerId === state.myId;
    const canUse = myTurn && mine.phase === 'actions' && (mine.actionsLeft ?? 0) > 0 && !isDecisionPending();
    const emptyHolds = [];
    if (!mine.cargo && !mine.landCompany) emptyHolds.push({ id: 'main', name: `Основной трюм (${mine.cargoCapacity})` });
    for (const e of mine.escorts || []) {
      const def = r.escortCatalog?.[e.type];
      if (e.active && (def?.cargo || 0) > 0 && !e.cargo) emptyHolds.push({ id: e.id, name: `${def.name || 'Сопровождение'} (${def.cargo})` });
    }

    for (const saved of mine.savedEventCards || []) {
      const label = document.createElement('div');
      label.className = 'saved-event-card';
      label.innerHTML = `<strong>${escapeHtml(saved.name)}</strong>`;
      actions.appendChild(label);

      if (['found-cargo', 'treasure-cargo'].includes(saved.kind)) {
        if (!emptyHolds.length) {
          const note = document.createElement('div'); note.className = 'cargo-meta'; note.textContent = 'Нет пустого активного трюма.'; actions.appendChild(note);
        }
        for (const hold of emptyHolds) {
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'build-btn';
          b.textContent = `Загрузить → ${hold.name} · 1 действие`;
          b.disabled = !canUse;
          b.addEventListener('click', () => socket.emit('useSavedCargo', { savedCardId: saved.id, holdId: hold.id }, handleGameAck));
          actions.appendChild(b);
        }
      } else if (saved.kind === 'ship-master') {
        const installed = new Set((mine.upgrades || []).map(u => u.id));
        for (const [id, u] of Object.entries(r.shipUpgradeCatalog || {})) {
          if (installed.has(id)) continue;
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'build-btn';
          b.textContent = `Бесплатно: ${u.name} · 1 действие`;
          b.disabled = !canUse || !mine.atCitadel;
          b.addEventListener('click', () => socket.emit('useShipMaster', { savedCardId: saved.id, upgradeId: id }, handleGameAck));
          actions.appendChild(b);
        }
      } else if (['market-blueprint', 'farm-blueprint'].includes(saved.kind)) {
        const myHere = currentIslands().filter(i => i.ownerId === state.myId);
        if (!myHere.length) {
          const note = document.createElement('div'); note.className = 'cargo-meta'; note.textContent = 'Чтобы применить чертёж, остановитесь на клетке своего острова.'; actions.appendChild(note);
        }
        for (const island of myHere) {
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'build-btn';
          b.textContent = `Построить бесплатно на ${island.name} · 1 действие`;
          b.disabled = !canUse;
          b.addEventListener('click', () => socket.emit('useBlueprint', { savedCardId: saved.id, islandId: island.id }, handleGameAck));
          actions.appendChild(b);
        }
      }
    }
  }


  function factionById(factionId) {
    return state.room?.factions?.find(faction => faction.id === factionId) || null;
  }

  function factionForIsland(island) {
    if (!island || island.kind !== 'state') return null;
    const raw = String(island.faction || '').trim().toLowerCase();
    return (state.room?.factions || []).find(faction =>
      faction.id === island.faction
      || String(faction.name || '').trim().toLowerCase() === raw
    ) || null;
  }

  function factionRelationLabel(faction, mine = me()) {
    if (!faction || !mine) return 'Нейтральные отношения';
    if (mine.suzerainId === faction.id) return 'Ваш сюзерен';
    if ((mine.enemyFactionIds || []).includes(faction.id)) return 'Вражда';
    return 'Нейтральные отношения';
  }

  function factionDiplomacyHtml(faction) {
    const mine = me();
    if (!faction) return '<div class="diplomacy-note">Политические данные государства недоступны.</div>';
    const relation = factionRelationLabel(faction, mine);
    const existence = faction.exists ? 'Государство существует.' : `Государство прекратило существование${faction.ceasedRound ? ` в раунде ${faction.ceasedRound}` : ''}.`;
    const vassal = faction.vassalPlayerId ? `Вассал: ${playerName(faction.vassalPlayerId)}.` : 'Сейчас у государства нет вассала.';
    const tax = faction.tax ? `Налог вассала: ${faction.tax} дуката в начале личного хода шестого круга.` : 'Денежного налога за раунд нет.';
    const gift = faction.giftIslandName ? `При вступлении государство может передать остров «${faction.giftIslandName}» по действующим правилам.` : 'Передаваемого острова нет.';
    const prize = faction.fullConquestPrize
      ? (faction.fullConquestPrize.amountUnresolved
        ? 'Итоговая награда за полное завоевание пока не определена правилами.'
        : `Итоговая награда за полное завоевание: ${faction.fullConquestPrize.ducats} дукатов.`)
      : 'Отдельной итоговой награды за полное завоевание нет.';
    const claimed = faction.fullConquestClaimed
      ? `Награда уже получена: ${playerName(faction.fullConquestPlayerId)}.`
      : '';
    return `
      <section class="diplomacy-state-card">
        <span>ОТНОШЕНИЯ</span>
        <strong>${escapeHtml(relation)}</strong>
        <small>${escapeHtml(existence)}</small>
      </section>
      <div class="diplomacy-lines">
        <div><span>Вассалитет</span><strong>${escapeHtml(vassal)}</strong></div>
        <div><span>Налог</span><strong>${escapeHtml(tax)}</strong></div>
        <div><span>Остров</span><strong>${escapeHtml(gift)}</strong></div>
        <div><span>Завоевание</span><strong>${escapeHtml(prize)}${claimed ? ` ${escapeHtml(claimed)}` : ''}</strong></div>
      </div>
    `;
  }

  function appendCanonicalPoliticsActions(target, factionId = null) {
    if (!target) return;
    renderPolitics();
    const source = $('politicsActions');
    const faction = factionId ? factionById(factionId) : null;
    for (const button of Array.from(source?.children || [])) {
      if (faction && !button.textContent.includes(faction.name)) continue;
      target.appendChild(button);
    }
  }

  function renderDiplomacyObjectSheet(factionId = null) {
    const sheet = $('objectSheet');
    const room = state.room;
    const mine = me();
    if (!sheet || !room?.started || !mine) return;
    const selectedFaction = factionId ? factionById(factionId) : null;
    state.mapSelection = { kind: 'diplomacy', id: selectedFaction?.id || 'overview' };
    $('objectSheetKind').textContent = selectedFaction ? 'ГОСУДАРСТВО' : 'ДИПЛОМАТИЯ';
    $('objectSheetTitle').textContent = selectedFaction?.name || 'Дипломатия';
    const factions = selectedFaction ? [selectedFaction] : (room.factions || []);
    $('objectSheetBody').innerHTML = factions.map(faction => `
      <section class="diplomacy-faction-block">
        ${selectedFaction ? '' : `<h3>${escapeHtml(faction.name)}</h3>`}
        ${factionDiplomacyHtml(faction)}
      </section>
    `).join('');
    const actions = $('objectSheetActions');
    actions.innerHTML = '';
    appendCanonicalPoliticsActions(actions, selectedFaction?.id || null);
    if (!actions.children.length) {
      const note = document.createElement('div');
      note.className = 'diplomacy-note';
      note.textContent = selectedFaction
        ? 'Сейчас для этого государства нет доступного политического действия.'
        : 'Сейчас политические действия недоступны.';
      actions.appendChild(note);
    }
    sheet.classList.remove('hidden');
    sheet.classList.add('expanded');
    $('objectSheetExpand').textContent = '⌄';
    $('objectSheetExpand').setAttribute('aria-label', 'Свернуть карточку');
    document.body.classList.add('object-sheet-open');
  }

  function renderPolitics() {
    const r = state.room;
    const mine = me();
    const content = $('politicsContent');
    const actions = $('politicsActions');
    const badge = $('politicsBadge');
    actions.innerHTML = '';
    if (!mine || !r.started) {
      badge.textContent = '—';
      content.textContent = 'Политические отношения появятся после начала партии.';
      return;
    }
    const suzerain = mine.suzerainId ? r.factions?.find(f => f.id === mine.suzerainId) : null;
    const enemies = new Set(mine.enemyFactionIds || []);
    badge.textContent = suzerain ? 'вассал' : (enemies.size ? `вражда ${enemies.size}` : 'нейтрален');
    let html = '';
    if (suzerain) html += `<div class="event-current"><strong>Сюзерен: ${escapeHtml(suzerain.name)}</strong>${suzerain.tax ? `<br>Налог: ${suzerain.tax} дуката в начале вашего хода шестого круга.` : '<br>Денежного налога за раунд нет.'}</div>`;
    if (enemies.size) html += `<div class="event-effect"><strong>Вражда:</strong> ${[...enemies].map(id => escapeHtml(r.factions?.find(f => f.id === id)?.name || id)).join(', ')}.</div>`;
    html += (r.factions || []).map(f => {
      const vassal = f.vassalPlayerId ? playerName(f.vassalPlayerId) : 'нет';
      const state = f.exists ? 'существует' : 'прекратило существование';
      const relation = mine.suzerainId === f.id ? ' · ваш сюзерен' : enemies.has(f.id) ? ' · ВРАЖДА' : '';
      const gift = f.giftIslandName ? ` · передаваемый остров: ${escapeHtml(f.giftIslandName)}` : '';
      const prize = f.fullConquestPrize;
      const prizeText = prize
        ? ` · итоговый приз: ${prize.amountUnresolved ? 'сумма требует решения автора' : `${prize.ducats} дукатов`}`
        : '';
      const claimed = f.fullConquestClaimed ? ` · получатель приза: ${escapeHtml(playerName(f.fullConquestPlayerId))}` : '';
      return `<div class="politics-row"><strong>${escapeHtml(f.name)}</strong><br><span class="cargo-meta">${state} · вассал: ${escapeHtml(vassal)}${gift}${escapeHtml(relation)}${prizeText}${claimed}</span></div>`;
    }).join('');
    content.innerHTML = html;

    const blocked = isDecisionPending();
    for (const f of r.factions || []) {
      if (!f.canJoin) continue;
      const b = document.createElement('button'); b.type = 'button'; b.className = 'build-btn primary';
      b.textContent = `Вступить: ${f.name} · 1 действие`;
      b.disabled = blocked;
      b.addEventListener('click', () => socket.emit('enterVassalage', { factionId: f.id }, handleGameAck));
      actions.appendChild(b);
    }
    if (suzerain && r.activePlayerId === state.myId && mine.phase === 'actions' && (mine.actionsLeft ?? 0) > 0) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'build-btn danger-soft'; b.textContent = `Объявить мятеж против ${suzerain.name} · 1 действие`;
      b.disabled = blocked;
      b.addEventListener('click', () => socket.emit('rebelVassalage', {}, handleGameAck));
      actions.appendChild(b);
    }
  }



  function renderIslandCorrection() {
    const r = state.room;
    const badge = $('islandCorrectionBadge');
    const content = $('islandCorrectionContent');
    const actions = $('islandCorrectionActions');
    if (!badge || !content || !actions) return;
    actions.innerHTML = '';
    const pending = r?.pendingIslandCorrection;

    if (!r?.started) {
      badge.textContent = '—';
      content.textContent = 'После начала партии здесь появится обязательный выбор, если остров потеряет бонус статуса и нарушит ограничения.';
      return;
    }
    if (!pending) {
      badge.textContent = 'норма';
      content.innerHTML = '<div class="event-current">Все острова соответствуют текущей площади и пределам ветвей.</div><div class="cargo-meta">При потере статуса программа автоматически проверит остров и остановит игру, если придётся удалить лишние постройки.</div>';
      return;
    }

    if (!pending.viewerCanRespond) {
      badge.textContent = 'ожидание';
      content.textContent = `${playerName(pending.playerId)} принимает обязательное решение по острову.`;
      return;
    }

    const report = pending.report || {};
    const branches = (report.branchViolations || []).map(v => `${escapeHtml(v.name)}: ${v.count}/${v.limit}`).join(' · ');
    const area = report.overArea > 0 ? `Площадь: <strong>${report.usedArea}/${report.effectiveArea}</strong> — нужно освободить минимум ${report.overArea}.` : `Площадь: ${report.usedArea}/${report.effectiveArea}.`;
    badge.textContent = pending.viewerCanRespond ? 'обязательно' : 'ожидание';

    if ((pending.kind || 'constraints') === 'capture-retention') {
      const remaining = Math.max(0, Number(pending.remainingRemovals) || 0);
      const removed = pending.removed?.length ? `<div class="cargo-meta">Уже выбрано для уничтожения: ${pending.removed.map(escapeHtml).join(', ')}.</div>` : '';
      content.innerHTML = `<div class="event-current"><strong>${escapeHtml(pending.islandName)}</strong><br>${escapeHtml(pending.reason || '')}</div><div class="event-effect">Сохранится ${pending.keepCount} из ${pending.initialBuildingCount} существовавших построек · осталось выбрать: ${remaining}.</div><div class="cargo-meta">Награды, появившиеся уже после штурма, в этот выбор не входят.</div>${removed}`;
    } else {
      const removed = pending.removed?.length ? `<div class="cargo-meta">Уже удалено: ${pending.removed.map(escapeHtml).join(', ')}.</div>` : '';
      content.innerHTML = `<div class="event-current"><strong>${escapeHtml(pending.islandName)}</strong> · статус «${escapeHtml(report.status || '—')}»<br>${escapeHtml(pending.reason || '')}</div><div class="event-effect">${area}${branches ? `<br>Превышение ветвей: ${branches}.` : ''}</div><div class="cargo-meta">Удаляйте выбранные постройки без компенсации, пока одновременно не будут соблюдены площадь и предел каждой обычной ветви.</div>${removed}`;
    }

    for (const option of pending.options || []) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'build-btn danger-soft';
      const branch = option.branchName ? ` · ${option.branchName}` : '';
      b.textContent = `Удалить ${option.name} · площадь ${option.area}${branch}`;
      b.addEventListener('click', () => socket.emit('resolveIslandCorrection', { correctionId: pending.id, buildingIndex: option.buildingIndex }, handleGameAck));
      actions.appendChild(b);
    }
  }

  function renderFleetAdjustment() {
    const r = state.room;
    const badge = $('fleetAdjustmentBadge');
    const content = $('fleetAdjustmentContent');
    const actions = $('fleetAdjustmentActions');
    if (!badge || !content || !actions) return;
    actions.innerHTML = '';
    const pending = r?.pendingFleetAdjustment;

    if (!r?.started) {
      badge.textContent = '—';
      content.textContent = 'После начала партии здесь появятся обязательные решения по составу флотилии.';
      return;
    }
    if (!pending) {
      badge.textContent = 'норма';
      content.innerHTML = '<div class="event-current">Флотилия соответствует текущим ограничениям.</div><div class="cargo-meta">Здесь появится обязательный выбор при потере уровня основного корабля или места верфи.</div>';
      state.fleetAdjustmentKey = null;
      state.fleetAdjustmentSelection = new Set();
      return;
    }

    badge.textContent = pending.viewerCanRespond ? 'обязательно' : 'ожидание';
    const stageLabels = {
      upgrades: 'временно неактивные улучшения корабля',
      escorts: 'временно неактивные суда сопровождения',
      'shipyard-remove': 'суда сопровождения для удаления',
      'landin-replace': 'судно сопровождения для замены Ландином',
      bastions: 'временно неактивные бастионы',
    };
    if (!pending.viewerCanRespond) {
      content.innerHTML = `<div class="event-current"><strong>${escapeHtml(playerName(pending.playerId))}</strong> выбирает ${escapeHtml(stageLabels[pending.stage] || 'состав флотилии')}.</div>`;
      return;
    }

    const key = `${pending.id}:${pending.stage}`;
    if (state.fleetAdjustmentKey !== key) {
      state.fleetAdjustmentKey = key;
      state.fleetAdjustmentSelection = new Set();
    }
    const selected = state.fleetAdjustmentSelection || new Set();
    let instruction = `Выберите ровно <strong>${pending.required}</strong> элементов.`;
    let note = '';
    if (pending.stage === 'bastions') {
      instruction = `Выберите ровно <strong>${pending.required}</strong> бастионов, которые временно не будут давать защиту.`;
      note = 'Бастионы остаются зданиями на своих клетках и снова дают +10 войска после восстановления достаточного числа мест поддержки.';
    } else if (pending.stage === 'upgrades' || pending.stage === 'escorts') {
      instruction = `Выберите ровно <strong>${pending.required}</strong> ${pending.stage === 'upgrades' ? 'улучшений' : 'судов сопровождения'}, которые временно не будут действовать.`;
      note = pending.stage === 'escorts' ? 'Неактивное сопровождение продолжает следовать за флотилией; уже погруженный груз сохраняется, но судно не даёт артиллерию и его трюм нельзя загружать или продавать до восстановления уровня.' : 'Улучшения остаются установленными и снова включатся, когда мест станет достаточно.';
    } else if (pending.stage === 'shipyard-remove') {
      instruction = `Выберите ровно <strong>${pending.required}</strong> обычных судов сопровождения для окончательного удаления.`;
      note = 'Это не временное отключение: выбранные суда уничтожаются из-за нехватки мест верфи. Их груз также пропадает.';
    } else if (pending.stage === 'landin-replace') {
      instruction = 'Выберите <strong>одно</strong> имеющееся судно, которое заменит особое сопровождение Ландина.';
      note = `Сопровождение Ландина: +${r.escortCatalog.landin.artillery} артиллерии, трюм ${r.escortCatalog.landin.cargo}. Груз заменённого судна пропадёт.`;
    }
    const decisionTitle = pending.stage === 'bastions' ? 'Обязательный выбор поддержки бастионов' : 'Обязательное решение по флотилии';
    content.innerHTML = `<div class="event-current"><strong>${decisionTitle}</strong><br>${escapeHtml(pending.reason || '')}</div><div class="event-effect">${instruction}</div>${note ? `<div class="cargo-meta">${escapeHtml(note)}</div>` : ''}`;

    const redrawButtons = () => {
      actions.innerHTML = '';
      for (const option of pending.options || []) {
        const b = document.createElement('button');
        b.type = 'button';
        const chosen = selected.has(option.id);
        b.className = `build-btn ${chosen ? 'primary' : ''}`;
        let suffix = '';
        if (pending.stage === 'upgrades') {
          if (option.missingRequirement) suffix = ' · без бонуса: нет первого улучшения ветви';
        } else if (pending.stage !== 'bastions') {
          if (option.special && option.type !== 'landin') suffix += ' · особое';
          if (option.artillery) suffix += ` · арт. +${option.artillery}`;
          if (option.cargoCapacity) suffix += ` · трюм ${option.cargoCapacity}`;
          if (option.hasCargo) suffix += ` · груз ${option.cargoText || ''}`;
        }
        b.textContent = `${chosen ? '✓ ' : ''}${option.name}${suffix}`;
        b.addEventListener('click', () => {
          if (selected.has(option.id)) selected.delete(option.id);
          else if (selected.size < pending.required) selected.add(option.id);
          redrawButtons();
        });
        actions.appendChild(b);
      }
      const confirm = document.createElement('button');
      confirm.type = 'button';
      confirm.className = 'build-btn primary';
      const verb = pending.stage === 'shipyard-remove' ? 'Удалить' : (pending.stage === 'landin-replace' ? 'Заменить на Ландин' : 'Подтвердить');
      confirm.textContent = `${verb} (${selected.size}/${pending.required})`;
      confirm.disabled = selected.size !== pending.required;
      confirm.addEventListener('click', () => socket.emit('resolveFleetAdjustment', { adjustmentId: pending.id, ids: [...selected] }, handleGameAck));
      actions.appendChild(confirm);
    };
    redrawButtons();
  }

  function renderAssignments() {
    const r = state.room;
    const mine = me();
    const badge = $('assignmentBadge');
    const content = $('assignmentContent');
    const actions = $('assignmentActions');
    if (!badge || !content || !actions) return;
    actions.innerHTML = '';
    if (!mine) { badge.textContent = '—'; content.textContent = 'Данные поручения недоступны.'; return; }

    const assignment = mine.activeAssignment;
    const pending = r.pendingAssignmentChoice;
    const suzerain = mine.suzerainId ? r.factions?.find(f => f.id === mine.suzerainId) : null;
    const assignmentFaction = assignment ? (r.factions?.find(f => f.id === assignment.factionId) || suzerain) : suzerain;
    const priority = mine.assignmentPriority || null;
    badge.textContent = pending?.viewerCanRespond ? 'выбор' : (priority ? 'обязательно' : assignment ? 'активно' : (suzerain ? 'ожидание' : 'нет'));
    let html = '';
    if (!suzerain && !assignment) {
      html = '<div class="event-current">Вы не состоите в подданстве. Поручения получают вассалы Лионии, Кадингира, Мори, Вольной Суниксии и пиратов.</div>';
    } else if (assignment) {
      const share = Number(assignmentFaction?.rewardShare) || 0;
      const withheld = share ? Math.floor(assignment.reward * share) : 0;
      const net = assignment.reward - withheld;
      html = `<div class="event-current"><strong>${escapeHtml(assignmentFaction?.name || assignment.factionId || 'Сюзерен')}</strong><br>«${escapeHtml(assignment.text)}»</div><div class="event-effect">Награда: ${assignment.reward} дукатов${withheld ? ` · сюзерен удержит ${withheld}, вам ${net}` : ' · выплачивается полностью'}.</div>`;
      if (priority) {
        const priorityLabels = { building: 'строительство или улучшение', 'ship-level': 'повышение уровня корабля', 'ship-upgrade': 'улучшение корабля', anchor: 'бой на морском якоре', delivery: 'доставка груза', assault: 'штурм острова', treasure: 'разрешение сокровища' };
        html += `<div class="assignment-priority"><strong>Поручение имеет приоритет.</strong><br>Сейчас доступно обязательное действие: ${escapeHtml(priorityLabels[priority.kind] || priority.kind || 'выполнение условия')}.</div>`;
      }
      const progress = assignment.progress;
      if (progress?.kind === 'mori-service') {
        const completed = Number(progress.completedStopCount) || 0;
        const total = Math.max(1, Number(progress.totalStops) || (assignment.type === 'visit-route' ? 2 : 1));
        if (progress.departureRequired && !progress.departureSatisfied) {
          html += '<div class="assignment-progress"><strong>Служба Мори:</strong> карта выдана у первого пункта. Сначала покиньте все его береговые клетки; после этого вернитесь и завершите навигацию у нужного берега.</div>';
        } else if (total > 1) {
          const marked = (progress.completedStops || []).map(stop => stop.label).filter(Boolean);
          html += `<div class="assignment-progress"><strong>Маршрут Мори:</strong> ${completed}/${total} пунктов${marked.length ? ` · отмечено: ${escapeHtml(marked.join(' → '))}` : ''}. Пункты выполняются только по порядку завершением навигации.</div>`;
        } else {
          html += `<div class="assignment-progress"><strong>Служба Мори:</strong> ${completed}/${total}. Завершите навигацию на береговой клетке указанного острова.</div>`;
        }
      }
      if (assignment.type === 'delivery') html += '<div class="cargo-meta">Засчитывается только полный трюм, полученный после выдачи этого поручения. Продажа идёт по обычной цене; отдельная награда выдаётся за выполнение поручения.</div>';
    } else {
      html = `<div class="event-current"><strong>${escapeHtml(suzerain.name)}</strong><br>Активного поручения нет. Если в начале вашего следующего личного хода шестого круга вы всё ещё вассал без поручения, карта будет выдана тогда.</div>`;
    }
    content.innerHTML = html;

    if (pending?.viewerCanRespond && pending.kind === 'embassy') {
      const faction = r.factions?.find(f => f.id === pending.factionId);
      const optionShare = Number(faction?.rewardShare) || 0;
      const label = document.createElement('div');
      label.className = 'action-group-label';
      label.textContent = 'Посольство: выберите одно из допустимых поручений';
      actions.appendChild(label);
      for (const option of pending.options || []) {
        const optionWithheld = optionShare ? Math.floor((Number(option.reward) || 0) * optionShare) : 0;
        const optionNet = (Number(option.reward) || 0) - optionWithheld;
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'build-btn primary';
        b.textContent = `«${option.text}» · награда ${option.reward} дук.${optionWithheld ? ` · вам ${optionNet}` : ''}`;
        b.addEventListener('click', () => socket.emit('respondAssignmentChoice', { choiceId: pending.id, assignmentId: option.id }, handleGameAck));
        actions.appendChild(b);
      }
    }
  }

  function renderLegendaryPlaces() {
    const r = state.room;
    const mine = me();
    const content = $('legendaryPlacesContent');
    const actions = $('legendaryPlacesActions');
    const badge = $('legendaryPlacesBadge');
    actions.innerHTML = '';
    if (!mine) {
      badge.textContent = '0/10';
      content.textContent = 'Данные легендарных мест недоступны.';
      return;
    }

    const places = r.legendaryPlaces || [];
    const placeById = Object.fromEntries(places.map(place => [place.id, place]));
    const namedCards = r.namedPlaceCards || [];
    const claimedCount = namedCards.filter(card => card.claimedBy).length;
    badge.textContent = `${claimedCount}/${namedCards.length || 10}`;

    let html = '<div class="legendary-journey-summary"><strong>Первое открытие</strong><br>Морское легендарное место открывается первым посещением. Атлантия, Адия и Череп открываются только первым военным завоеванием. Первое открытие даёт открытую именную карту и одну случайную легендарную карту.</div>';

    const activeExpedition = mine.activeExpedition;
    if (activeExpedition) {
      const target = placeById[activeExpedition.placeId];
      const targetKind = target?.kind === 'island' ? 'легендарный остров' : 'морское легендарное место';
      const leaveRule = activeExpedition.requiresLeaveAndReturn
        ? '<div class="expedition-warning"><strong>Сначала покиньте место.</strong> Эта экспедиция была получена уже в точке назначения; после выхода нужно вернуться.</div>'
        : '<div class="cargo-meta">Завершится автоматически при следующем допустимом прибытии; отдельное действие не требуется.</div>';
      html += `<div class="active-expedition"><strong>Ваша экспедиция: ${escapeHtml(activeExpedition.name || target?.name || activeExpedition.placeId)}</strong><div class="cargo-meta">Цель: ${escapeHtml(targetKind)} · получена в раунде ${activeExpedition.acceptedRound || r.round} · награда: случайное сокровище.</div>${leaveRule}</div>`;
    } else {
      const roundStatus = mine.expeditionTakenThisRound ? 'В этом раунде новая экспедиция уже получалась.' : 'Новой экспедиции в этом раунде ещё не было.';
      html += `<div class="active-expedition muted">Активной экспедиции нет. ${escapeHtml(roundStatus)} Чтобы взять карту, завершите навигацию у своего острова с Картографической палатой и потратьте 1 действие.</div>`;
    }

    const history = mine.expeditionHistory || [];
    const expeditionTargetCount = places.filter(place => place.kind === 'sea').length || 7;
    html += `<div class="expedition-history"><strong>Ваша история экспедиций · ${history.length}/${expeditionTargetCount}</strong>`;
    if (history.length) {
      html += history.map(item => `<div class="expedition-history-row"><span>${escapeHtml(item.name || placeById[item.placeId]?.name || item.placeId)}</span><span>раунд ${item.completedRound || '—'}</span></div>`).join('');
    } else {
      html += '<div class="cargo-meta">Завершённых мест пока нет.</div>';
    }
    html += '</div>';

    html += '<div class="named-place-grid">';
    for (const card of namedCards) {
      const place = placeById[card.placeId];
      const owner = card.claimedBy ? playerName(card.claimedBy) : 'не открыто';
      const mineClass = card.claimedBy === state.myId ? ' mine' : '';
      const claimedClass = card.claimedBy ? ' claimed' : '';
      const kind = place?.kind === 'island' ? 'остров' : 'море';
      html += `<div class="named-place-card${claimedClass}${mineClass}"><strong>${escapeHtml(card.name)}</strong><span>${escapeHtml(kind)} · ${escapeHtml(owner)}</span></div>`;
    }
    html += '</div>';
    content.innerHTML = html;

    if (mine.canTakeExpedition) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'primary';
      button.textContent = 'Взять случайную экспедицию · 1 действие';
      button.addEventListener('click', () => socket.emit('takeExpedition', {}, handleGameAck));
      actions.appendChild(button);
    }
  }

  function renderLegendary() {
    const r = state.room;
    const mine = me();
    const content = $('legendaryContent');
    const actions = $('legendaryActions');
    const badge = $('legendaryBadge');
    actions.innerHTML = '';
    if (!mine) {
      badge.textContent = '0';
      content.textContent = 'Легендарные карты недоступны.';
      return;
    }

    const cards = mine.playableLegendaryCards || [];
    badge.textContent = String(cards.length);
    const reaction = r.pendingLegendaryReaction;
    const status = mine.legendaryStatus || {};
    const protectedIslands = (r.islands || []).filter(i => i.legendaryVeil?.remaining > 0 && i.legendaryVeil.sourcePlayerId === state.myId);
    const statusParts = [];
    if (status.shipVeilTurns) statusParts.push(`Покров корабля: ${status.shipVeilTurns} хода`);
    if (status.seaCursePenalty) statusParts.push(`Морское проклятие: −${status.seaCursePenalty} к движению (${(status.seaCurseTurns || []).join('/')})`);
    for (const island of protectedIslands) statusParts.push(`${island.name}: Покров ${island.legendaryVeil.remaining} хода`);

    let html = statusParts.length
      ? `<div class="legendary-status">${statusParts.map(x => escapeHtml(x)).join('<br>')}</div>`
      : '<div class="legendary-status muted">Активных легендарных эффектов нет.</div>';

    if (reaction) {
      const source = playerName(reaction.sourcePlayerId);
      const island = reaction.islandId ? r.islands.find(i => i.id === reaction.islandId) : null;
      const what = reaction.kind === 'sea-attack'
        ? `морскую атаку ${source}`
        : reaction.kind === 'assault'
          ? `штурм ${island?.name || 'острова'} игроком ${source}`
          : reaction.kind === 'sea-curse'
            ? `«Морское проклятие» от ${source}`
            : `«Пламя Ада» против ${island?.name || 'острова'} от ${source}`;
      html += `<div class="legendary-reaction"><strong>Реакция «Покров моря»</strong><br>${reaction.viewerCanRespond ? `Можно отменить ${escapeHtml(what)}.` : `Ожидается решение защитника: ${escapeHtml(playerName(reaction.targetPlayerId))}.`}</div>`;
      content.innerHTML = html;
      if (reaction.viewerCanRespond) {
        for (const ref of reaction.veilOptions || []) {
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'primary';
          b.textContent = `Сыграть «Покров моря» (${ref.source === 'special' ? 'одноразовая' : 'легендарная'})`;
          b.addEventListener('click', () => socket.emit('respondLegendaryReaction', { reactionId: reaction.id, useVeil: true, source: ref.source, index: ref.index }, handleGameAck));
          actions.appendChild(b);
        }
        const no = document.createElement('button');
        no.type = 'button'; no.className = 'danger-soft'; no.textContent = 'Не использовать Покров';
        no.addEventListener('click', () => socket.emit('respondLegendaryReaction', { reactionId: reaction.id, useVeil: false }, handleGameAck));
        actions.appendChild(no);
      }
      return;
    }

    if (!cards.length) html += '<div class="legendary-empty">В руке нет легендарных или особых одноразовых карт.</div>';
    content.innerHTML = html;

    const myTurn = r.started && r.activePlayerId === state.myId;
    const canUse = myTurn && mine.phase === 'actions' && (mine.actionsLeft ?? 0) > 0 && !isDecisionPending();
    const ownIslands = (r.islands || []).filter(i => i.ownerId === state.myId);
    const current = currentIslands();
    const foreignHere = current.filter(i => i.ownerId !== state.myId);
    const shipsHere = (r.players || []).filter(p => p.id !== state.myId && p.row === mine.row && p.col === mine.col && !areAlliesClient(state.myId, p.id));

    if (state.mistCardRef && !cards.some(c => c.source === state.mistCardRef.source && c.index === state.mistCardRef.index && c.kind === 'mist-path')) state.mistCardRef = null;

    const descriptions = {
      'sea-veil': `Защитить свою флотилию или один свой остров на ${r.balanceCatalog.legendaryEffects['sea-veil'].durationPersonalTurns} следующих личных хода.`,
      hellfire: 'На клетке чужого острова понизить каждую постройку на одну строительную ступень; исходная I удаляется.',
      'mist-path': 'Перенести флотилию на любую клетку, достижимую без запрещённых препятствий.',
      'sea-curse': `На одной клетке с чужим кораблём дать −${r.balanceCatalog.legendaryEffects['sea-curse'].amount} к обычному движению на ${r.balanceCatalog.legendaryEffects['sea-curse'].durationPersonalTurns} следующих личных хода.`,
    };

    for (const ref of cards) {
      const wrap = document.createElement('div');
      wrap.className = 'legendary-card';
      wrap.innerHTML = `<strong>${escapeHtml(ref.name)}</strong><div class="cargo-meta">${escapeHtml(descriptions[ref.kind] || '')} · 1 действие</div>`;
      const row = document.createElement('div');
      row.className = 'legendary-card-actions';

      if (ref.kind === 'sea-veil') {
        const ship = document.createElement('button');
        ship.type = 'button'; ship.textContent = 'Защитить флотилию'; ship.disabled = !canUse;
        ship.addEventListener('click', () => socket.emit('playLegendary', { source: ref.source, index: ref.index, targetType: 'ship' }, handleGameAck));
        row.appendChild(ship);
        for (const island of ownIslands) {
          const b = document.createElement('button');
          b.type = 'button'; b.textContent = `Защитить ${island.name}`; b.disabled = !canUse;
          b.addEventListener('click', () => socket.emit('playLegendary', { source: ref.source, index: ref.index, targetType: 'island', islandId: island.id }, handleGameAck));
          row.appendChild(b);
        }
      } else if (ref.kind === 'mist-path') {
        const b = document.createElement('button');
        b.type = 'button'; b.className = state.mistCardRef?.source === ref.source && state.mistCardRef?.index === ref.index ? 'primary' : '';
        b.textContent = state.mistCardRef?.source === ref.source && state.mistCardRef?.index === ref.index ? 'Отменить выбор клетки' : 'Выбрать клетку на карте';
        b.disabled = !canUse;
        b.addEventListener('click', () => { state.mistCardRef = state.mistCardRef?.source === ref.source && state.mistCardRef?.index === ref.index ? null : { source: ref.source, index: ref.index }; renderLegendary(); renderMap(); });
        row.appendChild(b);
      } else if (ref.kind === 'hellfire') {
        for (const island of foreignHere) {
          const owner = island.ownerId ? r.players.find(p => p.id === island.ownerId) : null;
          const blocked = !canUse || mine.inPeaceZone || (owner && (r.round === 1 || areAlliesClient(state.myId, owner.id)));
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'danger-soft'; b.textContent = `Пламя → ${island.name}${island.legendaryVeil?.remaining ? ' · Покров отменит карту' : ''}`; b.disabled = blocked;
          b.addEventListener('click', () => socket.emit('playLegendary', { source: ref.source, index: ref.index, islandId: island.id }, handleGameAck));
          row.appendChild(b);
        }
        if (!foreignHere.length) {
          const note = document.createElement('span'); note.className = 'cargo-meta'; note.textContent = 'На текущей клетке нет чужого острова.'; row.appendChild(note);
        }
      } else if (ref.kind === 'sea-curse') {
        for (const target of shipsHere) {
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'danger-soft'; b.textContent = `Проклясть ${target.name}${target.legendaryStatus?.shipVeilTurns ? ' · Покров отменит карту' : ''}`;
          b.disabled = !canUse || r.round === 1 || mine.inPeaceZone;
          b.addEventListener('click', () => socket.emit('playLegendary', { source: ref.source, index: ref.index, targetPlayerId: target.id }, handleGameAck));
          row.appendChild(b);
        }
        if (!shipsHere.length) {
          const note = document.createElement('span'); note.className = 'cargo-meta'; note.textContent = 'На текущей клетке нет допустимой цели.'; row.appendChild(note);
        }
      }
      wrap.appendChild(row);
      actions.appendChild(wrap);
    }

    if (state.mistCardRef) {
      const hint = document.createElement('div');
      hint.className = 'legendary-map-hint';
      hint.textContent = '«Путь сквозь туман»: выберите подсвеченную клетку прямо на карте.';
      actions.appendChild(hint);
    }
  }

  function activeGoalCount(mine) {
    if (!mine) return 0;
    return Number(Boolean(mine.activeAssignment)) + Number(Boolean(mine.activeExpedition));
  }

  function assignmentGoalHtml(mine) {
    const assignment = mine?.activeAssignment;
    const r = state.room;
    const suzerain = mine?.suzerainId ? r?.factions?.find(f => f.id === mine.suzerainId) : null;
    if (!assignment) {
      if (suzerain) {
        return `
          <section class="goal-card goal-card-muted">
            <span>ПОРУЧЕНИЕ СЮЗЕРЕНА</span>
            <strong>Активного поручения нет</strong>
            <small>Если в начале подходящего шестого круга вы всё ещё вассал без поручения, оно будет выдано игровой системой.</small>
          </section>
        `;
      }
      return `
        <section class="goal-card goal-card-muted">
          <span>ПОРУЧЕНИЕ</span>
          <strong>Нет активного поручения</strong>
          <small>Поручения получают вассалы государств по действующим правилам политики.</small>
        </section>
      `;
    }

    const faction = r?.factions?.find(f => f.id === assignment.factionId) || suzerain;
    const share = Number(faction?.rewardShare) || 0;
    const withheld = share ? Math.floor((Number(assignment.reward) || 0) * share) : 0;
    const net = (Number(assignment.reward) || 0) - withheld;
    const progress = assignment.progress;
    let progressHtml = '';
    if (progress?.kind === 'mori-service') {
      const completed = Number(progress.completedStopCount) || 0;
      const total = Math.max(1, Number(progress.totalStops) || (assignment.type === 'visit-route' ? 2 : 1));
      const labels = (progress.completedStops || []).map(stop => stop.label).filter(Boolean);
      const leave = progress.departureRequired && !progress.departureSatisfied
        ? 'Сначала нужно покинуть исходное место.'
        : `${completed}/${total}${labels.length ? ` · ${labels.join(' → ')}` : ''}`;
      progressHtml = `<div class="goal-progress"><span>Прогресс</span><strong>${escapeHtml(leave)}</strong></div>`;
    }

    const priority = mine.assignmentPriority;
    const priorityText = priority
      ? `<div class="goal-priority">Поручение сейчас имеет приоритет: ${escapeHtml(priority.kind || 'обязательное действие')}.</div>`
      : '';

    return `
      <section class="goal-card goal-card-assignment">
        <span>ПОРУЧЕНИЕ · ${escapeHtml(faction?.name || assignment.factionId || 'Сюзерен')}</span>
        <strong>${escapeHtml(assignment.text)}</strong>
        <div class="goal-reward"><span>Награда</span><strong>${assignment.reward} дук.${withheld ? ` · вам ${net}` : ''}</strong></div>
        ${progressHtml}
        ${priorityText}
      </section>
    `;
  }

  function expeditionGoalHtml(mine) {
    const r = state.room;
    const expedition = mine?.activeExpedition;
    const places = r?.legendaryPlaces || [];
    const placeById = Object.fromEntries(places.map(place => [place.id, place]));
    if (!expedition) {
      const status = mine?.expeditionTakenThisRound
        ? 'В этом раунде новая экспедиция уже получалась.'
        : 'Новую экспедицию можно получить при выполнении условий Картографической палаты.';
      return `
        <section class="goal-card goal-card-muted">
          <span>ЭКСПЕДИЦИЯ</span>
          <strong>Активной экспедиции нет</strong>
          <small>${escapeHtml(status)}</small>
        </section>
      `;
    }

    const target = placeById[expedition.placeId];
    const targetName = expedition.name || target?.name || expedition.placeId;
    const kind = target?.kind === 'island' ? 'легендарный остров' : 'морское легендарное место';
    const routeRule = expedition.requiresLeaveAndReturn
      ? 'Сначала покиньте место назначения, затем вернитесь.'
      : 'Завершится автоматически при следующем допустимом прибытии.';

    return `
      <section class="goal-card goal-card-expedition">
        <span>ЭКСПЕДИЦИЯ</span>
        <strong>${escapeHtml(targetName)}</strong>
        <div class="goal-progress"><span>Цель</span><strong>${escapeHtml(kind)}</strong></div>
        <div class="goal-reward"><span>Награда</span><strong>случайное сокровище</strong></div>
        <small>${escapeHtml(routeRule)}</small>
      </section>
    `;
  }

  function legendaryGoalsHtml(mine) {
    const r = state.room;
    const cards = r?.namedPlaceCards || [];
    const history = mine?.expeditionHistory || [];
    const claimed = cards.filter(card => card.claimedBy);
    const mineClaimed = claimed.filter(card => card.claimedBy === state.myId);
    return `
      <section class="goals-legendary-summary">
        <div><span>Именные места</span><strong>${claimed.length}/${cards.length || 10}</strong></div>
        <div><span>Открыто вами</span><strong>${mineClaimed.length}</strong></div>
        <div><span>Экспедиции</span><strong>${history.length}</strong></div>
      </section>
      <section class="goals-place-list">
        ${cards.map(card => {
          const owner = card.claimedBy ? playerName(card.claimedBy) : 'не открыто';
          const mineClass = card.claimedBy === state.myId ? ' mine' : '';
          return `<div class="goals-place${mineClass}"><strong>${escapeHtml(card.name)}</strong><span>${escapeHtml(owner)}</span></div>`;
        }).join('')}
      </section>
      ${history.length ? `
        <section class="goals-history">
          <span>ВАША ИСТОРИЯ ЭКСПЕДИЦИЙ</span>
          ${history.map(item => `<div><strong>${escapeHtml(item.name || item.placeId)}</strong><small>раунд ${item.completedRound || '—'}</small></div>`).join('')}
        </section>
      ` : ''}
    `;
  }

  function goalsSheetHtml(mine) {
    return `
      <div class="goals-intro">Текущие личные цели и прогресс. Это представление существующего состояния игры, а не отдельная система заданий.</div>
      <div class="goals-stack">
        ${assignmentGoalHtml(mine)}
        ${expeditionGoalHtml(mine)}
      </div>
      ${legendaryGoalsHtml(mine)}
    `;
  }

  function moveCanonicalGoalActions(target) {
    if (!target) return;
    const assignmentSource = $('assignmentActions');
    if (assignmentSource && !state.room?.pendingAssignmentChoice?.viewerCanRespond) {
      while (assignmentSource.firstChild) target.appendChild(assignmentSource.firstChild);
    }
    const expeditionSource = $('legendaryPlacesActions');
    if (expeditionSource) {
      while (expeditionSource.firstChild) target.appendChild(expeditionSource.firstChild);
    }
  }

  function renderGoalsObjectSheet() {
    const mine = me();
    if (!mine || state.spectating || isDecisionPending()) return;
    closeMapInfo();
    state.mapSelection = { kind: 'goals', id: 'personal-goals' };
    $('objectSheetKind').textContent = 'ВАШИ ЦЕЛИ';
    $('objectSheetTitle').textContent = 'Цели';
    $('objectSheetBody').innerHTML = goalsSheetHtml(mine);

    // Existing assignment/legendary-place renderers remain authoritative for actions.
    renderAssignments();
    renderLegendaryPlaces();
    const actions = $('objectSheetActions');
    actions.innerHTML = '';
    moveCanonicalGoalActions(actions);

    if (!actions.children.length) {
      const note = document.createElement('div');
      note.className = 'goals-no-actions';
      note.textContent = 'Сейчас цели не требуют отдельного действия. Прогресс обновляется игровой механикой автоматически.';
      actions.appendChild(note);
    }

    $('objectSheet').classList.remove('hidden');
    $('objectSheet').classList.add('expanded');
    $('objectSheetExpand').textContent = '⌄';
    $('objectSheetExpand').setAttribute('aria-label', 'Свернуть карточку');
    document.body.classList.add('object-sheet-open');
  }

  function refreshOpenGoalsSheet() {
    if (state.mapSelection?.kind !== 'goals' || !isMobileGameplayUi()) return;
    renderGoalsObjectSheet();
  }

  function digitalCardEntries(mine) {
    if (!mine) return [];
    const entries = [];
    for (const card of mine.savedEventCards || []) {
      entries.push({ group: 'saved', id: card.id, name: card.name, kind: card.kind, label: 'СОХРАНЁННОЕ СОБЫТИЕ' });
    }
    for (const ref of mine.playableLegendaryCards || []) {
      entries.push({
        group: ref.source === 'special' ? 'special' : 'legendary',
        id: `${ref.source}:${ref.index}`,
        name: ref.name,
        kind: ref.kind,
        label: ref.source === 'special' ? 'ОСОБЫЙ ЭФФЕКТ' : 'ЛЕГЕНДАРНЫЙ ЭФФЕКТ',
      });
    }
    return entries;
  }

  function digitalCardKindText(entry) {
    const descriptions = {
      'found-cargo': 'Сохранённый груз можно поместить в свободный активный трюм.',
      'treasure-cargo': 'Сохранённый результат сокровища можно поместить в свободный активный трюм.',
      'ship-master': 'Бесплатное улучшение корабля применяется в Цитадели.',
      'market-blueprint': 'Бесплатное строительство рынка на своём острове.',
      'farm-blueprint': 'Бесплатное строительство фермы на своём острове.',
      'sea-veil': 'Защита флотилии или своего острова на ограниченное число личных ходов.',
      hellfire: 'Воздействие на постройки чужого острова на текущей клетке.',
      'mist-path': 'Одноразовое перемещение к допустимой клетке карты.',
      'sea-curse': 'Временный штраф к движению чужого корабля на текущей клетке.',
    };
    return descriptions[entry.kind] || 'Цифровой игровой эффект. Условия применения определяет текущее состояние партии.';
  }

  function cardsSheetHtml(mine) {
    const entries = digitalCardEntries(mine);
    if (!entries.length) {
      return `
        <div class="cards-empty">
          <span>НЕТ СОХРАНЁННЫХ ЭФФЕКТОВ</span>
          <strong>Сейчас у вас нет цифровых карт для ручного применения.</strong>
          <small>События, сокровища и легендарные награды появляются только через игровую механику; отдельной физической колоды в интерфейсе нет.</small>
        </div>
      `;
    }
    return `
      <div class="cards-ux-note">Это цифровые игровые эффекты, а не отдельная симуляция физической колоды.</div>
      <div class="cards-hand">
        ${entries.map(entry => `
          <article class="digital-card digital-card-${escapeAttr(entry.group)}">
            <span>${escapeHtml(entry.label)}</span>
            <strong>${escapeHtml(entry.name)}</strong>
            <small>${escapeHtml(digitalCardKindText(entry))}</small>
          </article>
        `).join('')}
      </div>
    `;
  }

  function moveSavedEventActions(target) {
    const source = $('eventActions');
    if (!source || !target) return;
    let currentCard = null;
    for (const node of Array.from(source.children)) {
      if (node.classList?.contains('saved-event-card')) {
        currentCard = document.createElement('section');
        currentCard.className = 'cards-action-group cards-action-saved';
        currentCard.appendChild(node);
        target.appendChild(currentCard);
        continue;
      }
      if (currentCard) currentCard.appendChild(node);
    }
  }

  function moveLegendaryCardActions(target) {
    const source = $('legendaryActions');
    if (!source || !target) return;
    for (const node of Array.from(source.children)) {
      if (node.classList?.contains('legendary-card') || node.classList?.contains('legendary-map-hint')) {
        target.appendChild(node);
      }
    }
  }

  function renderCardsObjectSheet() {
    const mine = me();
    if (!mine || state.spectating || isDecisionPending()) return;
    closeMapInfo();
    state.mapSelection = { kind: 'cards', id: 'digital-cards' };
    $('objectSheetKind').textContent = 'ВАШИ ЭФФЕКТЫ';
    $('objectSheetTitle').textContent = 'Карты';
    $('objectSheetBody').innerHTML = cardsSheetHtml(mine);

    // Existing event/legendary renderers remain authoritative for all legality and payloads.
    renderEvents();
    renderLegendary();
    const actions = $('objectSheetActions');
    actions.innerHTML = '';
    moveSavedEventActions(actions);
    moveLegendaryCardActions(actions);

    if (!actions.children.length && digitalCardEntries(mine).length) {
      const note = document.createElement('div');
      note.className = 'cards-no-actions';
      note.textContent = 'Эффекты есть, но сейчас ни один из них нельзя применить.';
      actions.appendChild(note);
    }

    $('objectSheet').classList.remove('hidden');
    $('objectSheet').classList.add('expanded');
    $('objectSheetExpand').textContent = '⌄';
    $('objectSheetExpand').setAttribute('aria-label', 'Свернуть карточку');
    document.body.classList.add('object-sheet-open');
  }

  function refreshOpenCardsSheet() {
    if (state.mapSelection?.kind !== 'cards' || !isMobileGameplayUi()) return;
    renderCardsObjectSheet();
  }

  const CHARACTER_UX = {
    navigator: {
      role: 'НАВИГАЦИЯ',
      summary: 'После обычного броска позволяет один раз перебросить навигацию. Второй результат обязателен.',
      hint: 'Доступен только после броска навигации и требует 1 действие.',
    },
    cartographer: {
      role: 'РАЗВЕДКА МОРЯ',
      summary: 'До броска навигации позволяет тайно посмотреть верхнюю карту одного доступного морского якоря.',
      hint: 'На мобильном цель выбирается прямо на карте.',
    },
    scout: {
      role: 'РАЗВЕДКА',
      summary: 'Раскрывает гарнизон одного чужого острова или точную казну одного другого игрока в радиусе 4.',
      hint: 'Полученные данные видны только вам и действуют до конца текущего личного хода.',
    },
    treasureHunter: {
      role: 'СОКРОВИЩА',
      summary: 'Определяет два независимых результата сокровища и позволяет выбрать один.',
      hint: 'Использование требует 1 действие; выбор результата приходит как обязательное решение.',
    },
    firstMate: {
      role: 'КОМАНДА',
      summary: 'Даёт одно дополнительное действие в текущем ходу.',
      hint: 'Применяется в фазе действий и не требует отдельной оплаты.',
    },
    shipCarpenter: {
      role: 'БОЙ',
      summary: 'Может предотвратить одну потерю уровня корабля при поражении.',
      hint: 'Применение отмечается при объявлении своей атаки; дополнительное действие списывается только если потеря уровня действительно предотвращена.',
    },
  };

  function characterUxInfo(character) {
    if (!character) return null;
    return CHARACTER_UX[character.id] || {
      role: 'ПЕРСОНАЖ',
      summary: character.name || 'Персонаж Адмиралтейства',
      hint: 'Способность применяется по действующим правилам персонажа.',
    };
  }

  function characterAvailabilityText(mine) {
    if (!mine?.character) {
      if ((mine?.characterAcquisitionOptions || []).length) return 'Можно получить персонажа Адмиралтейства.';
      if (mine?.admiraltyLevelHere) return 'Доступных персонажей этого уровня сейчас нет.';
      return 'Персонаж не нанят.';
    }
    if (isDecisionPending()) return 'Сначала завершите обязательное решение.';
    const myTurn = state.room?.activePlayerId === state.myId;
    if (!myTurn) return 'Способность будет доступна в подходящий момент вашего хода.';
    const id = mine.character.id;
    if (id === 'navigator') return mine.phase === 'navigation' && mine.roll !== null && (mine.actionsLeft ?? 0) > 0 ? 'Можно использовать сейчас.' : 'Доступен после броска навигации.';
    if (id === 'cartographer') return mine.phase === 'navigation' && mine.roll === null && (mine.actionsLeft ?? 0) > 0 ? 'Можно использовать сейчас.' : 'Доступен до броска навигации.';
    if (id === 'scout') return mine.phase === 'actions' && (mine.actionsLeft ?? 0) > 0 ? 'Можно использовать сейчас.' : 'Доступен в фазе действий.';
    if (id === 'treasureHunter') return mine.phase === 'actions' && (mine.actionsLeft ?? 0) > 0 ? 'Можно использовать сейчас.' : 'Доступен в фазе действий.';
    if (id === 'firstMate') return mine.phase === 'actions' ? 'Можно использовать сейчас.' : 'Доступен в фазе действий.';
    if (id === 'shipCarpenter') return 'Срабатывает через интерфейс объявления морского боя или штурма.';
    return 'Способность готова по правилам персонажа.';
  }

  function characterSheetHtml(mine) {
    if (!mine?.character) {
      return `
        <div class="character-empty">
          <span>ПЕРСОНАЖ НЕ НАНЯТ</span>
          <strong>${characterAvailabilityText(mine)}</strong>
          <small>Персонажи получаются через Адмиралтейство и остаются приватной информацией владельца.</small>
        </div>
      `;
    }
    const character = mine.character;
    const info = characterUxInfo(character);
    return `
      <div class="character-hero">
        <div class="character-emblem" aria-hidden="true">♟</div>
        <div class="character-hero-copy">
          <span>${escapeHtml(info.role)}</span>
          <strong>${escapeHtml(character.name)}</strong>
          <small>Адмиралтейство ${character.admiraltyLevel ?? '—'} ур.</small>
        </div>
      </div>
      <div class="character-description">${escapeHtml(info.summary)}</div>
      <div class="character-hint">${escapeHtml(info.hint)}</div>
      <div class="character-availability">${escapeHtml(characterAvailabilityText(mine))}</div>
    `;
  }

  function moveCanonicalCharacterActions(target) {
    const source = $('fleetActions');
    if (!source || !target) return;
    const children = Array.from(source.children);
    const start = children.findIndex(node => node.classList?.contains('action-group-label') && node.textContent === 'Персонаж Адмиралтейства');
    if (start < 0) return;
    for (let i = start + 1; i < children.length; i += 1) {
      const node = children[i];
      if (node.classList?.contains('action-group-label')) break;
      target.appendChild(node);
    }
  }

  function renderCharacterObjectSheet() {
    const mine = me();
    if (!mine || state.spectating) return;
    closeMapInfo();
    state.mapSelection = { kind: 'character', id: mine.character?.id || 'none' };
    $('objectSheetKind').textContent = mine.character ? 'ВАШ ПЕРСОНАЖ' : 'АДМИРАЛТЕЙСТВО';
    $('objectSheetTitle').textContent = mine.character?.name || 'Персонаж';
    $('objectSheetBody').innerHTML = characterSheetHtml(mine);

    // renderFleet remains the canonical owner of character legality and socket payloads.
    renderFleet();
    const actions = $('objectSheetActions');
    actions.innerHTML = '';
    moveCanonicalCharacterActions(actions);

    if (!actions.children.length) {
      const note = document.createElement('div');
      note.className = 'character-no-actions';
      note.textContent = 'Сейчас для персонажа нет доступных действий.';
      actions.appendChild(note);
    }

    $('objectSheet').classList.remove('hidden');
    $('objectSheet').classList.remove('expanded');
    document.body.classList.add('object-sheet-open');
  }

  function refreshOpenCharacterSheet() {
    if (state.mapSelection?.kind !== 'character' || !isMobileGameplayUi()) return;
    renderCharacterObjectSheet();
  }

  function isMobileGameplayUi() {
    return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 900px)').matches;
  }

  function scoutTargetOptions(mode) {
    const mine = me();
    if (!mine?.character || mine.character.id !== 'scout') return [];
    const range = Math.max(0, Number(mine.character.effect?.range) || 4);
    if (mode === 'scout-garrison') {
      const islandDistance = island => Math.min(...(island.cells || []).map(([row, col]) => Math.abs(Number(mine.row) - Number(row)) + Math.abs(Number(mine.col) - Number(col))));
      return (state.room?.islands || [])
        .filter(island => island.ownerId && island.ownerId !== state.myId)
        .map(island => ({ kind: 'island', id: island.id, name: island.name, data: island, distance: islandDistance(island) }))
        .filter(target => Number.isFinite(target.distance) && target.distance <= range)
        .sort((a, b) => a.distance - b.distance || String(a.name).localeCompare(String(b.name)));
    }
    if (mode === 'scout-money') {
      return (state.room?.players || [])
        .filter(player => player.id !== state.myId)
        .map(player => ({
          kind: 'player',
          id: player.id,
          name: player.name,
          data: player,
          distance: Math.abs(Number(mine.row) - Number(player.row)) + Math.abs(Number(mine.col) - Number(player.col)),
        }))
        .filter(target => Number.isFinite(target.distance) && target.distance <= range)
        .sort((a, b) => a.distance - b.distance || String(a.name).localeCompare(String(b.name)));
    }
    return [];
  }

  function targetingOptions(mode = state.targeting?.mode) {
    const mine = me();
    if (!mine || !mode) return [];
    if (mode === 'cartographer') {
      return (mine.cartographerAnchorOptions || []).map(option => ({
        kind: 'anchor',
        id: option.id || option.color,
        name: option.name,
        color: option.color,
        distance: option.distance,
        data: option,
      }));
    }
    return scoutTargetOptions(mode);
  }

  function canStartTargeting(mode) {
    const mine = me();
    if (!mine || state.spectating || isDecisionPending()) return false;
    const myTurn = state.room?.activePlayerId === state.myId;
    if (!myTurn) return false;
    if (mode === 'cartographer') {
      return mine.character?.id === 'cartographer'
        && mine.phase === 'navigation'
        && mine.roll === null
        && (mine.actionsLeft ?? 0) > 0
        && targetingOptions(mode).length > 0;
    }
    if (mode === 'scout-garrison' || mode === 'scout-money') {
      return mine.character?.id === 'scout'
        && mine.phase === 'actions'
        && (mine.actionsLeft ?? 0) > 0
        && targetingOptions(mode).length > 0;
    }
    return false;
  }

  function startTargeting(mode) {
    if (!canStartTargeting(mode)) return;
    closeMapInfo();
    state.targeting = { mode };
    closeMapInfo();
    render();
  }

  function cancelTargeting() {
    state.targeting = null;
    document.body.classList.remove('targeting-open');
    render();
  }

  function completeTargeting(target) {
    const mode = state.targeting?.mode;
    if (!mode || !target) return;
    if (mode === 'cartographer') {
      socket.emit('useCartographer', { color: target.color }, res => {
        handleGameAck(res);
        if (!res?.ok) return;
        state.targeting = null;
        if (res.card) {
          state.characterPeek = `${res.anchorName}: «${res.card.name}» · арт. ${res.card.artillery ?? '—'} · награда ${res.card.reward}`;
          enqueueResultCard({
            kicker: 'КАРТОГРАФ',
            title: `Верхняя карта: ${res.anchorName}`,
            body: `«${res.card.name}»`,
            details: [
              { label: 'Артиллерия', value: res.card.artillery ?? '—' },
              { label: 'Награда', value: res.card.reward ?? '—' },
            ],
          });
        }
      });
      return;
    }
    if (mode === 'scout-garrison') {
      socket.emit('useScout', { mode: 'garrison', islandId: target.id }, res => {
        handleGameAck(res);
        if (!res?.ok) return;
        state.targeting = null;
        enqueueToast(`Разведан гарнизон: ${target.name}. Откройте остров на карте.`, 'success');
      });
      return;
    }
    if (mode === 'scout-money') {
      socket.emit('useScout', { mode: 'money', targetPlayerId: target.id }, res => {
        handleGameAck(res);
        if (!res?.ok) return;
        state.targeting = null;
        enqueueToast(`Разведана казна: ${target.name}`, 'success');
      });
    }
  }

  function renderTargetingBar() {
    const bar = $('targetingBar');
    const mode = state.targeting?.mode;
    if (!bar || !mode || !canStartTargeting(mode)) {
      if (mode && !canStartTargeting(mode)) state.targeting = null;
      bar?.classList.add('hidden');
      document.body.classList.remove('targeting-open');
      return;
    }
    const options = targetingOptions(mode);
    const labels = {
      cartographer: ['КАРТОГРАФ', 'Выберите морской якорь', 'На карте показаны только доступные якоря.'],
      'scout-garrison': ['РАЗВЕДЧИК', 'Выберите чужой остров', `Доступные цели: ${options.length}`],
      'scout-money': ['РАЗВЕДЧИК', 'Выберите корабль игрока', `Доступные цели: ${options.length}`],
    };
    const copy = labels[mode] || ['ВЫБОР ЦЕЛИ', 'Выберите цель', ''];
    $('targetingKicker').textContent = copy[0];
    $('targetingTitle').textContent = copy[1];
    $('targetingDetail').textContent = copy[2];
    bar.classList.remove('hidden');
    document.body.classList.add('targeting-open');
  }

  function renderTargetingMapTargets(layer) {
    const mode = state.targeting?.mode;
    if (!mode || !canStartTargeting(mode)) return false;
    const options = targetingOptions(mode);
    for (const target of options) {
      if (target.kind === 'island') {
        for (const [row, col] of target.data.cells || []) {
          addMapCellButton(layer, row, col, 'targeting-hit targeting-island', `${target.name} · ${target.distance} кл.`, () => completeTargeting(target));
        }
      } else if (target.kind === 'player') {
        addMapMarker(layer, target.data.row, target.data.col, 'targeting-marker targeting-player', '◎', `${target.name} · ${target.distance} кл.`, () => completeTargeting(target));
      } else if (target.kind === 'anchor') {
        const anchors = (state.room?.anchorCells || []).filter(anchor => anchor.color === target.color || anchor.id === target.id);
        for (const anchor of anchors) {
          addMapMarker(layer, anchor.row, anchor.col, `targeting-marker targeting-anchor anchor-${anchor.color}`, '◎', `${target.name} · ${target.distance} кл.`, () => completeTargeting(target));
        }
      }
    }
    return true;
  }

  function renderFleet() {
    const mine = me();
    const content = $('fleetContent');
    const actions = $('fleetActions');
    const badge = $('shipLevelBadge');
    actions.innerHTML = '';
    if (!mine) {
      badge.textContent = 'ур. I';
      content.textContent = 'Корабль недоступен.';
      return;
    }

    badge.textContent = `ур. ${ROMAN[mine.level] || mine.level}`;
    const stats = mine.stats || {};
    const upgrades = mine.upgrades || [];
    const escorts = mine.escorts || [];
    const escortCatalog = state.room.escortCatalog || {};
    const upgradeNames = upgrades.length ? upgrades.map(u => `${u.name}${u.active ? '' : (u.missingRequirement ? ' (неактивно: нет первого улучшения)' : ' (неактивно из-за уровня)')}`).join(', ') : 'нет';
    const escortNames = escorts.length
      ? escorts.map(e => `${escortCatalog[e.type]?.name || e.type}${e.special && e.type !== 'landin' ? ' · особый' : ''}${e.active ? '' : (e.inactiveReason === 'level' ? ' (неактивен из-за уровня)' : ' (неактивен: нет места верфи)')}`).join(', ')
      : 'нет';
    const moveText = Number(stats.moveMod) >= 0 ? `+${stats.moveMod || 0}` : String(stats.moveMod);

    content.innerHTML = `<div class="fleet-grid">
        <span>Артиллерия</span><strong>${stats.artillery ?? '—'}</strong>
        <span>Войско</span><strong>${stats.army ?? '—'}</strong>
        <span>Основной трюм</span><strong>${stats.cargo ?? '—'}</strong>
        <span>Модификатор хода</span><strong>${moveText}</strong>
        <span>Артиллерия флотилии</span><strong>${mine.fleetArtillery ?? stats.artillery ?? '—'}</strong>
        <span>Места улучшений</span><strong>${upgrades.length}/${mine.upgradeSlots}</strong>
        <span>Места верфей</span><strong>${mine.shipyardSlots}</strong>
        <span>Лимит сопровождения</span><strong>${escorts.length}/${mine.escortUseLimit}</strong>
        <span>Поддержка бастионов</span><strong>${mine.supportedBastionIslandIds?.length || 0}/${mine.bastionSupportCapacity || 0}</strong>
        <span>Рота ландскнехтов</span><strong>${mine.landCompany ? `+${mine.landCompany.army} при штурме` : 'нет'}</strong>
        <span>Персонаж</span><strong>${escapeHtml(mine.character?.name || 'нет')}</strong>
      </div>
      <div class="building-line"><span class="muted">Улучшения:</span> ${escapeHtml(upgradeNames)}</div>
      <div class="building-line"><span class="muted">Сопровождение:</span> ${escapeHtml(escortNames)}</div>
      <div class="citadel-note">${mine.atCitadel ? 'Вы в Цитадели: доступны покупки флота, городской стражи и постоянных гарнизонов.' : 'Покупки уровней, улучшений, сопровождения и гарнизонов выполняются только в Цитадели.'}</div>`;

    const myTurn = state.room.started && state.room.activePlayerId === state.myId;
    const canAct = myTurn && mine.phase === 'actions' && (mine.actionsLeft ?? 0) > 0 && !isDecisionPending();
    const canBuyHere = canAct && mine.atCitadel;
    const myTurnAnyPhase = myTurn && ['navigation', 'actions'].includes(mine.phase) && !isDecisionPending();

    const characterCatalog = state.room.characterCatalog || {};
    const character = mine.character;
    const characterLabel = document.createElement('div');
    characterLabel.className = 'action-group-label';
    characterLabel.textContent = 'Персонаж Адмиралтейства';
    actions.appendChild(characterLabel);

    if (!character && (mine.characterAcquisitionOptions || []).length) {
      for (const option of mine.characterAcquisitionOptions) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'build-btn';
        button.textContent = `Взять «${option.name}» · 1 действие`;
        button.disabled = !canAct;
        button.addEventListener('click', () => socket.emit('takeCharacter', { characterId: option.id }, handleGameAck));
        actions.appendChild(button);
      }
    } else if (!character && mine.admiraltyLevelHere) {
      const note = document.createElement('div');
      note.className = 'cargo-meta'; note.textContent = 'Все персонажи, доступные этому уровню Адмиралтейства, сейчас находятся у других игроков.';
      actions.appendChild(note);
    } else if (character) {
      const effectNote = document.createElement('div');
      effectNote.className = 'cargo-meta';
      const deferred = {
        scout: 'Разведчик готов раскрыть один гарнизон или точные дукаты одного другого игрока в радиусе 4 до конца текущего личного хода.',
        treasureHunter: 'Искатель сокровищ тратит одно действие, сразу определяет два независимых результата сокровища и позволяет выбрать один из них.',
        shipCarpenter: 'Корабельный плотник может предотвратить одну потерю уровня в бою. При объявлении своей атаки заранее отметьте его применение; дополнительное действие списывается только если уровень действительно сохранён.',
      };
      effectNote.textContent = deferred[character.id] || `«${character.name}» готов к одноразовому применению.`;
      actions.appendChild(effectNote);

      if (character.id === 'navigator') {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'build-btn primary';
        b.textContent = 'Штурман: перебросить d6 · 1 действие';
        b.disabled = !(myTurn && mine.phase === 'navigation' && mine.roll !== null && (mine.actionsLeft ?? 0) > 0 && !isDecisionPending());
        b.addEventListener('click', () => socket.emit('useNavigator', {}, handleGameAck)); actions.appendChild(b);
      } else if (character.id === 'cartographer') {
        if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 900px)').matches) {
          const b = document.createElement('button'); b.type = 'button'; b.className = 'build-btn primary';
          b.textContent = 'Картограф: выбрать якорь на карте · 1 действие';
          b.disabled = !canStartTargeting('cartographer');
          b.addEventListener('click', () => startTargeting('cartographer'));
          actions.appendChild(b);
        } else {
          for (const option of mine.cartographerAnchorOptions || []) {
            const b = document.createElement('button'); b.type = 'button'; b.className = 'build-btn primary';
            b.textContent = `Картограф: посмотреть «${option.name}» · ${option.distance} кл. · 1 действие`;
            b.disabled = !(myTurn && mine.phase === 'navigation' && mine.roll === null && (mine.actionsLeft ?? 0) > 0 && !isDecisionPending());
            b.addEventListener('click', () => socket.emit('useCartographer', { color: option.color }, res => {
              if (res?.ok && res.card) {
                state.characterPeek = `${res.anchorName}: «${res.card.name}» · арт. ${res.card.artillery ?? '—'} · награда ${res.card.reward}`;
                enqueueResultCard({
                  kicker: 'КАРТОГРАФ',
                  title: `Верхняя карта: ${res.anchorName}`,
                  body: `«${res.card.name}»`,
                  details: [
                    { label: 'Артиллерия', value: res.card.artillery ?? '—' },
                    { label: 'Награда', value: res.card.reward ?? '—' },
                  ],
                });
              }
              handleGameAck(res); renderFleet();
            }));
            actions.appendChild(b);
          }
        }
        if (state.characterPeek) {
          const peek = document.createElement('div'); peek.className = 'event-effect'; peek.textContent = state.characterPeek; actions.appendChild(peek);
        }
      } else if (character.id === 'scout') {
        if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 900px)').matches) {
          const garrisonTargets = targetingOptions('scout-garrison');
          const moneyTargets = targetingOptions('scout-money');

          const garrison = document.createElement('button');
          garrison.type = 'button'; garrison.className = 'build-btn primary';
          garrison.textContent = `Разведчик: гарнизон на карте · ${garrisonTargets.length} цел.`;
          garrison.disabled = !canStartTargeting('scout-garrison');
          garrison.addEventListener('click', () => startTargeting('scout-garrison'));
          actions.appendChild(garrison);

          const money = document.createElement('button');
          money.type = 'button'; money.className = 'build-btn primary';
          money.textContent = `Разведчик: казна игрока на карте · ${moneyTargets.length} цел.`;
          money.disabled = !canStartTargeting('scout-money');
          money.addEventListener('click', () => startTargeting('scout-money'));
          actions.appendChild(money);
        } else {
          const range = Math.max(0, Number(character.effect?.range) || 4);
          const islandDistance = island => Math.min(...(island.cells || []).map(([row, col]) => Math.abs(Number(mine.row) - Number(row)) + Math.abs(Number(mine.col) - Number(col))));
          const garrisonTargets = (state.room.islands || [])
            .filter(island => island.ownerId && island.ownerId !== state.myId)
            .map(island => ({ island, distance: islandDistance(island) }))
            .filter(item => Number.isFinite(item.distance) && item.distance <= range)
            .sort((a, b) => a.distance - b.distance || String(a.island.name).localeCompare(String(b.island.name)));
          const moneyTargets = (state.room.players || [])
            .filter(player => player.id !== state.myId)
            .map(player => ({ player, distance: Math.abs(Number(mine.row) - Number(player.row)) + Math.abs(Number(mine.col) - Number(player.col)) }))
            .filter(item => Number.isFinite(item.distance) && item.distance <= range)
            .sort((a, b) => a.distance - b.distance || String(a.player.name).localeCompare(String(b.player.name)));

          const garrisonLabel = document.createElement('div');
          garrisonLabel.className = 'cargo-meta';
          garrisonLabel.textContent = 'Разведка гарнизона';
          actions.appendChild(garrisonLabel);
          for (const { island, distance } of garrisonTargets) {
            const b = document.createElement('button'); b.type = 'button'; b.className = 'build-btn primary';
            b.textContent = `Гарнизон: ${island.name} · ${distance} кл. · 1 действие`;
            b.disabled = !canAct;
            b.addEventListener('click', () => socket.emit('useScout', { mode: 'garrison', islandId: island.id }, res => {
              handleGameAck(res);
              if (res?.ok) enqueueToast(`Разведан гарнизон: ${island.name}. Откройте остров на карте.`, 'success');
            }));
            actions.appendChild(b);
          }
          if (!garrisonTargets.length) {
            const note = document.createElement('div'); note.className = 'cargo-meta'; note.textContent = 'Чужих островов в радиусе разведки нет.'; actions.appendChild(note);
          }

          const moneyLabel = document.createElement('div');
          moneyLabel.className = 'cargo-meta';
          moneyLabel.textContent = 'Разведка денег';
          actions.appendChild(moneyLabel);
          for (const { player, distance } of moneyTargets) {
            const b = document.createElement('button'); b.type = 'button'; b.className = 'build-btn primary';
            b.textContent = `Деньги: ${player.name} · ${distance} кл. · 1 действие`;
            b.disabled = !canAct;
            b.addEventListener('click', () => socket.emit('useScout', { mode: 'money', targetPlayerId: player.id }, res => {
              handleGameAck(res);
              if (res?.ok) enqueueToast(`Разведана казна: ${player.name}`, 'success');
            }));
            actions.appendChild(b);
          }
          if (!moneyTargets.length) {
            const note = document.createElement('div'); note.className = 'cargo-meta'; note.textContent = 'Других кораблей в радиусе разведки нет.'; actions.appendChild(note);
          }
        }
      } else if (character.id === 'treasureHunter') {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'build-btn primary';
        b.textContent = 'Искатель сокровищ: выбрать 1 из 2 · 1 действие';
        b.disabled = !canAct;
        b.addEventListener('click', () => socket.emit('useTreasureHunter', {}, handleGameAck));
        actions.appendChild(b);
      } else if (character.id === 'firstMate') {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'build-btn primary';
        b.textContent = 'Первый помощник: +1 дополнительное действие · бесплатно';
        b.disabled = !(myTurn && mine.phase === 'actions' && !isDecisionPending());
        b.addEventListener('click', () => socket.emit('useFirstMate', {}, handleGameAck)); actions.appendChild(b);
      }

      if ((mine.characterReplacementOptions || []).length) {
        const replaceLabel = document.createElement('div');
        replaceLabel.className = 'cargo-meta';
        replaceLabel.textContent = 'Неиспользованного персонажа можно заменить здесь один раз за раунд:';
        actions.appendChild(replaceLabel);
        for (const option of mine.characterReplacementOptions) {
          const b = document.createElement('button'); b.type = 'button'; b.className = 'build-btn';
          b.textContent = `Заменить на «${option.name}» · 1 действие`;
          b.disabled = !canAct;
          b.addEventListener('click', () => socket.emit('replaceCharacter', { characterId: option.id }, handleGameAck));
          actions.appendChild(b);
        }
      }
    }

    if (mine.landCompany) {
      const companyLabel = document.createElement('div');
      companyLabel.className = 'action-group-label';
      companyLabel.textContent = 'Рота ландскнехтов';
      actions.appendChild(companyLabel);
      const dismiss = document.createElement('button');
      dismiss.type = 'button';
      dismiss.className = 'build-btn danger-soft';
      dismiss.textContent = `Вернуть роту +${mine.landCompany.army} у своего Арсенала · бесплатно`;
      dismiss.disabled = !myTurnAnyPhase || !mine.canDismissLandCompanyHere;
      dismiss.title = mine.canDismissLandCompanyHere ? '' : 'Нужно находиться у своего острова с Арсеналом.';
      dismiss.addEventListener('click', () => socket.emit('dismissLandCompany', {}, handleGameAck));
      actions.appendChild(dismiss);
    }

    if (!mine.atCitadel) {
      const locked = document.createElement('div');
      locked.className = 'citadel-shop-locked';
      locked.innerHTML = '<strong>Магазин Цитадели недоступен</strong><span>Приплывите в Цитадель, чтобы повышать уровень корабля, устанавливать или снимать улучшения, покупать сопровождение и гарнизоны.</span>';
      actions.appendChild(locked);
      return;
    }

    const levelLabel = document.createElement('div');
    levelLabel.className = 'action-group-label';
    levelLabel.textContent = 'Уровень основного корабля';
    actions.appendChild(levelLabel);
    const levelBtn = document.createElement('button');
    levelBtn.type = 'button';
    levelBtn.className = 'build-btn';
    if (mine.nextLevel) {
      levelBtn.textContent = `Повысить до ${ROMAN[mine.nextLevel.level] || mine.nextLevel.level} · ${mine.nextLevel.price} дук.`;
      levelBtn.disabled = !canBuyHere || mine.ducats < mine.nextLevel.price;
      levelBtn.addEventListener('click', () => emitDataAction(levelBtn, 'buyShipLevel', {}));
    } else {
      levelBtn.textContent = `Достигнут ${ROMAN[state.room.balanceCatalog.maxShipLevel]} уровень`;
      levelBtn.disabled = true;
    }
    actions.appendChild(levelBtn);

    const upLabel = document.createElement('div');
    upLabel.className = 'action-group-label';
    upLabel.textContent = 'Улучшения';
    actions.appendChild(upLabel);
    const installedIds = new Set(upgrades.map(u => u.id));
    const upgradeCatalog = state.room.shipUpgradeCatalog || {};
    const ordered = Object.keys(upgradeCatalog);
    for (const id of ordered) {
      const u = upgradeCatalog[id];
      if (!u || installedIds.has(id)) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'build-btn';
      const passabilityLabel = { shoal: 'мели', reef: 'рифы', ice: 'льды', land1: '1 клетка суши' }[u.passability] || '';
      const bonus = [u.artillery ? `арт. +${u.artillery}` : '', u.army ? `войско +${u.army}` : '', u.cargo ? `трюм +${u.cargo}` : '', u.movement ? `ход +${u.movement}` : '', passabilityLabel ? `проход: ${passabilityLabel}` : ''].filter(Boolean).join(', ');
      b.textContent = `${u.name} · ${u.price} дук.${bonus ? ` · ${bonus}` : ''}`;
      const dependencyOk = !u.requires || installedIds.has(u.requires);
      const slotOk = upgrades.length < mine.upgradeSlots;
      const redundantPassability = Boolean(u.passability && state.room.shipCatalog?.[mine.shipClass]?.passability === u.passability);
      b.disabled = !canBuyHere || mine.ducats < u.price || !dependencyOk || !slotOk || redundantPassability;
      b.addEventListener('click', () => emitDataAction(b, 'buyShipUpgrade', { upgradeId: id }));
      actions.appendChild(b);
    }

    for (const u of upgrades) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'build-btn danger-soft';
      b.textContent = `Снять «${u.name}»`;
      b.disabled = !canBuyHere;
      b.addEventListener('click', () => socket.emit('removeShipUpgrade', { upgradeId: u.id }, handleGameAck));
      actions.appendChild(b);
    }

    const escortLabel = document.createElement('div');
    escortLabel.className = 'action-group-label';
    escortLabel.textContent = 'Сопровождение';
    actions.appendChild(escortLabel);
    const price = mine.nextEscortPrice;
    const ordinaryCount = escorts.filter(e => !e.special).length;
    const escortRoom = ordinaryCount < mine.shipyardSlots && escorts.length < mine.escortUseLimit && escorts.length < state.room.balanceCatalog.maxEscorts;
    for (const type of ['cargo', 'combat']) {
      const e = escortCatalog[type];
      if (!e) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'build-btn escort-btn';
      const spec = type === 'cargo' ? `трюм ${e.cargo}` : `арт. ${e.artillery}`;
      b.textContent = price == null ? `${e.name} · лимит` : `${e.name} · ${price} дук. · ${spec}`;
      b.disabled = !canBuyHere || price == null || mine.ducats < price || !escortRoom;
      b.addEventListener('click', () => emitDataAction(b, 'buyEscort', { escortType: type }));
      actions.appendChild(b);
    }

    const ownedSettlements = (state.room.islands || []).filter(i => i.ownerId === state.myId);
    const guardTargets = ownedSettlements.filter(i => i.status === 'Город' && !i.garrisonType);
    const permanentTargets = ownedSettlements.filter(i => i.status === 'Крупный порт' && i.garrisonType !== 'permanent');
    if (guardTargets.length || permanentTargets.length) {
      const defenseLabel = document.createElement('div');
      defenseLabel.className = 'action-group-label';
      defenseLabel.textContent = 'Оборона владений · только в Цитадели';
      actions.appendChild(defenseLabel);
      for (const island of guardTargets) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'build-btn';
        b.textContent = `Городская стража → ${island.name} · ${state.room.balanceCatalog.garrisons.guard.price} дук. · +${state.room.balanceCatalog.garrisons.guard.defense} защиты`;
        b.disabled = !canBuyHere || mine.ducats < state.room.balanceCatalog.garrisons.guard.price;
        b.addEventListener('click', () => emitDataAction(b, 'buyCityGuard', { islandId: island.id }));
        actions.appendChild(b);
      }
      for (const island of permanentTargets) {
        const upgrading = island.garrisonType === 'guard';
        const spec = upgrading ? state.room.balanceCatalog.garrisons.permanentUpgrade : state.room.balanceCatalog.garrisons.permanentDirect;
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'build-btn';
        b.textContent = `${upgrading ? 'Постоянный гарнизон вместо стражи' : 'Постоянный гарнизон напрямую'} → ${island.name} · ${spec.price} дук. · +${spec.defense} защиты`;
        b.disabled = !canBuyHere || mine.ducats < spec.price;
        b.addEventListener('click', () => emitDataAction(b, 'buyPermanentGarrison', { islandId: island.id }));
        actions.appendChild(b);
      }
    }
  }

  function renderTrade() {
    const mine = me();
    const content = $('cargoContent');
    const badge = $('cargoBadge');
    const sell = $('sellCargoBtn');
    const escortActions = $('escortCargoActions');
    escortActions.innerHTML = '';
    if (!mine) {
      badge.textContent = '0/0';
      content.textContent = 'Трюм недоступен.';
      sell.disabled = true;
      return;
    }

    const escortCatalog = state.room.escortCatalog || {};
    const cargoEscorts = (mine.escorts || []).filter(e => (escortCatalog[e.type]?.cargo || 0) > 0);
    const totalQty = (mine.cargo?.quantity || 0) + cargoEscorts.reduce((sum, e) => sum + (e.cargo?.quantity || 0), 0);
    badge.textContent = mine.landCompany ? `рота · груз ${totalQty}` : `${totalQty}/${mine.totalCargoCapacity || mine.cargoCapacity || 0}`;
    const myTurn = state.room.started && state.room.activePlayerId === state.myId;
    const canAct = myTurn && mine.phase === 'actions' && (mine.actionsLeft ?? 0) > 0 && !isDecisionPending();
    const goods = state.room.goodsCatalog || {};

    const mainGood = mine.cargo ? goods[mine.cargo.goodId] : null;
    const mainText = mine.landCompany
      ? `<div class="cargo-name">Основной трюм: рота ландскнехтов</div><div class="cargo-meta">+${mine.landCompany.army} войска только при штурме. Обычный груз в основной трюм недоступен.</div>`
      : (mine.cargo
        ? `<div class="cargo-name">Основной трюм: ${escapeHtml(mainGood?.name || mine.cargo.goodId)} × ${mine.cargo.quantity}</div><div class="cargo-meta">Выручка: ${mine.cargo.value} дукатов.</div>`
        : `<div class="cargo-name">Основной трюм: пуст</div><div class="cargo-meta">Вместимость ${mine.cargoCapacity}. Погрузка на своём острове расходует одно действие.</div>`);
    const escortText = cargoEscorts.length
      ? cargoEscorts.map((e, idx) => {
          const g = e.cargo ? goods[e.cargo.goodId] : null;
          const def = escortCatalog[e.type] || {};
          return `<div class="cargo-hold"><strong>${escapeHtml(def.name || `Сопровождение ${idx + 1}`)}${e.active ? '' : ' · неактивно'}</strong><div class="cargo-meta">${e.cargo ? `${escapeHtml(g?.name || e.cargo.goodId)} × ${e.cargo.quantity} · выручка ${e.cargo.value}` : `трюм пуст · вместимость ${def.cargo || 0}`}</div></div>`;
        }).join('')
      : '<div class="cargo-meta">Сопровождения с грузовым трюмом нет.</div>';
    content.innerHTML = `${mainText}${escortText}<div class="cargo-meta">${mine.atCitadel ? 'Флотилия находится в Цитадели.' : 'Для продажи доставьте флотилию в Цитадель.'}</div>`;

    sell.classList.toggle('hidden', !mine.atCitadel);
    sell.disabled = !mine.cargo || !canAct || !mine.atCitadel;
    sell.textContent = mine.cargo && mine.atCitadel ? `Продать основной груз за ${mine.cargo.value} дукатов` : 'Продать основной груз в Цитадели';

    if (!mine.atCitadel) return;

    for (const e of cargoEscorts) {
      if (!e.cargo) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'trade-button';
      b.textContent = `Продать груз «${escortCatalog[e.type]?.name || 'сопровождения'}» за ${e.cargo.value} дукатов`;
      b.disabled = !canAct || !mine.atCitadel || !e.active;
      b.addEventListener('click', () => socket.emit('sellCargo', { holdId: e.id }, res => handleSoundAck(res, 'coins')));
      escortActions.appendChild(b);
    }
  }


  function renderAnchors() {
    const mine = me();
    const content = $('anchorContent');
    const actions = $('anchorActions');
    const badge = $('anchorBadge');
    actions.innerHTML = '';
    if (!mine) {
      badge.textContent = '—';
      content.textContent = 'Данные якорей недоступны.';
      return;
    }

    const cells = state.room.anchorCells || [];
    const here = cells.find(a => a.row === mine.row && a.col === mine.col) || null;
    const visitedHere = here && (mine.visitedAnchors || []).includes(`${mine.row},${mine.col}`);
    const encounter = here
      && Number(mine.lastAnchorEncounter?.round) === Number(state.room.round)
      && Number(mine.lastAnchorEncounter?.row) === Number(mine.row)
      && Number(mine.lastAnchorEncounter?.col) === Number(mine.col)
      ? mine.lastAnchorEncounter
      : null;
    const decks = state.room.anchorDecks || {};
    const deckLine = ['blue','yellow','red'].map(color => {
      const label = color === 'blue' ? 'Синяя' : color === 'yellow' ? 'Жёлтая' : 'Красная';
      const d = decks[color] || { remaining: 0, discard: 0 };
      return `${label}: ${d.remaining} в колоде / ${d.discard} в сбросе`;
    }).join(' · ');

    badge.textContent = here ? (visitedHere ? 'разыгран' : 'якорь') : 'море';
    let html = `<div class="anchor-decks">${escapeHtml(deckLine)}</div>`;
    if (here) {
      html += `<div class="anchor-note"><strong>${escapeHtml(here.name)}</strong> · победа даёт ${here.fleetPoints || 0} очк. флота. ${visitedHere ? 'Эта клетка уже дала вам карту в текущем раунде.' : 'Бой добровольный: объявите его в свою фазу действий. Союзник не участвует.'}</div>`;
    } else {
      html += '<div class="anchor-note">Карту не открывают при прохождении или самой остановке. На клетке якоря можно добровольно объявить бой в свою фазу действий.</div>';
    }

    if (encounter) {
      const outcome = encounter.outcome === 'win' ? 'Победа' : encounter.outcome === 'loss' ? 'Поражение' : encounter.outcome === 'tie' ? 'Ничья' : 'На море тихо';
      const enemy = encounter.cardArtillery == null ? '—' : encounter.cardArtillery;
      let effect = '';
      if (encounter.outcome === 'win') {
        const gross = encounter.reward?.gross ?? encounter.rewardValue ?? 0;
        const paid = encounter.reward?.debtPaid || 0;
        effect = `Награда ${gross} дукатов${paid ? `; ${paid} ушло в долг` : ''}. Очки флота +${encounter.fleetPoints || 0}.`;
      } else if (encounter.outcome === 'loss') {
        const p = encounter.penalty || {};
        effect = `Штраф ${p.required || 0}: уплачено ${p.paid || 0}${p.addedDebt ? `, долг +${p.addedDebt}` : ''}.`;
      } else if (encounter.outcome === 'tie') {
        effect = 'Награды и иных последствий нет.';
      } else {
        effect = 'Действие не расходуется.';
      }
      html += `<div class="anchor-result"><strong>Последнее столкновение:</strong><br>${escapeHtml(encounter.anchorName)} · «${escapeHtml(encounter.cardName)}» · артиллерия ${enemy}<br>Флотилия ${encounter.fleetPower} · ${outcome}. ${escapeHtml(effect)}</div>`;
    }
    content.innerHTML = html;

    if (here && !visitedHere) {
      const myTurn = state.room.activePlayerId === state.myId;
      const canFight = myTurn && mine.phase === 'actions' && (mine.actionsLeft ?? 0) > 0 && !isDecisionPending();
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'danger-soft';
      button.textContent = 'Вступить в бой · 1 действие';
      button.title = 'Если открыта карта «На море тихо», действие не расходуется.';
      button.disabled = !canFight;
      button.addEventListener('click', () => socket.emit('fightAnchor', {}, handleAnchorResultAck));
      actions.appendChild(button);
    }
  }

  function renderIsland() {
    const box = $('islandContent');
    const actions = $('islandActions');
    const badge = $('islandAreaBadge');
    actions.innerHTML = '';
    badge.classList.add('hidden');

    const here = currentIslands();
    if (!here.length) {
      state.selectedIslandId = null;
      const mine = me();
      if (mine?.atCitadel) {
        box.innerHTML = '<div class="island-name">Цитадель</div><span class="muted">Здесь продают доставленные товары и покупают уровни, улучшения основного корабля и суда сопровождения. Используйте панель «Корабль и флотилия».</span>';
      } else {
        box.innerHTML = '<span class="muted">Открытое море. Для действий с островом остановитесь на его береговой клетке.</span>';
      }
      return;
    }

    if (!here.some(i => i.id === state.selectedIslandId)) state.selectedIslandId = here[0].id;
    const island = here.find(i => i.id === state.selectedIslandId) || here[0];
    const mine = me();
    const myTurn = state.room.started && state.room.activePlayerId === state.myId;
    const canAct = myTurn && mine?.phase === 'actions' && (mine.actionsLeft ?? 0) > 0 && !isDecisionPending();

    badge.textContent = `${island.usedArea}/${island.effectiveArea}`;
    badge.classList.remove('hidden');

    const switcher = here.length > 1
      ? `<div class="island-switcher">${here.map(i => `<button type="button" class="small island-choice${i.id === island.id ? ' selected' : ''}" data-island-choice="${escapeAttr(i.id)}">${escapeHtml(i.name)}</button>`).join('')}</div>`
      : '';
    const resources = island.resources.length ? island.resources.join(', ') : 'нет специальных ресурсов';
    const buildings = island.buildings.length ? island.buildings.map(b => b.type === 'bastion' ? `${b.name}${b.supported ? ' (поддерживается)' : ' (без поддержки)'}` : b.name).join(', ') : 'нет';
    const hasPrivateDefense = Object.hasOwn(island, 'defenseArmy') && Object.hasOwn(island, 'defenseBreakdown');
    const defense = hasPrivateDefense ? (Number(island.defenseArmy) || 0) : null;
    const defenseParts = hasPrivateDefense ? (island.defenseBreakdown || {}) : {};
    const defenseRows = hasPrivateDefense
      ? `<span>Текущая защита</span><strong>${defense}</strong>
        <span>Исходный / нанятый / укрепления / бастион / корабль</span><strong>${defenseParts.garrison || 0} / ${defenseParts.hiredGarrison || 0} / ${defenseParts.fortifications || 0} / ${defenseParts.bastions || 0} / ${defenseParts.ownerShip || 0}</strong>`
      : '';
    const hasPrivateGarrison = Object.hasOwn(island, 'garrisonType') || Object.hasOwn(island, 'garrisonName') || Object.hasOwn(island, 'garrisonDefense');
    const garrisonLine = hasPrivateGarrison
      ? `<div class="building-line"><span class="muted">Городской отряд:</span> ${escapeHtml(island.garrisonName ? `${island.garrisonName} (+${island.garrisonDefense || 0})` : 'нет')}</div>`
      : '';

    box.innerHTML = `${switcher}<div class="island-name">${escapeHtml(island.name)}</div>
      <div class="island-grid">
        <span>Владелец</span><strong>${escapeHtml(islandOwnerLabel(island))}</strong>
        <span>Статус</span><strong>${escapeHtml(island.status)}</strong>
        <span>Площадь</span><strong>${island.usedArea}/${island.effectiveArea}</strong>
        <span>Ресурсы</span><strong>${escapeHtml(resources)}</strong>
        <span>Исходное войско</span><strong>${island.army}</strong>
        ${defenseRows}
      </div>
      ${garrisonLine}
      <div class="building-line"><span class="muted">Постройки:</span> ${escapeHtml(buildings)}</div>
      <div class="building-line"><span class="muted">Погрузка в раунде ${state.room.round}:</span> ${island.loadedRound === state.room.round ? 'уже выполнена' : 'доступна'}</div>
      ${island.reward ? `<div class="reward-note"><span class="muted">Разовая награда:</span> ${escapeHtml(island.reward)}</div>` : ''}`;

    box.querySelectorAll('[data-island-choice]').forEach(btn => btn.addEventListener('click', () => {
      state.selectedIslandId = btn.dataset.islandChoice;
      renderIsland();
      renderMap();
      updateContextualActionPanels();
    }));

    if (!island.ownerId || island.ownerId !== state.myId) return;

    const goods = state.room.goodsCatalog || {};
    const loadedThisRound = island.loadedRound === state.room.round;
    const holdOptions = [{ id: 'main', name: mine?.landCompany ? 'основной трюм (занят ротой)' : 'основной трюм', capacity: mine?.cargoCapacity || 0, occupied: Boolean(mine?.cargo || mine?.landCompany) }];
    const escortCatalog = state.room.escortCatalog || {};
    for (const e of (mine?.escorts || []).filter(e => e.active && (escortCatalog[e.type]?.cargo || 0) > 0)) {
      const def = escortCatalog[e.type];
      holdOptions.push({ id: e.id, name: (def?.name || 'сопровождение').toLowerCase(), capacity: def?.cargo || 0, occupied: Boolean(e.cargo) });
    }

    if ((island.availableGoods || []).length) {
      const label = document.createElement('div');
      label.className = 'action-group-label';
      label.textContent = 'Погрузка';
      actions.appendChild(label);
      for (const goodId of island.availableGoods) {
        const good = goods[goodId];
        if (!good) continue;
        for (const hold of holdOptions) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'build-btn cargo-btn';
          button.textContent = `Погрузить ${good.name} × ${hold.capacity} → ${hold.name}`;
          button.disabled = !canAct || hold.occupied || loadedThisRound;
          button.addEventListener('click', () => {
            setError('gameError');
            socket.emit('loadCargo', { islandId: island.id, goodId, holdId: hold.id }, res => handleSoundAck(res, 'cargo'));
          });
          actions.appendChild(button);
        }
      }
    }

    const bastion = island.buildings.find(b => b.type === 'bastion');
    const fortressThrees = island.buildings.filter(b => b.type === 'fortress' && Number(b.level) === 3);
    const arsenal = island.buildings.filter(b => b.type === 'arsenal').sort((a, b) => b.level - a.level)[0];
    if (arsenal || bastion || fortressThrees.length) {
      const militaryLabel = document.createElement('div');
      militaryLabel.className = 'action-group-label';
      militaryLabel.textContent = 'Военная инфраструктура';
      actions.appendChild(militaryLabel);
      if (arsenal) {
        const companyBtn = document.createElement('button');
        companyBtn.type = 'button'; companyBtn.className = 'build-btn';
        const cargoWarning = mine?.cargo ? ' · текущий груз будет сброшен' : '';
        companyBtn.textContent = mine?.landCompany ? `Рота уже снаряжена · +${mine.landCompany.army}` : `Снарядить роту · Арсенал ${ROMAN[arsenal.level] || arsenal.level} · +${r.balanceCatalog.landCompany.armyByArsenalLevel[arsenal.level]} войска${cargoWarning}`;
        companyBtn.disabled = !canAct || Boolean(mine?.landCompany);
        companyBtn.addEventListener('click', () => socket.emit('formLandCompany', { islandId: island.id }, handleGameAck));
        actions.appendChild(companyBtn);
      }
      if (!bastion) {
        for (const fortress of fortressThrees) {
          const bastionBtn = document.createElement('button');
          bastionBtn.type = 'button'; bastionBtn.className = 'build-btn';
          bastionBtn.textContent = `Крепость III → Бастион · ${state.room.balanceCatalog.bastion.price} дук. · +${state.room.balanceCatalog.bastion.defense} защиты`;
          bastionBtn.disabled = !canAct || mine.ducats < state.room.balanceCatalog.bastion.price || (mine.bastionCount || 0) >= (mine.bastionSupportCapacity || 0);
          bastionBtn.addEventListener('click', () => emitDataAction(bastionBtn, 'buildBastion', { islandId: island.id, buildingIndex: fortress.index }));
          actions.appendChild(bastionBtn);
        }
      }
    }

    const palace = island.buildings.find(b => b.type === 'palace');
    if (palace && (mine?.enemyFactionIds || []).length) {
      const palaceLabel = document.createElement('div');
      palaceLabel.className = 'action-group-label';
      palaceLabel.textContent = 'Дворец';
      actions.appendChild(palaceLabel);
      for (const factionId of mine.enemyFactionIds || []) {
        const faction = (r.factions || []).find(f => f.id === factionId && f.exists);
        if (!faction) continue;
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'build-btn';
        button.textContent = mine.palaceUsed ? 'Дворец уже использован в этой партии' : `Прекратить вражду: ${faction.name} · 1 действие`;
        button.disabled = !canAct || Boolean(mine.palaceUsed);
        button.addEventListener('click', () => socket.emit('usePalace', { islandId: island.id, factionId }, handleGameAck));
        actions.appendChild(button);
      }
    }

    const catalog = state.room.buildingCatalog || {};
    const buildLabel = document.createElement('div');
    buildLabel.className = 'action-group-label';
    buildLabel.textContent = 'Строительство';
    actions.appendChild(buildLabel);
    const ordered = ['farm', 'lumbermill', 'quarry', 'mine', 'fort', 'market', 'exotic', 'slaves', 'gold', 'diamonds', 'lighthouse', 'observatory', 'embassy', 'palace', 'cartography', 'admiralty'];
    for (const id of ordered) {
      const def = catalog[id];
      if (!def) continue;
      if (def.resource && !island.resources.includes(def.resource)) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'build-btn';
      button.textContent = `${def.name} · ${def.price} дук.`;
      button.disabled = !canAct || mine.ducats < def.price;
      button.addEventListener('click', () => {
        setError('gameError');
        socket.emit('build', { islandId: island.id, buildingType: id }, res => handleSoundAck(res, 'construction'));
      });
      actions.appendChild(button);
    }

    const upgradeable = island.buildings.filter(b => b.nextUpgrade);
    if (upgradeable.length) {
      const upLabel = document.createElement('div');
      upLabel.className = 'action-group-label';
      upLabel.textContent = 'Улучшение построек';
      actions.appendChild(upLabel);
      for (const b of upgradeable) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'build-btn upgrade-building-btn';
        button.textContent = `${b.name} → ${b.nextUpgrade.name} · ${b.nextUpgrade.price} дук.`;
        button.disabled = !canAct || mine.ducats < b.nextUpgrade.price;
        button.addEventListener('click', () => {
          setError('gameError');
          socket.emit('upgradeBuilding', { islandId: island.id, buildingIndex: b.index }, res => handleSoundAck(res, 'construction'));
        });
        actions.appendChild(button);
      }
    }
  }

  function renderAlliances() {
    const content = $('allianceContent');
    const actions = $('allianceActions');
    const badge = $('allianceBadge');
    actions.innerHTML = '';
    const r = state.room;
    const mine = me();
    if (!r?.started || !mine) {
      badge.textContent = '0';
      content.textContent = 'Союзы доступны после начала партии.';
      return;
    }

    const allies = (mine.allyIds || []).map(id => r.players.find(p => p.id === id)).filter(Boolean);
    badge.textContent = String(allies.length);
    const pending = r.pendingAlliance;
    const lines = [];
    if (allies.length) lines.push(`Союзники: ${allies.map(p => p.name).join(', ')}.`);
    else lines.push('Действующих союзов нет.');

    if (pending) {
      const from = playerName(pending.fromId);
      const to = playerName(pending.toId);
      if (pending.viewerRole === 'recipient') lines.push(`${from} предлагает вам союз.`);
      else lines.push(`Предложение союза для ${to} ожидает ответа.`);
    }
    content.innerHTML = lines.map(line => `<div class="alliance-note">${escapeHtml(line)}</div>`).join('');

    if (pending) {
      if (pending.viewerRole === 'recipient') {
        const yes = document.createElement('button');
        yes.type = 'button';
        yes.className = 'primary';
        yes.textContent = 'Принять союз';
        yes.addEventListener('click', () => socket.emit('respondAlliance', { requestId: pending.id, accept: true }, handleGameAck));
        const no = document.createElement('button');
        no.type = 'button';
        no.className = 'danger-soft';
        no.textContent = 'Отклонить';
        no.addEventListener('click', () => socket.emit('respondAlliance', { requestId: pending.id, accept: false }, handleGameAck));
        actions.appendChild(yes); actions.appendChild(no);
      } else if (pending.viewerRole === 'sender') {
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'danger-soft';
        cancel.textContent = 'Отменить предложение';
        cancel.addEventListener('click', () => socket.emit('cancelAllianceRequest', { requestId: pending.id }, handleGameAck));
        actions.appendChild(cancel);
      }
      return;
    }

    const myTurn = r.activePlayerId === state.myId;
    const canPropose = myTurn && mine.phase === 'actions' && (mine.actionsLeft ?? 0) > 0 && !r.pendingBattle;
    const sameCellPlayers = allies.length ? [] : r.players.filter(p => p.id !== state.myId && p.row === mine.row && p.col === mine.col && !areAlliesClient(state.myId, p.id) && !(p.allyIds || []).length);
    if (sameCellPlayers.length) {
      const label = document.createElement('div');
      label.className = 'action-group-label';
      label.textContent = 'Заключить союз';
      actions.appendChild(label);
      for (const p of sameCellPlayers) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = `Предложить союз · ${p.name}`;
        b.disabled = !canPropose || !p.connected;
        b.addEventListener('click', () => socket.emit('requestAlliance', { targetPlayerId: p.id }, handleGameAck));
        actions.appendChild(b);
      }
    }

    if (allies.length) {
      const label = document.createElement('div');
      label.className = 'action-group-label';
      label.textContent = 'Разорвать в начале хода';
      actions.appendChild(label);
      const canBreak = myTurn && mine.phase === 'navigation' && mine.roll === null && !r.pendingBattle;
      for (const ally of allies) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'danger-soft';
        b.textContent = `Разорвать союз · ${ally.name}`;
        b.disabled = !canBreak;
        b.addEventListener('click', () => socket.emit('breakAlliance', { targetPlayerId: ally.id }, handleGameAck));
        actions.appendChild(b);
      }
    }
  }

  function renderCombat() {
    const content = $('combatContent');
    const actions = $('combatActions');
    const badge = $('combatBadge');
    actions.innerHTML = '';
    const r = state.room;
    const mine = me();
    if (!r?.started || !mine) {
      badge.textContent = 'мир';
      content.textContent = 'Бои доступны после начала партии.';
      return;
    }

    const pending = r.pendingBattle;
    if (r.pendingLegendaryReaction) {
      badge.textContent = 'реакция';
      content.innerHTML = '<div class="combat-note">Атака объявлена. Ожидается решение по «Покрову моря».</div>';
      return;
    }
    if (pending) {
      badge.textContent = 'ожидание';
      const attacker = playerName(pending.attackerId);
      const target = pending.kind === 'sea' ? playerName(pending.targetPlayerId) : (r.islands.find(i => i.id === pending.islandId)?.name || 'остров');
      const title = pending.kind === 'sea' ? `${attacker} атакует ${target}` : `${attacker} штурмует ${target}`;
      const statuses = pending.invites.map(inv => `${playerName(inv.playerId)} — ${inv.side === 'attacker' ? 'атака' : 'защита'}: ${inv.status === 'pending' ? 'ожидается ответ' : inv.status === 'joined' ? 'участвует' : 'не участвует'}`);
      content.innerHTML = `<div class="combat-note"><strong>${escapeHtml(title)}</strong></div>${statuses.map(x => `<div class="combat-note">${escapeHtml(x)}</div>`).join('')}`;
      if (pending.viewerInvite) {
        const yes = document.createElement('button');
        yes.type = 'button';
        yes.className = 'primary';
        yes.textContent = 'Участвовать в бою';
        yes.addEventListener('click', () => socket.emit('respondBattle', { battleId: pending.id, participate: true }, handleGameAck));
        const no = document.createElement('button');
        no.type = 'button';
        no.className = 'danger-soft';
        no.textContent = 'Не участвовать';
        no.addEventListener('click', () => socket.emit('respondBattle', { battleId: pending.id, participate: false }, handleGameAck));
        actions.appendChild(yes); actions.appendChild(no);
      }
      return;
    }

    const myTurn = r.activePlayerId === state.myId;
    const canAct = myTurn && mine.phase === 'actions' && (mine.actionsLeft ?? 0) > 0 && !isDecisionPending();
    const firstRound = r.round === 1;
    const carpenterUseCost = Math.max(0, Number(r.characterCatalog?.shipCarpenter?.useActionCost) || 0);
    const canArmCarpenter = (mine.actionsLeft ?? 0) >= 1 + carpenterUseCost;
    badge.textContent = mine.inPeaceZone ? 'зона мира' : `арт. ${mine.fleetArtillery} · штурм ${mine.assaultArmy ?? mine.stats?.army ?? 0}`;

    const usedAttackTargets = new Set(mine.attackedPlayerIdsThisRound || []);
    const seaTargets = r.players.filter(p => p.id !== state.myId && seaAttackPositionClient(mine, p) && !areAlliesClient(state.myId, p.id));
    const islandTargets = currentIslands().filter(i => i.ownerId !== state.myId && !(i.kind === 'free' && !i.ownerId) && (!i.ownerId || !areAlliesClient(state.myId, i.ownerId)));

    const notes = [];
    if (mine.inPeaceZone) notes.push('Зона мира Цитадели: морские бои и штурмы запрещены.');
    if (firstRound) notes.push('В первом раунде нельзя атаковать других игроков и их острова; нейтральные и государственные острова остаются целями.');
    if (!seaTargets.length && !islandTargets.length) notes.push('На текущей клетке нет допустимых целей.');
    content.innerHTML = notes.length ? notes.map(n => `<div class="combat-note">${escapeHtml(n)}</div>`).join('') : '<div class="combat-note">Можно атаковать одному или пригласить своего союзника. Союзник защиты также получает право присоединиться, если находится в нужной позиции.</div>';

    if (seaTargets.length) {
      const label = document.createElement('div');
      label.className = 'action-group-label';
      label.textContent = 'Морской бой';
      actions.appendChild(label);
      for (const target of seaTargets) {
        const card = document.createElement('div');
        card.className = 'combat-target';
        card.dataset.combatKind = 'sea';
        card.dataset.targetPlayerId = target.id;
        let carpenterToggle = null;
        if (mine.character?.id === 'shipCarpenter') {
          const carpenterLabel = document.createElement('label');
          carpenterLabel.className = 'cargo-meta';
          carpenterToggle = document.createElement('input');
          carpenterToggle.type = 'checkbox';
          carpenterToggle.disabled = !canArmCarpenter;
          carpenterLabel.appendChild(carpenterToggle);
          carpenterLabel.append(` Корабельный плотник: предотвратить потерю уровня при поражении · ещё ${carpenterUseCost} действие`);
          card.appendChild(carpenterLabel);
        }
        const attackAllies = r.players.filter(p => p.id !== state.myId && p.id !== target.id && areAlliesClient(state.myId, p.id) && !areAlliesClient(target.id, p.id) && seaAttackPositionClient(p, target) && !(p.attackedPlayerIdsThisRound || []).includes(target.id));
        const defenseAllies = r.players.filter(p => p.id !== state.myId && p.id !== target.id && areAlliesClient(target.id, p.id) && !areAlliesClient(state.myId, p.id) && seaAttackPositionClient(p, target));
        card.innerHTML = `<div><strong>${escapeHtml(target.name)}</strong><div class="cargo-meta">Флотилия цели: артиллерия ${target.fleetArtillery}. Ваши союзники в позиции: ${attackAllies.length}; союзники защиты в позиции: ${defenseAllies.length}.${target.legendaryStatus?.shipVeilTurns ? ` Покров моря: ${target.legendaryStatus.shipVeilTurns} хода.` : ''}</div></div>`;
        const row = document.createElement('div');
        row.className = 'combat-button-row';
        const solo = document.createElement('button');
        solo.type = 'button';
        solo.className = 'danger-soft';
        solo.textContent = `Атаковать · ${mine.fleetArtillery}:${target.fleetArtillery}`;
        solo.disabled = !canAct || firstRound || mine.inPeaceZone || target.inPeaceZone || usedAttackTargets.has(target.id) || (mine.brokenAlliesThisTurn || []).includes(target.id) || Boolean(target.legendaryStatus?.shipVeilTurns);
        if (usedAttackTargets.has(target.id)) solo.title = 'Лимит нападения на этого игрока в текущем раунде уже использован.';
        solo.addEventListener('click', () => socket.emit('attackShip', { targetPlayerId: target.id, inviteAllies: false, useShipCarpenter: Boolean(carpenterToggle?.checked) }, res => handleSeaBattleResultAck(res, target.name)));
        const together = document.createElement('button');
        together.type = 'button';
        together.textContent = `Позвать союзника (${attackAllies.length})`;
        together.disabled = solo.disabled || attackAllies.length === 0;
        together.addEventListener('click', () => socket.emit('attackShip', { targetPlayerId: target.id, inviteAllies: true, useShipCarpenter: Boolean(carpenterToggle?.checked) }, res => handleSeaBattleResultAck(res, target.name)));
        row.appendChild(solo); row.appendChild(together);
        card.appendChild(row);
        actions.appendChild(card);
      }
    }

    if (islandTargets.length) {
      const label = document.createElement('div');
      label.className = 'action-group-label';
      label.textContent = 'Штурм острова';
      actions.appendChild(label);
      for (const island of islandTargets) {
        const pvpIsland = Boolean(island.ownerId);
        const owner = island.ownerId ? playerName(island.ownerId) : (island.kind === 'independent' ? 'независимый гарнизон' : island.faction || 'государство');
        const attackAllies = r.players.filter(p => p.id !== state.myId && p.id !== island.ownerId && areAlliesClient(state.myId, p.id) && (!island.ownerId || !areAlliesClient(island.ownerId, p.id)) && playerOnIslandClient(p, island));
        const defenseAllies = island.ownerId ? r.players.filter(p => p.id !== state.myId && p.id !== island.ownerId && areAlliesClient(island.ownerId, p.id) && !areAlliesClient(state.myId, p.id) && playerOnIslandClient(p, island)) : [];
        const card = document.createElement('div');
        card.className = 'combat-target';
        card.dataset.combatKind = 'assault';
        card.dataset.islandId = island.id;
        const islandInfo = document.createElement('div');
        islandInfo.innerHTML = `<strong>${escapeHtml(island.name)}</strong><div class="cargo-meta">${escapeHtml(owner)} · ваша сила ${mine.assaultArmy ?? mine.stats?.army ?? 0} · базовая защита ${island.defenseArmy ?? island.army} · союзники атаки в позиции ${attackAllies.length} · защиты ${defenseAllies.length}${island.legendaryVeil?.remaining ? ` · Покров моря ${island.legendaryVeil.remaining} хода` : ''}</div>`;
        card.appendChild(islandInfo);
        let carpenterToggle = null;
        if (mine.character?.id === 'shipCarpenter') {
          const carpenterLabel = document.createElement('label');
          carpenterLabel.className = 'cargo-meta';
          carpenterToggle = document.createElement('input');
          carpenterToggle.type = 'checkbox';
          carpenterToggle.disabled = !canArmCarpenter;
          carpenterLabel.appendChild(carpenterToggle);
          carpenterLabel.append(` Корабельный плотник: предотвратить потерю уровня при проигранном штурме · ещё ${carpenterUseCost} действие`);
          card.appendChild(carpenterLabel);
        }
        const row = document.createElement('div');
        row.className = 'combat-button-row';
        const solo = document.createElement('button');
        solo.type = 'button';
        solo.className = 'danger-soft';
        solo.textContent = 'Штурмовать · одному';
        solo.disabled = !canAct || mine.inPeaceZone || (firstRound && pvpIsland) || (island.ownerId && usedAttackTargets.has(island.ownerId)) || (island.ownerId && (mine.brokenAlliesThisTurn || []).includes(island.ownerId)) || Boolean(island.legendaryVeil?.remaining);
        if (island.ownerId && usedAttackTargets.has(island.ownerId)) solo.title = 'Лимит нападения на владельца этого острова в текущем раунде уже использован.';
        solo.addEventListener('click', () => socket.emit('assaultIsland', { islandId: island.id, inviteAllies: false, useShipCarpenter: Boolean(carpenterToggle?.checked) }, res => handleAssaultResultAck(res, island.name)));
        const together = document.createElement('button');
        together.type = 'button';
        together.textContent = `Штурмовать · союз (${attackAllies.length})`;
        together.disabled = solo.disabled || attackAllies.length === 0;
        together.addEventListener('click', () => socket.emit('assaultIsland', { islandId: island.id, inviteAllies: true, useShipCarpenter: Boolean(carpenterToggle?.checked) }, res => handleAssaultResultAck(res, island.name)));
        row.appendChild(solo); row.appendChild(together);
        card.appendChild(row);
        actions.appendChild(card);
      }
    }
  }

  function mapSize() {
    return {
      rows: Math.max(1, Number(state.room?.map?.rows) || 28),
      cols: Math.max(1, Number(state.room?.map?.cols) || 28),
    };
  }


  function centroid(cells = []) {
    if (!cells.length) return { row: 0, col: 0 };
    const sum = cells.reduce((a, [row, col]) => ({ row: a.row + row, col: a.col + col }), { row: 0, col: 0 });
    return { row: sum.row / cells.length, col: sum.col / cells.length };
  }

  function closeMapInfo() {
    const closingCards = state.mapSelection?.kind === 'cards';
    const closingGoals = state.mapSelection?.kind === 'goals';
    state.mapSelection = null;
    const card = $('mapInfoCard');
    card.classList.add('hidden');
    card.style.visibility = '';
    card.style.maxHeight = '';
    const sheet = $('objectSheet');
    if (sheet) {
      sheet.classList.add('hidden');
      sheet.classList.remove('expanded');
      document.body.classList.remove('object-sheet-open');
    }
    if (closingCards && state.room && me()) {
      renderEvents();
      renderLegendary();
    }
    if (closingGoals && state.room && me()) {
      renderAssignments();
      renderLegendaryPlaces();
    }
  }

  function positionMapInfoAt(row, col) {
    const card = $('mapInfoCard');
    if (card.classList.contains('hidden')) return;

    const board = $('mapBoard');
    const viewport = $('mapViewport');
    const { rows, cols } = mapSize();
    const margin = 8;
    const gap = 8;
    const cellW = board.clientWidth / cols;
    const cellH = board.clientHeight / rows;
    const anchorX = (Number(col) + .5) * cellW;
    const anchorY = (Number(row) + .5) * cellH;

    const visibleLeft = viewport.scrollLeft + margin;
    const visibleTop = viewport.scrollTop + margin;
    const visibleRight = viewport.scrollLeft + viewport.clientWidth - margin;
    const visibleBottom = viewport.scrollTop + viewport.clientHeight - margin;

    card.style.right = 'auto';
    card.style.bottom = 'auto';
    card.style.maxHeight = `${Math.max(120, viewport.clientHeight - margin * 2)}px`;

    const width = card.offsetWidth;
    const height = card.offsetHeight;
    let left = anchorX + cellW * .5 + gap;
    if (left + width > visibleRight) left = anchorX - cellW * .5 - gap - width;
    const maxLeft = Math.max(visibleLeft, visibleRight - width);
    left = Math.max(visibleLeft, Math.min(left, maxLeft));

    let top = anchorY - height / 2;
    const maxTop = Math.max(visibleTop, visibleBottom - height);
    top = Math.max(visibleTop, Math.min(top, maxTop));

    card.style.left = `${Math.round(left)}px`;
    card.style.top = `${Math.round(top)}px`;
    card.style.visibility = 'visible';
  }

  function repositionOpenMapInfo() {
    const anchor = state.mapSelection?.anchor;
    if (!anchor || $('mapInfoCard').classList.contains('hidden')) return;
    positionMapInfoAt(anchor.row, anchor.col);
  }

  function mapObjectKindLabel(kind, data) {
    if (kind === 'island') {
      if (data.ownerId === state.myId) return 'ВАШ ОСТРОВ';
      if (data.ownerId) return 'ОСТРОВ ИГРОКА';
      if (data.kind === 'state') return 'ГОСУДАРСТВЕННЫЙ ОСТРОВ';
      return 'ОСТРОВ';
    }
    if (kind === 'citadel') return 'ЦИТАДЕЛЬ';
    if (kind === 'anchor') return 'МОРСКОЙ ЯКОРЬ';
    if (kind === 'legendary') return 'ЛЕГЕНДАРНОЕ МЕСТО';
    if (kind === 'hazard') return 'МОРСКАЯ ОПАСНОСТЬ';
    if (kind === 'player') return data.id === state.myId ? 'ВАША ФЛОТИЛИЯ' : 'ФЛОТИЛИЯ ИГРОКА';
    return 'ОБЪЕКТ КАРТЫ';
  }

  function ownIslandCompactHtml(island) {
    const resources = island.resources?.length ? island.resources.join(', ') : 'нет';
    const buildings = island.buildings?.length
      ? island.buildings.map(building => building.name).join(', ')
      : 'нет';
    const defense = Object.hasOwn(island, 'defenseArmy') ? island.defenseArmy : island.army;
    const garrison = Object.hasOwn(island, 'garrisonName')
      ? (island.garrisonName ? `${island.garrisonName} (+${island.garrisonDefense || 0})` : 'нет')
      : null;
    return `
      <div class="own-island-summary">
        <div class="own-island-stat"><span>Статус</span><strong>${escapeHtml(island.status || '—')}</strong></div>
        <div class="own-island-stat"><span>Защита</span><strong>${defense ?? '—'}</strong></div>
        <div class="own-island-stat"><span>Площадь</span><strong>${island.usedArea ?? 0}/${island.effectiveArea ?? island.area ?? 0}</strong></div>
        <div class="own-island-stat"><span>Ресурсы</span><strong>${escapeHtml(resources)}</strong></div>
      </div>
      ${garrison !== null ? `<div class="own-island-line"><span>Гарнизон</span><strong>${escapeHtml(garrison)}</strong></div>` : ''}
      <div class="own-island-line"><span>Постройки</span><strong>${escapeHtml(buildings)}</strong></div>
    `;
  }

  function ownIslandQuickActions(island) {
    const mine = me();
    if (!mine) return [];
    const here = currentIslands().some(item => item.id === island.id);
    const myTurn = state.room?.activePlayerId === state.myId;
    const canAct = here && myTurn && mine.phase === 'actions' && (mine.actionsLeft ?? 0) > 0 && !isDecisionPending();
    if (!canAct) return [];

    const quick = [];
    const loadedThisRound = island.loadedRound === state.room.round;
    if ((island.availableGoods || []).length && !loadedThisRound) quick.push('Погрузить');
    if ((island.buildings || []).some(building => building.nextUpgrade)) quick.push('Улучшить');
    quick.push('Построить');
    return quick;
  }

  function renderOwnIslandObjectSheet(island) {
    const sheet = $('objectSheet');
    const body = $('objectSheetBody');
    const actions = $('objectSheetActions');
    $('objectSheetKind').textContent = 'ВАШ ОСТРОВ';
    $('objectSheetTitle').textContent = island.name;
    body.innerHTML = ownIslandCompactHtml(island);
    actions.innerHTML = '';

    const quick = ownIslandQuickActions(island);
    if (quick.length) {
      const row = document.createElement('div');
      row.className = 'own-island-quick-actions';
      for (const label of quick) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'small';
        button.textContent = label;
        button.addEventListener('click', () => expandOwnIslandManagement(island.id));
        row.appendChild(button);
      }
      actions.appendChild(row);
    }

    const manage = document.createElement('button');
    manage.type = 'button';
    manage.className = 'primary';
    manage.textContent = 'Управлять островом';
    manage.addEventListener('click', () => expandOwnIslandManagement(island.id));
    actions.appendChild(manage);

    const here = currentIslands().some(item => item.id === island.id);
    if (!here) {
      const note = document.createElement('div');
      note.className = 'own-island-away-note';
      note.textContent = 'Корабль не находится у этого острова. Управление доступно для просмотра; действия появятся, когда они будут разрешены правилами.';
      actions.appendChild(note);
    }

    sheet.classList.remove('hidden');
    sheet.classList.remove('expanded');
    document.body.classList.add('object-sheet-open');
  }

  function expandOwnIslandManagement(islandId) {
    const island = state.room?.islands?.find(item => item.id === islandId && item.ownerId === state.myId);
    if (!island) return;
    state.selectedIslandId = island.id;
    const sheet = $('objectSheet');
    sheet.classList.add('expanded');
    $('objectSheetExpand').textContent = '⌄';
    $('objectSheetExpand').setAttribute('aria-label', 'Свернуть карточку');

    const body = $('objectSheetBody');
    body.innerHTML = ownIslandCompactHtml(island);

    const details = document.createElement('div');
    details.className = 'own-island-management-details';
    const defense = island.defenseBreakdown || {};
    details.innerHTML = `
      <div class="own-island-section-title">Подробности владения</div>
      <div class="own-island-line"><span>Исходная защита</span><strong>${island.army ?? 0}</strong></div>
      ${Object.hasOwn(island, 'defenseBreakdown') ? `
        <div class="own-island-line"><span>Гарнизон</span><strong>${defense.garrison || 0}</strong></div>
        <div class="own-island-line"><span>Нанятый гарнизон</span><strong>${defense.hiredGarrison || 0}</strong></div>
        <div class="own-island-line"><span>Укрепления</span><strong>${defense.fortifications || 0}</strong></div>
        <div class="own-island-line"><span>Бастионы</span><strong>${defense.bastions || 0}</strong></div>
        <div class="own-island-line"><span>Корабль владельца</span><strong>${defense.ownerShip || 0}</strong></div>
      ` : ''}
      <div class="own-island-line"><span>Погрузка в раунде ${state.room.round}</span><strong>${island.loadedRound === state.room.round ? 'уже выполнена' : 'доступна'}</strong></div>
    `;
    body.appendChild(details);

    const buildingList = document.createElement('div');
    buildingList.className = 'own-island-building-list';
    const title = document.createElement('div');
    title.className = 'own-island-section-title';
    title.textContent = 'Постройки';
    buildingList.appendChild(title);
    for (const building of island.buildings || []) {
      const row = document.createElement('div');
      row.className = 'own-island-building';
      const next = building.nextUpgrade ? ` → ${building.nextUpgrade.name} · ${building.nextUpgrade.price} дук.` : '';
      const support = building.type === 'bastion' ? (building.supported ? ' · поддерживается' : ' · без поддержки') : '';
      row.innerHTML = `<span>${escapeHtml(building.name)}${escapeHtml(support)}</span><strong>${escapeHtml(next || 'макс./без улучшения')}</strong>`;
      buildingList.appendChild(row);
    }
    if (!(island.buildings || []).length) {
      const empty = document.createElement('div');
      empty.className = 'muted';
      empty.textContent = 'Построек пока нет.';
      buildingList.appendChild(empty);
    }
    body.appendChild(buildingList);

    const actions = $('objectSheetActions');
    actions.innerHTML = '';
    const here = currentIslands().some(item => item.id === island.id);
    if (here) {
      // Reuse canonical legacy renderer. It owns legality, costs and socket payloads.
      renderIsland();
      const sourceActions = $('islandActions');
      while (sourceActions.firstChild) actions.appendChild(sourceActions.firstChild);
    }

    if (!actions.children.length) {
      const note = document.createElement('div');
      note.className = 'own-island-away-note';
      note.textContent = here
        ? 'Сейчас на этом острове нет доступных действий.'
        : 'Чтобы строить, улучшать и грузиться, основной корабль должен находиться у острова в допустимый момент хода.';
      actions.appendChild(note);
    }
  }

  function foreignIslandHasPrivateReveal(island) {
    if (!island || island.ownerId === state.myId) return false;
    return Object.hasOwn(island, 'garrisonName')
      || Object.hasOwn(island, 'garrisonDefense')
      || Object.hasOwn(island, 'defenseArmy')
      || Object.hasOwn(island, 'defenseBreakdown');
  }

  function foreignIslandCompactHtml(island) {
    const owner = island.ownerId
      ? playerName(island.ownerId)
      : (island.faction || (island.kind === 'free' ? 'Свободный остров' : island.kind === 'independent' ? 'Независимый остров' : 'Нет владельца'));
    const resources = island.resources?.length ? island.resources.join(', ') : 'нет';
    const buildings = island.buildings?.length
      ? island.buildings.map(building => building.name).join(', ')
      : 'нет';
    const revealed = foreignIslandHasPrivateReveal(island);

    let hiddenBlock = '<div class="foreign-island-hidden"><span>Гарнизон</span><strong>неизвестно</strong></div>';
    if (revealed) {
      const garrison = island.garrisonName
        ? `${island.garrisonName} (+${island.garrisonDefense || 0})`
        : 'нет отдельного гарнизона';
      hiddenBlock = `
        <div class="foreign-island-scout-badge">РАЗВЕДАНО · до конца вашего хода</div>
        <div class="foreign-island-line"><span>Гарнизон</span><strong>${escapeHtml(garrison)}</strong></div>
        ${Object.hasOwn(island, 'defenseArmy') ? `<div class="foreign-island-line"><span>Точная защита</span><strong>${island.defenseArmy}</strong></div>` : ''}
      `;
    }

    return `
      <div class="foreign-island-summary">
        <div class="foreign-island-stat"><span>Владелец</span><strong>${escapeHtml(owner)}</strong></div>
        <div class="foreign-island-stat"><span>Статус</span><strong>${escapeHtml(island.status || '—')}</strong></div>
        <div class="foreign-island-stat"><span>Площадь</span><strong>${island.usedArea ?? 0}/${island.effectiveArea ?? island.area ?? 0}</strong></div>
        <div class="foreign-island-stat"><span>Ресурсы</span><strong>${escapeHtml(resources)}</strong></div>
      </div>
      ${hiddenBlock}
      <div class="foreign-island-line"><span>Постройки</span><strong>${escapeHtml(buildings)}</strong></div>
    `;
  }

  function renderForeignIslandObjectSheet(island) {
    const sheet = $('objectSheet');
    $('objectSheetKind').textContent = island.ownerId ? 'ЧУЖОЙ ОСТРОВ' : (island.kind === 'state' ? 'ГОСУДАРСТВЕННЫЙ ОСТРОВ' : 'ОСТРОВ');
    $('objectSheetTitle').textContent = island.name;
    $('objectSheetBody').innerHTML = foreignIslandCompactHtml(island);
    const politicalFaction = factionForIsland(island);
    if (politicalFaction) {
      $('objectSheetBody').insertAdjacentHTML('beforeend', `
        <section class="state-island-politics">
          <span>ГОСУДАРСТВО</span>
          <strong>${escapeHtml(politicalFaction.name)}</strong>
          <small>${escapeHtml(factionRelationLabel(politicalFaction))}</small>
        </section>
      `);
    }

    const actions = $('objectSheetActions');
    actions.innerHTML = '';
    if (politicalFaction) {
      const diplomacy = document.createElement('button');
      diplomacy.type = 'button';
      diplomacy.className = 'primary';
      diplomacy.textContent = `Государство: ${politicalFaction.name}`;
      diplomacy.addEventListener('click', () => renderDiplomacyObjectSheet(politicalFaction.id));
      actions.appendChild(diplomacy);
      appendCanonicalPoliticsActions(actions, politicalFaction.id);
    }
    const here = currentIslands().some(item => item.id === island.id);
    const mine = me();
    const myTurn = state.room?.activePlayerId === state.myId;
    const canContextAct = Boolean(here && mine && myTurn && mine.phase === 'actions' && !isDecisionPending());

    if (canContextAct) {
      state.selectedIslandId = island.id;
      const attackable = island.ownerId !== state.myId
        && !(island.kind === 'free' && !island.ownerId)
        && (!island.ownerId || !areAlliesClient(state.myId, island.ownerId));
      const action = document.createElement('button');
      action.type = 'button';
      action.className = attackable ? 'danger-soft' : 'primary';
      action.textContent = attackable ? 'Штурм острова' : 'Действия на острове';
      action.addEventListener('click', () => {
        if (attackable) renderAssaultFlowSheet(island.id);
        else { closeMapInfo(); }
      });
      actions.appendChild(action);
    }

    sheet.classList.remove('hidden');
    sheet.classList.remove('expanded');
    document.body.classList.add('object-sheet-open');
  }

  function citadelSheetHtml(mine) {
    if (!mine) {
      return `
        <div class="citadel-overview">
          <strong>Цитадель</strong>
          <span>Нейтральный торговый хаб. Владеть им нельзя, бои внутри запрещены.</span>
        </div>
      `;
    }
    const cargo = cargoSummary(mine, state.room);
    const upgrades = mine.upgrades?.length || 0;
    const escorts = mine.escorts?.length || 0;
    return `
      <div class="citadel-overview">
        <span class="citadel-kicker">НЕЙТРАЛЬНЫЙ ТОРГОВЫЙ ХАБ</span>
        <strong>${mine.atCitadel ? 'Флотилия находится в Цитадели' : 'Цитадель'}</strong>
        <small>Здесь продаётся груз, улучшается основной корабль, покупается сопровождение и оборона владений.</small>
      </div>
      <div class="citadel-summary-grid">
        <div><span>Дукаты</span><strong>${mine.ducats ?? 0}</strong></div>
        <div><span>Корабль</span><strong>${escapeHtml(shipName(mine.shipClass))} ${ROMAN[mine.level] || mine.level}</strong></div>
        <div><span>Трюм</span><strong>${cargo.quantity}/${cargo.capacity}</strong></div>
        <div><span>Улучшения</span><strong>${upgrades}/${mine.upgradeSlots ?? 0}</strong></div>
        <div><span>Сопровождение</span><strong>${escorts}/${mine.escortUseLimit ?? state.room?.balanceCatalog?.maxEscorts ?? 0}</strong></div>
        <div><span>Действия</span><strong>${mine.actionsLeft ?? 0}</strong></div>
      </div>
    `;
  }

  function moveCanonicalCitadelFleetActions(target) {
    const source = $('fleetActions');
    if (!source || !target) return;
    const children = Array.from(source.children);
    const start = children.findIndex(node => node.classList?.contains('action-group-label') && node.textContent === 'Уровень основного корабля');
    if (start < 0) return;
    for (let i = start; i < children.length; i += 1) target.appendChild(children[i]);
  }

  function appendCanonicalCitadelTradeActions(target) {
    if (!target) return;
    const label = document.createElement('div');
    label.className = 'action-group-label';
    label.textContent = 'Торговля';
    target.appendChild(label);

    const legacySell = $('sellCargoBtn');
    if (legacySell && !legacySell.classList.contains('hidden')) {
      const mainSell = document.createElement('button');
      mainSell.type = 'button';
      mainSell.className = 'build-btn primary';
      mainSell.textContent = legacySell.textContent;
      mainSell.disabled = legacySell.disabled;
      mainSell.addEventListener('click', () => legacySell.click());
      target.appendChild(mainSell);
    }

    const escortSource = $('escortCargoActions');
    if (escortSource) {
      while (escortSource.firstChild) target.appendChild(escortSource.firstChild);
    }
  }

  function renderCitadelObjectSheet(data = {}) {
    const mine = me();
    const sheet = $('objectSheet');
    state.mapSelection = { kind: 'citadel', id: data.id || data.name || 'citadel', anchor: state.mapSelection?.anchor || null };
    $('objectSheetKind').textContent = 'ЦИТАДЕЛЬ';
    $('objectSheetTitle').textContent = data.name || 'Цитадель';
    $('objectSheetBody').innerHTML = citadelSheetHtml(mine);

    const actions = $('objectSheetActions');
    actions.innerHTML = '';

    if (!mine || state.spectating) {
      const note = document.createElement('div');
      note.className = 'citadel-sheet-note';
      note.textContent = 'Торговые действия доступны только участнику партии.';
      actions.appendChild(note);
    } else if (!mine.atCitadel) {
      const note = document.createElement('div');
      note.className = 'citadel-sheet-note';
      note.textContent = 'Приплывите в Цитадель, чтобы продавать груз и пользоваться её магазином.';
      actions.appendChild(note);
    } else {
      // Existing renderers remain authoritative for legality, prices and socket payloads.
      renderFleet();
      moveCanonicalCitadelFleetActions(actions);
      renderTrade();
      appendCanonicalCitadelTradeActions(actions);

      if (!actions.querySelector('button')) {
        const note = document.createElement('div');
        note.className = 'citadel-sheet-note';
        note.textContent = 'Сейчас в Цитадели нет доступных действий.';
        actions.appendChild(note);
      }
    }

    sheet.classList.remove('hidden');
    sheet.classList.add('expanded');
    $('objectSheetExpand').textContent = '⌄';
    $('objectSheetExpand').setAttribute('aria-label', 'Свернуть карточку');
    document.body.classList.add('object-sheet-open');
  }

  function refreshOpenCitadelSheet() {
    if (state.mapSelection?.kind !== 'citadel' || !isMobileGameplayUi()) return;
    const citadel = state.room?.map?.citadel || { name: 'Цитадель' };
    renderCitadelObjectSheet(citadel);
  }

  function anchorColorLabel(color) {
    return color === 'blue' ? 'Синий якорь'
      : color === 'yellow' ? 'Жёлтый якорь'
      : color === 'red' ? 'Красный якорь'
      : 'Морской якорь';
  }

  function anchorEncounterForCell(mine, anchor) {
    const encounter = mine?.lastAnchorEncounter;
    if (!encounter || !anchor) return null;
    return Number(encounter.round) === Number(state.room?.round)
      && Number(encounter.row) === Number(anchor.row)
      && Number(encounter.col) === Number(anchor.col)
      ? encounter
      : null;
  }

  function anchorEncounterSheetHtml(anchor, mine) {
    const atAnchor = Boolean(mine
      && Number(mine.row) === Number(anchor.row)
      && Number(mine.col) === Number(anchor.col));
    const visited = Boolean(mine && (mine.visitedAnchors || []).includes(`${anchor.row},${anchor.col}`));
    const encounter = anchorEncounterForCell(mine, anchor);
    const ownArtillery = mine?.fleetArtillery ?? '—';
    const location = atAnchor ? 'Вы находитесь на этом якоре.' : 'Чтобы вступить в столкновение, остановитесь на этой клетке.';
    const availability = visited
      ? 'Этот якорь уже разыгран вами в текущем раунде.'
      : 'Столкновение добровольное и объявляется в фазе действий. Союзник не участвует.';

    let last = '';
    if (encounter) {
      const outcome = encounter.outcome === 'win' ? 'Победа'
        : encounter.outcome === 'loss' ? 'Поражение'
        : encounter.outcome === 'tie' ? 'Ничья'
        : 'На море тихо';
      const card = encounter.cardName ? `«${escapeHtml(encounter.cardName)}»` : '—';
      last = `
        <section class="anchor-last-encounter">
          <span>ПОСЛЕДНЕЕ СТОЛКНОВЕНИЕ</span>
          <strong>${escapeHtml(outcome)}</strong>
          <small>${card} · артиллерия противника ${encounter.cardArtillery ?? '—'} · ваша сила ${encounter.fleetPower ?? ownArtillery}</small>
        </section>
      `;
    }

    return `
      <section class="anchor-encounter-hero anchor-${escapeAttr(anchor.color || 'unknown')}">
        <span>${escapeHtml(anchorColorLabel(anchor.color))}</span>
        <strong>${escapeHtml(anchor.name || 'Морской якорь')}</strong>
        <small>Карта встречи остаётся скрытой до объявления столкновения.</small>
      </section>
      <section class="anchor-encounter-stats">
        <div><span>Ваша артиллерия</span><strong>${ownArtillery}</strong></div>
        <div><span>За победу</span><strong>+${anchor.fleetPoints || 0} очк. флота</strong></div>
      </section>
      <div class="anchor-encounter-location">${escapeHtml(location)}</div>
      <div class="anchor-encounter-rule">${escapeHtml(availability)}</div>
      ${last}
    `;
  }

  function moveCanonicalAnchorActions(target) {
    const source = $('anchorActions');
    if (!source || !target) return;
    while (source.firstChild) target.appendChild(source.firstChild);
  }

  function renderAnchorEncounterSheet(anchor) {
    const mine = me();
    const sheet = $('objectSheet');
    state.mapSelection = {
      kind: 'anchor',
      id: anchor.id || anchor.name || `${anchor.row},${anchor.col}`,
      anchor: { row: Number(anchor.row), col: Number(anchor.col) },
    };
    $('objectSheetKind').textContent = 'МОРСКОЕ СТОЛКНОВЕНИЕ';
    $('objectSheetTitle').textContent = anchor.name || 'Морской якорь';
    $('objectSheetBody').innerHTML = anchorEncounterSheetHtml(anchor, mine);

    const actions = $('objectSheetActions');
    actions.innerHTML = '';
    if (!mine || state.spectating) {
      const note = document.createElement('div');
      note.className = 'anchor-encounter-note';
      note.textContent = 'Наблюдатель может осмотреть якорь, но не объявлять столкновение.';
      actions.appendChild(note);
    } else {
      const atAnchor = Number(mine.row) === Number(anchor.row) && Number(mine.col) === Number(anchor.col);
      if (atAnchor) {
        // The legacy renderer remains authoritative for visited state, phase,
        // actionsLeft, pending decisions and the fightAnchor socket command.
        renderAnchors();
        moveCanonicalAnchorActions(actions);
      }
      if (!actions.children.length) {
        const note = document.createElement('div');
        note.className = 'anchor-encounter-note';
        note.textContent = atAnchor
          ? 'Сейчас столкновение на этом якоре недоступно.'
          : 'Сначала завершите навигацию на клетке этого якоря.';
        actions.appendChild(note);
      }
    }

    sheet.classList.remove('hidden');
    sheet.classList.remove('expanded');
    document.body.classList.add('object-sheet-open');
  }

  function refreshOpenAnchorSheet() {
    if (state.mapSelection?.kind !== 'anchor' || !isMobileGameplayUi()) return;
    const selection = state.mapSelection;
    const anchor = (state.room?.anchorCells || []).find(item =>
      (selection.id && (item.id === selection.id || item.name === selection.id))
      || (selection.anchor && Number(item.row) === Number(selection.anchor.row) && Number(item.col) === Number(selection.anchor.col))
    );
    if (anchor) renderAnchorEncounterSheet(anchor);
    else closeMapInfo();
  }

  function renderObjectSheetFromMapInfo(kind, data) {
    const sheet = $('objectSheet');
    if (!sheet) return;
    if (kind === 'island' && data.ownerId === state.myId) {
      renderOwnIslandObjectSheet(data);
      return;
    }
    if (kind === 'island') {
      renderForeignIslandObjectSheet(data);
      return;
    }
    if (kind === 'player') {
      renderPlayerObjectSheet(data);
      return;
    }
    if (kind === 'citadel') {
      renderCitadelObjectSheet(data);
      return;
    }
    if (kind === 'anchor') {
      renderAnchorEncounterSheet(data);
      return;
    }

    $('objectSheetKind').textContent = mapObjectKindLabel(kind, data);
    $('objectSheetTitle').textContent = $('mapInfoTitle').textContent || data.name || 'Объект';
    $('objectSheetBody').innerHTML = $('mapInfoMeta').innerHTML;

    const actions = $('objectSheetActions');
    actions.innerHTML = '';
    const legacyAction = $('mapInfoAction');
    if (!legacyAction.classList.contains('hidden')) {
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'primary';
      action.textContent = legacyAction.textContent;
      action.addEventListener('click', () => legacyAction.onclick?.());
      actions.appendChild(action);
    }

    sheet.classList.remove('hidden');
    document.body.classList.add('object-sheet-open');
  }

  function toggleObjectSheetExpanded() {
    const sheet = $('objectSheet');
    if (!sheet || sheet.classList.contains('hidden')) return;
    const selectedOwnIsland = state.mapSelection?.kind === 'island'
      ? state.room?.islands?.find(item => item.id === state.mapSelection.id && item.ownerId === state.myId)
      : null;
    if (selectedOwnIsland && !sheet.classList.contains('expanded')) {
      expandOwnIslandManagement(selectedOwnIsland.id);
      return;
    }
    const expanded = sheet.classList.toggle('expanded');
    $('objectSheetExpand').textContent = expanded ? '⌄' : '⌃';
    $('objectSheetExpand').setAttribute('aria-label', expanded ? 'Свернуть карточку' : 'Развернуть карточку');
    if (!expanded && selectedOwnIsland) renderOwnIslandObjectSheet(selectedOwnIsland);
  }

  function playerRelationLabel(player) {
    if (!player || player.id === state.myId) return 'Вы';
    const mine = me();
    if ((mine?.allyIds || []).includes(player.id)) return 'Союзник · действующий союз';
    if ((mine?.brokenAlliesThisTurn || []).includes(player.id)) return 'Бывший союзник';
    if (player.suzerainId) {
      const faction = state.room?.factions?.find(item => item.id === player.suzerainId);
      if (faction) return `Вассал · ${faction.name}`;
    }
    return 'Другой игрок';
  }

  function playerPublicSheetHtml(player) {
    const rows = [];
    rows.push(`<div class="player-sheet-stat"><span>Корабль</span><strong>${escapeHtml(shipName(player.shipClass))} ${ROMAN[player.level] || player.level}</strong></div>`);
    if (player.fleetArtillery != null) rows.push(`<div class="player-sheet-stat"><span>Артиллерия</span><strong>${player.fleetArtillery}</strong></div>`);
    if (player.assaultArmy != null) rows.push(`<div class="player-sheet-stat"><span>Войско</span><strong>${player.assaultArmy}</strong></div>`);
    if (player.islandCount != null) rows.push(`<div class="player-sheet-stat"><span>Острова</span><strong>${player.islandCount}</strong></div>`);
    if (player.glory != null) rows.push(`<div class="player-sheet-stat"><span>Слава</span><strong>${player.glory}</strong></div>`);
    rows.push(`<div class="player-sheet-stat"><span>Связь</span><strong>${player.connected ? 'в сети' : 'отключён'}</strong></div>`);

    const scoutedMoney = player.id !== state.myId && Object.hasOwn(player, 'ducats');
    const money = scoutedMoney
      ? `<div class="player-scout-money"><span>РАЗВЕДАНО · до конца вашего хода</span><strong>Казна: ${player.ducats} дукатов</strong></div>`
      : '';

    const veil = Number(player.legendaryStatus?.shipVeilTurns) > 0
      ? `<div class="player-sheet-status">Покров моря: ${player.legendaryStatus.shipVeilTurns} ход.</div>`
      : '';
    const skip = Number(player.skipTurns) > 0
      ? `<div class="player-sheet-status">Пропуск ходов: ${player.skipTurns}</div>`
      : '';

    return `
      <div class="player-sheet-relation">${escapeHtml(playerRelationLabel(player))}</div>
      <div class="player-sheet-grid">${rows.join('')}</div>
      ${money}
      ${veil}
      ${skip}
    `;
  }

  function assaultDefenseLabel(island) {
    if (!island) return '—';
    if (Object.hasOwn(island, 'defenseArmy')) return String(island.defenseArmy);
    return `не менее ${island.army ?? 0}`;
  }

  function assaultPreviewHtml(island) {
    const mine = me();
    if (!mine || !island) return '';
    const owner = island.ownerId
      ? playerName(island.ownerId)
      : (island.kind === 'independent' ? 'Независимый гарнизон' : island.faction || 'Государство');
    const attackAllies = (state.room?.players || []).filter(player =>
      player.id !== state.myId && player.id !== island.ownerId
      && areAlliesClient(state.myId, player.id)
      && (!island.ownerId || !areAlliesClient(island.ownerId, player.id))
      && playerOnIslandClient(player, island)
    );
    const defenseAllies = island.ownerId ? (state.room?.players || []).filter(player =>
      player.id !== state.myId && player.id !== island.ownerId
      && areAlliesClient(island.ownerId, player.id)
      && !areAlliesClient(state.myId, player.id)
      && playerOnIslandClient(player, island)
    ) : [];
    const warnings = [];
    const pvpIsland = Boolean(island.ownerId);
    if (state.room?.round === 1 && pvpIsland) warnings.push('В первом раунде нельзя штурмовать остров другого игрока.');
    if (mine.inPeaceZone) warnings.push('Цитадель — зона мира.');
    if (island.ownerId && (mine.attackedPlayerIdsThisRound || []).includes(island.ownerId)) warnings.push('Лимит нападения на владельца в этом раунде уже использован.');
    if (island.ownerId && (mine.brokenAlliesThisTurn || []).includes(island.ownerId)) warnings.push('После разрыва союза владение бывшего союзника нельзя атаковать в текущем ходу.');
    if (island.legendaryVeil?.remaining) warnings.push(`Покров моря защищает остров ещё ${island.legendaryVeil.remaining} ход.`);

    return `
      <section class="assault-preview">
        <span>ШТУРМ ОСТРОВА</span>
        <strong>${escapeHtml(island.name)}</strong>
        <small>Владелец: ${escapeHtml(owner)}. Сервер окончательно проверит штурм и все обязательные реакции.</small>
      </section>
      <section class="assault-sides">
        <div>
          <span>Ваше войско</span>
          <strong>${mine.assaultArmy ?? mine.stats?.army ?? '—'}</strong>
          <small>${escapeHtml(shipName(mine.shipClass))} ${ROMAN[mine.level] || mine.level}</small>
        </div>
        <div>
          <span>Защита острова</span>
          <strong>${escapeHtml(assaultDefenseLabel(island))}</strong>
          <small>${Object.hasOwn(island, 'defenseArmy') ? 'точное значение доступно вам' : 'скрытый гарнизон не раскрывается'}</small>
        </div>
      </section>
      <section class="assault-allies">
        <div><span>Союзники атаки в позиции</span><strong>${attackAllies.length}</strong></div>
        <div><span>Союзники защиты в позиции</span><strong>${defenseAllies.length}</strong></div>
      </section>
      ${warnings.length ? `<section class="assault-warnings">${warnings.map(w => `<div>${escapeHtml(w)}</div>`).join('')}</section>` : ''}
    `;
  }

  function renderAssaultFlowSheet(islandId) {
    const island = state.room?.islands?.find(item => item.id === islandId);
    const mine = me();
    if (!island || !mine || state.spectating || isDecisionPending()) return;
    if (!currentIslands().some(item => item.id === island.id)) return;

    closeMapInfo();
    state.mapSelection = { kind: 'assault', id: island.id };
    state.selectedIslandId = island.id;
    $('objectSheetKind').textContent = 'БОЕВОЙ FLOW';
    $('objectSheetTitle').textContent = `Штурм: ${island.name}`;
    $('objectSheetBody').innerHTML = assaultPreviewHtml(island);

    renderCombat();
    const actions = $('objectSheetActions');
    actions.innerHTML = '';
    const canonical = Array.from($('combatActions')?.children || []).find(node =>
      node.classList?.contains('combat-target')
      && node.dataset.combatKind === 'assault'
      && node.dataset.islandId === island.id
    );
    if (canonical) actions.appendChild(canonical);

    if (!canonical) {
      const note = document.createElement('div');
      note.className = 'assault-note';
      note.textContent = 'Сейчас этот остров недоступен для штурма.';
      actions.appendChild(note);
    }

    $('objectSheet').classList.remove('hidden');
    $('objectSheet').classList.add('expanded');
    $('objectSheetExpand').textContent = '⌄';
    $('objectSheetExpand').setAttribute('aria-label', 'Свернуть карточку');
    document.body.classList.add('object-sheet-open');
  }

  function refreshOpenAssaultFlow() {
    if (state.mapSelection?.kind !== 'assault' || !isMobileGameplayUi()) return;
    const islandId = state.mapSelection.id;
    const island = state.room?.islands?.find(item => item.id === islandId);
    if (!island || state.room?.pendingBattle || state.room?.pendingLegendaryReaction) {
      closeMapInfo();
      return;
    }
    renderAssaultFlowSheet(islandId);
  }

  function jointAssaultResultCard(data) {
    const result = data?.result;
    if (!result || data?.kind !== 'assault') return null;
    const island = state.room?.islands?.find(item => item.id === data.islandId);
    const islandName = island?.name || data.islandName || 'Остров';
    const onAttack = (result.attackerParticipantIds || []).includes(state.myId);
    const onDefense = (result.defenderParticipantIds || []).includes(state.myId) || data.targetPlayerId === state.myId;
    const outcome = result.outcome;
    const title = outcome === 'attacker' ? 'Остров захвачен'
      : outcome === 'defender' ? 'Штурм отражён'
      : 'Штурм завершён вничью';
    const details = [
      { label: 'Сила атаки', value: result.attackerPower ?? '—' },
      { label: 'Защита острова', value: result.defense?.total ?? '—' },
    ];
    const myAward = (result.armyPointAwards || []).find(item => String(item.playerId) === String(state.myId));
    if (myAward?.points) details.push({ label: 'Ваши очки армии', value: `+${myAward.points}` });
    if (result.captureRetention) details.push({ label: 'Инфраструктура', value: `сохранится ${result.captureRetention.keepCount}/${result.captureRetention.initialCount}` });
    if ((result.rewardNotes || []).length && onAttack) details.push({ label: 'Награда атаки', value: result.rewardNotes.join(', ') });

    let body = 'Контроль не меняется.';
    if (outcome === 'attacker') body = `${islandName} захвачен атакующей стороной.`;
    if (outcome === 'defender') body = `Защита ${islandName} устояла.`;
    const viewerWon = (outcome === 'attacker' && onAttack) || (outcome === 'defender' && onDefense);
    return {
      kicker: 'ШТУРМ',
      title,
      body,
      details,
      tone: outcome === 'tie' ? 'neutral' : viewerWon ? 'success' : 'danger',
    };
  }

  function seaBattlePreviewHtml(target) {
    const mine = me();
    if (!mine || !target) return '';
    const attackAllies = (state.room?.players || []).filter(player =>
      player.id !== state.myId && player.id !== target.id
      && areAlliesClient(state.myId, player.id)
      && !areAlliesClient(target.id, player.id)
      && seaAttackPositionClient(player, target)
      && !(player.attackedPlayerIdsThisRound || []).includes(target.id)
    );
    const defenseAllies = (state.room?.players || []).filter(player =>
      player.id !== state.myId && player.id !== target.id
      && areAlliesClient(target.id, player.id)
      && !areAlliesClient(state.myId, player.id)
      && seaAttackPositionClient(player, target)
    );
    const warnings = [];
    if (state.room?.round === 1) warnings.push('В первом раунде атака на другого игрока запрещена.');
    if (mine.inPeaceZone || target.inPeaceZone) warnings.push('Цитадель — зона мира.');
    if ((mine.attackedPlayerIdsThisRound || []).includes(target.id)) warnings.push('Лимит нападения на этого игрока в текущем раунде уже использован.');
    if ((mine.brokenAlliesThisTurn || []).includes(target.id)) warnings.push('После разрыва союза эту цель нельзя атаковать в текущем ходу.');
    if (target.legendaryStatus?.shipVeilTurns) warnings.push(`Покров моря: защита ещё ${target.legendaryStatus.shipVeilTurns} ход.`);

    return `
      <section class="sea-battle-preview">
        <span>МОРСКОЙ БОЙ</span>
        <strong>${escapeHtml(mine.name)} → ${escapeHtml(target.name)}</strong>
        <small>Сервер окончательно проверит допустимость и разрешит бой после всех обязательных реакций.</small>
      </section>
      <section class="sea-battle-sides">
        <div>
          <span>Ваша флотилия</span>
          <strong>${mine.fleetArtillery ?? '—'} арт.</strong>
          <small>${escapeHtml(shipName(mine.shipClass))} ${ROMAN[mine.level] || mine.level}</small>
        </div>
        <div>
          <span>${escapeHtml(target.name)}</span>
          <strong>${target.fleetArtillery ?? '—'} арт.</strong>
          <small>${escapeHtml(shipName(target.shipClass))} ${ROMAN[target.level] || target.level}</small>
        </div>
      </section>
      <section class="sea-battle-allies">
        <div><span>Союзники атаки в позиции</span><strong>${attackAllies.length}</strong></div>
        <div><span>Союзники защиты в позиции</span><strong>${defenseAllies.length}</strong></div>
      </section>
      ${warnings.length ? `<section class="sea-battle-warnings">${warnings.map(w => `<div>${escapeHtml(w)}</div>`).join('')}</section>` : ''}
    `;
  }

  function renderSeaBattleFlowSheet(targetId) {
    const target = state.room?.players?.find(player => player.id === targetId);
    const mine = me();
    if (!target || !mine || state.spectating || isDecisionPending()) return;

    closeMapInfo();
    state.mapSelection = { kind: 'sea-battle', id: target.id };
    $('objectSheetKind').textContent = 'БОЕВОЙ FLOW';
    $('objectSheetTitle').textContent = `Атака: ${target.name}`;
    $('objectSheetBody').innerHTML = seaBattlePreviewHtml(target);

    renderCombat();
    const actions = $('objectSheetActions');
    actions.innerHTML = '';
    const canonical = Array.from($('combatActions')?.children || []).find(node =>
      node.classList?.contains('combat-target')
      && node.dataset.combatKind === 'sea'
      && node.dataset.targetPlayerId === target.id
    );
    if (canonical) actions.appendChild(canonical);

    if (!canonical) {
      const note = document.createElement('div');
      note.className = 'sea-battle-note';
      note.textContent = 'Сейчас эта цель недоступна для морского боя.';
      actions.appendChild(note);
    }

    $('objectSheet').classList.remove('hidden');
    $('objectSheet').classList.add('expanded');
    $('objectSheetExpand').textContent = '⌄';
    $('objectSheetExpand').setAttribute('aria-label', 'Свернуть карточку');
    document.body.classList.add('object-sheet-open');
  }

  function refreshOpenSeaBattleFlow() {
    if (state.mapSelection?.kind !== 'sea-battle' || !isMobileGameplayUi()) return;
    const targetId = state.mapSelection.id;
    const target = state.room?.players?.find(player => player.id === targetId);
    if (!target || state.room?.pendingBattle || state.room?.pendingLegendaryReaction) {
      closeMapInfo();
      return;
    }
    renderSeaBattleFlowSheet(targetId);
  }

  function battleFlowStatusHtml(pending) {
    if (!pending) return '';
    const attacker = playerName(pending.attackerId);
    const target = pending.kind === 'sea'
      ? playerName(pending.targetPlayerId)
      : (state.room?.islands?.find(island => island.id === pending.islandId)?.name || 'остров');
    const invites = (pending.invites || []).map(invite => {
      const status = invite.status === 'pending' ? 'ожидается ответ'
        : invite.status === 'joined' ? 'участвует'
        : 'не участвует';
      const side = invite.side === 'attacker' ? 'атака' : 'защита';
      return `<div class="battle-flow-invite"><span>${escapeHtml(playerName(invite.playerId))} · ${side}</span><strong>${escapeHtml(status)}</strong></div>`;
    }).join('');
    return `
      <section class="battle-flow-status">
        <span>${pending.kind === 'sea' ? 'МОРСКОЙ БОЙ' : 'ШТУРМ'}</span>
        <strong>${escapeHtml(attacker)} → ${escapeHtml(target)}</strong>
        <small>Бой разрешится сервером после ответов всех приглашённых участников.</small>
      </section>
      <section class="battle-flow-invites">${invites || '<div class="battle-flow-invite"><span>Участники</span><strong>ожидание</strong></div>'}</section>
    `;
  }

  function appendCanonicalAllianceActions(target, playerId) {
    if (!target || !playerId) return;
    renderAlliances();
    const player = state.room?.players?.find(item => item.id === playerId);
    if (!player) return;
    const source = $('allianceActions');
    for (const node of Array.from(source?.children || [])) {
      if (node.tagName !== 'BUTTON') continue;
      if (!node.textContent.includes(player.name)) continue;
      target.appendChild(node);
    }
  }

  function alliancePublicStatusHtml(player) {
    if (!player || player.id === state.myId) return '';
    if (areAlliesClient(state.myId, player.id)) {
      return '<div class="player-alliance-status"><span>СОЮЗ</span><strong>Действующий союз</strong><small>Разрыв доступен только в разрешённый правилами момент.</small></div>';
    }
    return '';
  }

  function renderFleetOverviewObjectSheet() {
    const mine = me();
    if (!mine || state.spectating) return;
    closeMapInfo();
    state.mapSelection = { kind: 'fleet', id: state.myId };
    $('objectSheetKind').textContent = 'ВАША ФЛОТИЛИЯ';
    $('objectSheetTitle').textContent = mine.name;
    const cargo = cargoSummary(mine, state.room);
    $('objectSheetBody').innerHTML = playerPublicSheetHtml(mine)
      + `<div class="player-sheet-stat"><span>Казна</span><strong>${mine.ducats ?? 0} дук.</strong></div>`
      + `<div class="player-sheet-stat"><span>Груз</span><strong>${cargo.quantity}/${cargo.capacity}</strong></div>`
      + `<div class="player-sheet-stat"><span>Персонаж</span><strong>${escapeHtml(mine.character?.name || 'нет')}</strong></div>`;

    renderFleet();
    renderTrade();
    const actions = $('objectSheetActions');
    actions.innerHTML = '';

    const character = document.createElement('button');
    character.type = 'button';
    character.textContent = 'Персонаж';
    character.addEventListener('click', renderCharacterObjectSheet);
    actions.appendChild(character);

    if (mine.atCitadel) {
      const citadel = document.createElement('button');
      citadel.type = 'button';
      citadel.className = 'primary';
      citadel.textContent = 'Услуги Цитадели';
      citadel.addEventListener('click', () => renderCitadelObjectSheet(state.room?.map?.citadel || { name: 'Цитадель' }));
      actions.appendChild(citadel);
    }

    $('objectSheet').classList.remove('hidden');
    $('objectSheet').classList.add('expanded');
    $('objectSheetExpand').textContent = '⌄';
    $('objectSheetExpand').setAttribute('aria-label', 'Свернуть карточку');
    document.body.classList.add('object-sheet-open');
  }

  function renderPlayerObjectSheet(player) {
    const sheet = $('objectSheet');
    $('objectSheetKind').textContent = player.id === state.myId ? 'ВАША ФЛОТИЛИЯ' : 'ФЛОТИЛИЯ ИГРОКА';
    $('objectSheetTitle').textContent = player.name;
    $('objectSheetBody').innerHTML = playerPublicSheetHtml(player) + alliancePublicStatusHtml(player);

    const actions = $('objectSheetActions');
    actions.innerHTML = '';
    const mine = me();

    if (player.id === state.myId) {
      const fleet = document.createElement('button');
      fleet.type = 'button';
      fleet.className = 'primary';
      fleet.textContent = 'Корабль и флотилия';
      fleet.addEventListener('click', renderFleetOverviewObjectSheet);
      actions.appendChild(fleet);
    } else if (mine && !state.spectating && state.room?.started) {
      const myTurn = state.room.activePlayerId === state.myId;
      const blocked = isDecisionPending();
      const allies = areAlliesClient(state.myId, player.id);

      appendCanonicalAllianceActions(actions, player.id);

      const canReachForSeaBattle = seaAttackPositionClient(mine, player) && !allies;
      if (canReachForSeaBattle) {
        const combat = document.createElement('button');
        combat.type = 'button';
        combat.className = 'danger-soft';
        combat.textContent = 'Морской бой';
        combat.disabled = !(myTurn && mine.phase === 'actions' && (mine.actionsLeft ?? 0) > 0 && !blocked);
        combat.addEventListener('click', () => renderSeaBattleFlowSheet(player.id));
        actions.appendChild(combat);
      }

      const relations = document.createElement('button');
      relations.type = 'button';
      relations.textContent = 'Игроки и отношения';
      relations.addEventListener('click', () => renderPlayerObjectSheet(player));
      actions.appendChild(relations);
    }

    sheet.classList.remove('hidden');
    sheet.classList.remove('expanded');
    document.body.classList.add('object-sheet-open');
  }

  function showPlayerMapInfo(player) {
    state.mapSelection = { kind: 'player', id: player.id, anchor: { row: player.row, col: player.col } };
    $('mapInfoTitle').textContent = player.name;
    $('mapInfoMeta').innerHTML = playerPublicSheetHtml(player);
    const action = $('mapInfoAction');
    action.classList.add('hidden');
    action.onclick = null;

    if (player.id === state.myId) {
      action.textContent = 'Открыть флотилию';
      action.classList.remove('hidden');
      action.onclick = () => { closeMapInfo(); renderFleetOverviewObjectSheet(); };
    } else {
      action.textContent = 'Открыть игрока';
      action.classList.remove('hidden');
      action.onclick = () => { closeMapInfo(); renderPlayerObjectSheet(player); };
    }

    $('mapInfoCard').classList.add('hidden');
    renderPlayerObjectSheet(player);
  }

  function showMapInfo(kind, data, anchor = null) {
    const resolvedAnchor = anchor || (
      Number.isFinite(Number(data.row)) && Number.isFinite(Number(data.col))
        ? { row: Number(data.row), col: Number(data.col) }
        : { row: 14, col: 14 }
    );
    state.mapSelection = { kind, id: data.id || data.name, anchor: resolvedAnchor };
    const card = $('mapInfoCard');
    card.style.visibility = 'hidden';
    const title = $('mapInfoTitle');
    const meta = $('mapInfoMeta');
    const action = $('mapInfoAction');
    title.textContent = data.name || 'Объект';
    action.classList.add('hidden');
    action.onclick = null;

    if (kind === 'island') {
      if (data.ownerId === state.myId) {
        const resources = data.resources?.length ? data.resources.join(', ') : 'нет';
        const defense = Object.hasOwn(data, 'defenseArmy') ? data.defenseArmy : data.army;
        meta.innerHTML = `<span>Ваш остров</span><span>Статус: <strong>${escapeHtml(data.status || '—')}</strong></span><span>Площадь: <strong>${data.usedArea ?? 0}/${data.effectiveArea ?? data.area ?? 0}</strong></span><span>Защита: <strong>${defense ?? '—'}</strong></span><span>Ресурсы: <strong>${escapeHtml(resources)}</strong></span>`;
      } else {
        meta.innerHTML = foreignIslandCompactHtml(data);
      }
      const here = currentIslands().some(i => i.id === data.id);
      if (here) {
        state.selectedIslandId = data.id;
        action.textContent = data.ownerId === state.myId ? 'Управлять островом' : 'Действия на острове';
        action.classList.remove('hidden');
        action.onclick = () => { closeMapInfo(); closeMapInfo(); };
      }
    } else if (kind === 'citadel') {
      meta.innerHTML = '<span>Нейтральный торговый хаб</span><span>Продажа грузов · уровень корабля · улучшения · сопровождение</span><span>Городская стража · постоянные гарнизоны</span><span>Владеть Цитаделью нельзя · бои запрещены</span>';
      if (me()?.atCitadel) {
        action.textContent = 'Открыть Цитадель';
        action.classList.remove('hidden');
        action.onclick = () => {
          if (isMobileGameplayUi()) renderCitadelObjectSheet(data);
          else { closeMapInfo(); renderFleetOverviewObjectSheet(); }
        };
      }
    } else if (kind === 'anchor') {
      const mine = me();
      const atAnchor = Boolean(mine && Number(mine.row) === Number(data.row) && Number(mine.col) === Number(data.col));
      const visited = Boolean(mine && (mine.visitedAnchors || []).includes(`${data.row},${data.col}`));
      meta.innerHTML = `<span>${escapeHtml(anchorColorLabel(data.color))}</span><span>Карта встречи скрыта до объявления столкновения</span><span>Победа: <strong>+${data.fleetPoints || 0} очк. флота</strong></span><span>${visited ? 'Уже разыгран вами в этом раунде' : atAnchor ? 'Вы находитесь на якоре' : 'Остановитесь на клетке якоря'}</span>`;
      if (atAnchor && !visited) {
        action.textContent = 'Открыть столкновение';
        action.classList.remove('hidden');
        action.onclick = () => {
          if (isMobileGameplayUi()) renderAnchorEncounterSheet(data);
          else { closeMapInfo(); }
        };
      }
    } else if (kind === 'legendary') {
      const reward = data.reward === 'legendary' ? 'случайная легендарная карта' : data.reward === 'treasure' ? 'случайная карта сокровища' : 'награда пока не определена';
      const here = me() && Number(me().row) === Number(data.row) && Number(me().col) === Number(data.col);
      const explored = Boolean(data.exploredBy);
      const stateLine = explored
        ? `Уже исследовано: <strong>${escapeHtml(playerName(data.exploredBy))}</strong>`
        : (here ? '<strong>Вы на месте.</strong> Разовая награда разыгрывается автоматически при остановке.' : 'Остановитесь на этой клетке, чтобы исследовать место.');
      meta.innerHTML = `<span>Морское легендарное место</span><span>Разовая награда: <strong>${escapeHtml(reward)}</strong></span><span>${stateLine}</span>`;
    } else if (kind === 'hazard') {
      const descriptions = {
        reef: 'Рифы. Сквозь них проходит только фрегат.',
        shoal: 'Мель. Через неё проходит только бригантина.',
        ice: 'Льды. Сквозь них проходит только каракка.',
      };
      meta.innerHTML = `<span>${escapeHtml(descriptions[data.type] || 'Опасная морская клетка.')}</span>`;
    }
    card.classList.add('hidden');
    card.style.visibility = '';
    renderObjectSheetFromMapInfo(kind, data);
  }

  function addMapCellButton(layer, row, col, className, label, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = className;
    b.setAttribute('aria-label', label);
    b.title = label;
    placeCell(b, row, col);
    b.addEventListener('click', ev => {
      ev.stopPropagation();
      onClick({ row, col, event: ev, element: b });
    });
    layer.appendChild(b);
  }

  function addMapMarker(layer, row, col, className, text, title, onClick = null) {
    const el = onClick ? document.createElement('button') : document.createElement('span');
    if (onClick) el.type = 'button';
    el.className = className;
    el.textContent = text;
    el.title = title || '';
    const { rows, cols } = mapSize();
    el.style.left = `${((col + .5) / cols) * 100}%`;
    el.style.top = `${((row + .5) / rows) * 100}%`;
    if (onClick) {
      el.setAttribute('aria-label', title || text);
      el.addEventListener('click', ev => {
        ev.stopPropagation();
        onClick({ row, col, event: ev, element: el });
      });
    }
    layer.appendChild(el);
  }

  function renderMapObjects() {
    const r = state.room;
    const layer = $('mapObjectLayer');
    const labels = $('mapLabelLayer');
    layer.innerHTML = '';
    labels.innerHTML = '';

    for (const island of r.islands || []) {
      for (const [row, col] of island.cells || []) {
        addMapCellButton(layer, row, col, 'map-object-hit island-hit', island.name, hit => showMapInfo('island', island, hit));
      }
      const c = centroid(island.cells || []);
      const l = document.createElement('span');
      l.className = 'map-label island-label';
      l.textContent = island.name;
      l.style.left = `${((c.col + .5) / mapSize().cols) * 100}%`;
      l.style.top = `${((c.row + .5) / mapSize().rows) * 100}%`;
      labels.appendChild(l);
    }

    for (const [row, col] of r.citadelCells || []) {
      addMapCellButton(layer, row, col, 'map-object-hit citadel-hit', 'Цитадель', hit => showMapInfo('citadel', { id: 'citadel', name: 'Цитадель' }, hit));
    }
    if ((r.citadelCells || []).length) {
      const c = centroid(r.citadelCells);
      const l = document.createElement('span');
      l.className = 'map-label citadel-label';
      l.textContent = 'Цитадель';
      l.style.left = `${((c.col + .5) / mapSize().cols) * 100}%`;
      l.style.top = `${((c.row + .5) / mapSize().rows) * 100}%`;
      labels.appendChild(l);
    }

    const hazardNames = { reef: 'Рифы', shoal: 'Мель', ice: 'Льды' };
    const hazardGlyphs = { reef: '▲', shoal: '▲', ice: '▲' };
    for (const hazard of r.map?.hazards || []) {
      addMapMarker(
        layer, hazard.row, hazard.col,
        `hazard-marker hazard-${hazard.type}`,
        hazardGlyphs[hazard.type] || '▲',
        hazardNames[hazard.type] || 'Опасность',
        hit => showMapInfo('hazard', { ...hazard, name: hazardNames[hazard.type] || 'Опасность' }, hit)
      );
    }

    for (const anchor of r.anchorCells || []) {
      addMapMarker(
        layer, anchor.row, anchor.col,
        `anchor-marker anchor-${anchor.color}`,
        '⚓', anchor.name,
        hit => showMapInfo('anchor', anchor, hit)
      );
    }

    for (const place of r.map?.legendaryPlaces || []) {
      addMapCellButton(layer, place.row, place.col, 'map-object-hit legendary-hit', place.name, hit => showMapInfo('legendary', place, hit));
      const l = document.createElement('span');
      l.className = 'map-label legendary-label';
      l.textContent = place.name;
      l.style.left = `${((place.col + .5) / mapSize().cols) * 100}%`;
      l.style.top = `${((place.row + .5) / mapSize().rows) * 100}%`;
      labels.appendChild(l);
    }
  }

  function renderMap() {
    const r = state.room;
    const { rows, cols } = mapSize();
    const board = $('mapBoard');
    board.classList.toggle('move-pending', Boolean(state.mapMovePending));
    const baseArt = $('mapBaseArt');
    const configuredArt = r.map?.visualLayers?.base;
    if (configuredArt && baseArt.getAttribute('src') !== configuredArt) baseArt.src = configuredArt;
    board.style.setProperty('--map-rows', rows);
    board.style.setProperty('--map-cols', cols);
    const tokenLayer = $('tokenLayer');
    const highlightLayer = $('highlightLayer');
    const ownershipLayer = $('ownershipLayer');
    tokenLayer.innerHTML = '';
    highlightLayer.innerHTML = '';
    ownershipLayer.innerHTML = '';
    renderMapObjects();

    const current = currentIslands();
    const selected = current.find(i => i.id === state.selectedIslandId) || current[0];

    for (const a of r.anchorCells || []) {
      const d = document.createElement('div');
      d.className = `anchor-cell anchor-${a.color}`;
      d.title = `${a.name} · победа +${a.glory} славы`;
      placeCell(d, a.row, a.col);
      ownershipLayer.appendChild(d);
    }

    r.islands.filter(i => i.ownerId).forEach(island => {
      const owner = r.players.find(p => p.id === island.ownerId);
      if (!owner) return;
      island.cells.forEach(([row, col]) => {
        const d = document.createElement('div');
        d.className = 'owned-cell';
        d.style.setProperty('--owner-color', owner.color);
        placeCell(d, row, col);
        ownershipLayer.appendChild(d);
      });
    });

    if (selected) {
      selected.cells.forEach(([row, col]) => {
        const d = document.createElement('div');
        d.className = 'island-focus';
        placeCell(d, row, col);
        ownershipLayer.appendChild(d);
      });
    }

    r.players.forEach((p, idx) => {
      const t = document.createElement('button');
      t.type = 'button';
      t.className = `token${p.id === state.myId ? ' you' : ''}`;
      t.style.left = `calc((${p.col} + .5) * 100% / ${cols} + ${(idx % 3) * 4}px)`;
      t.style.top = `calc((${p.row} + .5) * 100% / ${rows} + ${Math.floor(idx / 3) * 4}px)`;
      t.style.background = p.color;
      t.textContent = '⚓';
      t.title = p.name;
      t.setAttribute('aria-label', `Открыть флотилию игрока ${p.name}`);
      t.addEventListener('click', event => {
        event.stopPropagation();
        if (isDecisionPending()) return;
        showPlayerMapInfo(p);
      });
      tokenLayer.appendChild(t);
    });

    const mine = me();
    if (!mine || !r.started || r.activePlayerId !== state.myId) return;

    if (renderTargetingMapTargets(highlightLayer)) return;

    if (state.mistCardRef && mine.phase === 'actions' && !isDecisionPending()) {
      for (const cell of r.mistReachableCells || []) {
        if (cell.row === mine.row && cell.col === mine.col) continue;
        const b = document.createElement('button');
        b.type = 'button';
        const island = r.islands.find(i => i.cells.some(([rr, cc]) => rr === cell.row && cc === cell.col));
        const citadel = (r.citadelCells || []).some(([rr, cc]) => rr === cell.row && cc === cell.col);
        b.className = `cell-hit mist${island || citadel ? ' shore' : ''}`;
        placeCell(b, cell.row, cell.col);
        b.title = `Путь сквозь туман → ${cell.col + 1}:${cell.row + 1}${island ? ` · ${island.name}` : citadel ? ' · Цитадель' : ''}`;
        b.setAttribute('aria-label', b.title);
        b.addEventListener('click', () => socket.emit('playLegendary', { source: state.mistCardRef.source, index: state.mistCardRef.index, row: cell.row, col: cell.col }, res => { handleGameAck(res); if (res?.ok) state.mistCardRef = null; }));
        highlightLayer.appendChild(b);
      }
      return;
    }

    if (mine.phase !== 'navigation' || mine.roll === null) return;

    for (const cell of r.reachableCells || []) {
      if (cell.row === mine.row && cell.col === mine.col) continue;
      const b = document.createElement('button');
      b.type = 'button';
      const island = r.islands.find(i => i.cells.some(([rr, cc]) => rr === cell.row && cc === cell.col));
      const citadel = (r.citadelCells || []).some(([rr, cc]) => rr === cell.row && cc === cell.col);
      const coast = Boolean(island) || citadel;
      const anchor = (r.anchorCells || []).find(a => a.row === cell.row && a.col === cell.col);
      const legendary = (r.map?.legendaryPlaces || []).find(p => p.row === cell.row && p.col === cell.col);
      const expeditionPlace = mine.activeExpedition ? (r.legendaryPlaces || []).find(place => place.id === mine.activeExpedition.placeId) : null;
      const expeditionTarget = Boolean(expeditionPlace?.kind === 'sea' && legendary?.id === expeditionPlace.id);
      b.className = `cell-hit navigation-hit${coast ? ' shore' : ''}${citadel ? ' citadel' : ''}${legendary ? ' legendary-destination' : ''}${expeditionTarget ? ' expedition-destination' : ''}${anchor ? ` anchor-destination anchor-${anchor.color}` : ''}`;
      b.disabled = state.mapMovePending;
      b.dataset.distance = String(cell.dist);
      placeCell(b, cell.row, cell.col);
      const placeName = island?.name || (citadel ? 'Цитадель' : '') || anchor?.name || legendary?.name || '';
      b.setAttribute('aria-label', `Перейти на клетку ${cell.col + 1}:${cell.row + 1}, путь ${cell.dist}${placeName ? `, ${placeName}` : ''}`);
      b.title = placeName ? `${placeName} · ${cell.dist} клет.${expeditionTarget ? ' · цель экспедиции' : ''}` : `${cell.dist} клет.${expeditionTarget ? ' · цель экспедиции' : ''}`;
      b.addEventListener('click', () => moveToMapCell(cell));
      highlightLayer.appendChild(b);
    }
  }

  function placeCell(el, row, col) {
    const { rows, cols } = mapSize();
    el.style.left = `${(col / cols) * 100}%`;
    el.style.top = `${(row / rows) * 100}%`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  function applyZoom() {
    state.zoom = Math.max(.65, Math.min(1.8, state.zoom));
    const px = Math.round(980 * state.zoom);
    $('mapBoard').style.width = `${px}px`;
    $('zoomLabel').textContent = `${Math.round(state.zoom * 100)}%`;
  }
  $('mapInfoClose').addEventListener('click', closeMapInfo);
  $('mapBoard').addEventListener('click', ev => {
    if (ev.target === $('mapBoard') || ev.target === $('mapBaseArt') || ev.target === $('mapArtLayer')) closeMapInfo();
  });
  let mapInfoRepositionFrame = 0;
  const scheduleMapInfoReposition = () => {
    cancelAnimationFrame(mapInfoRepositionFrame);
    mapInfoRepositionFrame = requestAnimationFrame(repositionOpenMapInfo);
  };
  $('mapViewport').addEventListener('scroll', scheduleMapInfoReposition, { passive: true });
  window.addEventListener('resize', scheduleMapInfoReposition);
  $('zoomToggle').addEventListener('click', () => {
    const popover = $('zoomPopover');
    const opening = popover.classList.contains('hidden');
    popover.classList.toggle('hidden', !opening);
    $('zoomToggle').setAttribute('aria-expanded', opening ? 'true' : 'false');
  });
  $('zoomIn').addEventListener('click', () => { state.zoom += .15; applyZoom(); scheduleMapInfoReposition(); });
  $('zoomOut').addEventListener('click', () => { state.zoom -= .15; applyZoom(); scheduleMapInfoReposition(); });
  $('centerMe').addEventListener('click', () => centerMapOnMe('smooth'));
  applyZoom();

  initAuth();
})();
