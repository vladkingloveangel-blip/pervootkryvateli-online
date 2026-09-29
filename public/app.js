(() => {
  const socket = io();
  const $ = id => document.getElementById(id);
  const state = { room: null, myId: null, code: null, playerToken: null, zoom: 1, selectedIslandId: null, mapSelection: null, mistCardRef: null, accountToken: localStorage.getItem('pervo:accountToken') || '', accountUser: null, accountsEnabled: false, authResolved: false, socketConnected: false, resumeAttempted: false, spectating: false, profileOpen: false, profileReturn: 'entry', everConnected: false, mobileTab: 'map', mapMovePending: false, lastAutoCenterSignature: '' };
  const SHIP_NAMES = { brigantine: 'Бригантина', frigate: 'Фрегат', caravel: 'Каравелла', carrack: 'Каракка' };
  const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
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
    if (!active) closeGameAccountMenu();
  }

  function openGameAccountMenu() {
    if (!state.accountUser || !document.body.classList.contains('game-active')) return;
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

  function setError(id, msg = '') { $(id).textContent = msg; }
  function setConnected(yes) { $('connection').textContent = yes ? '● онлайн' : '○ нет связи'; }

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
    closeMapInfo();
    openMobileTab('map');
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
  socket.on('roomState', room => {
    if (state.spectating) return;
    state.room = room;
    const incomingMine = room?.players?.find(p => p.id === state.myId);
    if (!incomingMine || incomingMine.phase !== 'navigation') state.mapMovePending = false;
    render();
  });
  socket.on('adminRoomState', room => {
    if (!state.spectating) return;
    state.room = room;
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
    document.body.classList.remove('spectator-mode');
    $('spectatorBanner').classList.add('hidden');
    $('adminPanel').classList.add('hidden');
    state.code = res.code;
    state.myId = res.playerId;
    state.playerToken = res.playerToken;
    openMobileTab('map');
    setGameScreenActive(true);
    saveSession();
    if (state.room) render();
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

  document.querySelectorAll('[data-mobile-nav]').forEach(btn => {
    btn.addEventListener('click', () => openMobileTab(btn.dataset.mobileNav));
  });
  $('mobileSheetClose').addEventListener('click', () => openMobileTab('map'));
  $('hudPlayerBtn').addEventListener('click', () => state.spectating ? openMobileTab('players') : toggleGameAccountMenu());
  $('hudDucatsBtn').addEventListener('click', () => openMobileTab('ship'));
  $('hudGloryBtn').addEventListener('click', () => openMobileTab('players'));
  $('hudCargoBtn').addEventListener('click', () => openMobileTab('ship'));
  $('hudDebtBtn').addEventListener('click', () => openMobileTab('ship'));
  $('hudTurnBtn').addEventListener('click', () => state.spectating ? openMobileTab('players') : openMobileTab('actions'));

  $('startBtn').addEventListener('click', () => socket.emit('startGame', {}, handleGameAck));

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
  $('rollBtn').addEventListener('click', () => socket.emit('rollMove', {}, handleGameAck));
  $('skipBtn').addEventListener('click', () => socket.emit('skipNavigation', {}, handleGameAck));
  $('endTurnBtn').addEventListener('click', () => socket.emit('endTurn', {}, handleGameAck));
  $('dockRollBtn').addEventListener('click', () => socket.emit('rollMove', {}, handleGameAck));
  $('dockSkipBtn').addEventListener('click', () => socket.emit('skipNavigation', {}, handleGameAck));
  $('dockEndTurnBtn').addEventListener('click', () => socket.emit('endTurn', {}, handleGameAck));
  $('mapNavRollBtn').addEventListener('click', () => socket.emit('rollMove', {}, handleGameAck));
  $('mapNavStayBtn').addEventListener('click', () => socket.emit('skipNavigation', {}, handleGameAck));
  $('sellCargoBtn').addEventListener('click', () => socket.emit('sellCargo', {}, handleGameAck));

  function handleGameAck(res) { setError('gameError', res?.ok ? '' : (res?.error || 'Действие отклонено.')); }
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
  function isDecisionPending() { return Boolean(state.room?.pendingAlliance || state.room?.pendingBattle || state.room?.pendingEvent || state.room?.pendingFeud || state.room?.pendingAssignmentChoice || state.room?.pendingStatePrize || state.room?.pendingIslandCorrection || state.room?.pendingFleetAdjustment || state.room?.pendingLegendaryReaction); }
  function areAlliesClient(aId, bId) {
    return (state.room?.alliances || []).some(pair => (pair[0] === aId && pair[1] === bId) || (pair[0] === bId && pair[1] === aId));
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


  const MOBILE_TAB_TITLES = {
    actions: 'Действия',
    ship: 'Корабль и имущество',
    players: 'Игроки и отношения',
    log: 'Журнал партии',
  };

  function openMobileTab(tab = 'map') {
    closeGameAccountMenu();
    state.mobileTab = tab;
    const side = $('gameSidePanel');
    const isMap = tab === 'map';
    side.classList.toggle('mobile-open', !isMap);
    document.body.classList.toggle('mobile-sheet-open', !isMap);
    if (!isMap) {
      side.dataset.mobileTab = tab;
      $('mobileSheetTitle').textContent = MOBILE_TAB_TITLES[tab] || 'Раздел';
      side.scrollTop = 0;
    } else {
      delete side.dataset.mobileTab;
    }
    document.querySelectorAll('[data-mobile-nav]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mobileNav === tab);
    });
  }

  function cargoSummary(player, room) {
    if (!player) return { quantity: 0, capacity: 0 };
    const escortCatalog = room?.escortCatalog || {};
    const cargoEscorts = (player.escorts || []).filter(e => e.active && (escortCatalog[e.type]?.cargo || 0) > 0);
    const quantity = (player.cargo?.quantity || 0) + cargoEscorts.reduce((sum, e) => sum + (e.cargo?.quantity || 0), 0);
    return { quantity, capacity: player.totalCargoCapacity || player.cargoCapacity || 0 };
  }

  function renderMobileHud() {
    const r = state.room;
    if (!r) return;
    const mine = me();
    const activePlayer = active();
    $('hudResources').classList.toggle('hidden', !mine);
    $('mobileNavActions').classList.toggle('hidden', state.spectating);
    $('mobileNavShip').classList.toggle('hidden', state.spectating);

    if (mine) {
      const cargo = cargoSummary(mine, r);
      $('hudPlayerName').textContent = mine.name;
      $('hudShipLevel').textContent = `${SHIP_NAMES[mine.shipClass] || 'Корабль'} · ${ROMAN[mine.level] || mine.level}`;
      $('hudDucats').textContent = mine.ducats ?? 0;
      $('hudGlory').textContent = mine.glory ?? 0;
      $('hudCargo').textContent = `${cargo.quantity}/${cargo.capacity}`;
      $('hudDebtBtn').classList.toggle('hidden', !(mine.debt > 0));
      $('hudDebt').textContent = mine.debt || 0;
    } else {
      $('hudPlayerName').textContent = state.spectating ? 'Наблюдение' : 'Игрок';
      $('hudShipLevel').textContent = state.spectating ? `Комната ${r.code}` : '—';
      $('hudDebtBtn').classList.add('hidden');
    }

    $('hudRound').textContent = !r.started ? `Лобби · ${r.players.length}/${r.balanceCatalog.session.players.max}` : `Раунд ${r.round} · круг ${r.circle}/${r.balanceCatalog.session.circlesPerRound}`;
    $('hudTurn').textContent = !r.started
      ? 'Ожидание старта'
      : r.eventPhase?.active
        ? `События · ${playerName(r.eventPhase.currentPlayerId)}`
        : activePlayer
          ? (activePlayer.id === state.myId ? 'Ваш ход' : `Ход: ${activePlayer.name}`)
          : 'Ожидание';
    $('mobileNavActions').classList.toggle('attention', Boolean(isDecisionPending()));
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
    const pendingStatePrize = Boolean(r.pendingStatePrize);
    const pendingIslandCorrection = Boolean(r.pendingIslandCorrection);
    const pendingFleetAdjustment = Boolean(r.pendingFleetAdjustment);
    const pendingAssignment = Boolean(r.pendingAssignmentChoice?.viewerCanRespond);
    const activeAssignment = Boolean(mine?.activeAssignment);
    const onIsland = currentIslands().length > 0;
    const anchorRelevant = Boolean(currentAnchorCell());
    const pendingCombat = Boolean(r.pendingBattle || r.pendingLegendaryReaction);
    const myTurnActions = Boolean(r.started && mine && r.activePlayerId === state.myId && mine.phase === 'actions' && (mine.actionsLeft ?? 0) > 0);
    const seaTargets = mine ? r.players.some(p => p.id !== state.myId && p.row === mine.row && p.col === mine.col && !areAlliesClient(state.myId, p.id)) : false;
    const islandTargets = mine ? currentIslands().some(i => i.ownerId !== state.myId && !(i.kind === 'free' && !i.ownerId) && (!i.ownerId || !areAlliesClient(state.myId, i.ownerId))) : false;
    const combatRelevant = pendingCombat || (myTurnActions && !mine?.inPeaceZone && (seaTargets || islandTargets));

    set('.controls', true, 20);
    set('.event-panel', Boolean(r.eventPhase?.active || pendingEventForMe), pendingEventForMe ? 1 : 12);
    set('.state-prize-panel', pendingStatePrize, r.pendingStatePrize?.viewerCanRespond ? 0 : 4);
    set('.island-correction-panel', pendingIslandCorrection, r.pendingIslandCorrection?.viewerCanRespond ? 0 : 4);
    set('.fleet-adjustment-panel', pendingFleetAdjustment, r.pendingFleetAdjustment?.viewerCanRespond ? 0 : 4);
    set('.assignment-panel', pendingAssignment || activeAssignment, pendingAssignment ? 2 : 30);
    set('.anchor-panel', anchorRelevant, 40);
    set('.island-panel', onIsland, 25);
    set('.combat-panel', combatRelevant, pendingCombat ? 3 : 27);

    const visible = [...document.querySelectorAll('#gameSidePanel [data-ui-tab="actions"]:not(.context-hidden)')];
    const actionNav = $('mobileNavActions');
    actionNav.dataset.count = String(Math.max(0, visible.length - 1));
    actionNav.setAttribute('aria-label', visible.length > 1 ? `Действия, доступно разделов: ${visible.length}` : 'Действия');
  }

  function render() {
    const r = state.room;
    if (!r) return;
    setGameScreenActive(true);
    $('entry').classList.add('hidden');
    $('game').classList.remove('hidden');
    $('roomCode').textContent = r.code;
    $('roundLabel').textContent = !r.started ? 'Лобби' : r.eventPhase?.active ? `Раунд ${r.round} · общая Фаза событий` : `Раунд ${r.round} · круг ${r.circle}/${r.balanceCatalog.session.circlesPerRound}`;
    const a = active();
    const eventPlayer = r.eventPhase?.currentPlayerId ? r.players.find(p => p.id === r.eventPhase.currentPlayerId) : null;
    $('turnLabel').textContent = !r.started ? `Игроков: ${r.players.length}/${r.balanceCatalog.session.players.max}` : r.eventPhase?.active ? `Событие: ${eventPlayer?.name || '—'}` : (a ? `Ход: ${a.name}` : '—');

    const mine = me();
    renderMobileHud();
    if (mine) {
      const cards = mine.specialCards?.length ? ` · особые карты: ${mine.specialCards.join(', ')}` : '';
      const cargo = mine.landCompany ? ` · трюм: рота +${mine.landCompany.army}` : (mine.cargo ? ` · трюм: ${state.room.goodsCatalog?.[mine.cargo.goodId]?.name || mine.cargo.goodId} ×${mine.cargo.quantity}` : ' · трюм пуст');
      const eventHand = mine.savedEventCardCount ? ` · событий в руке: ${mine.savedEventCardCount}` : '';
      const legendary = mine.legendaryCardCount ? ` · легендарных: ${mine.legendaryCardCount}` : '';
      const skip = mine.skipTurns ? ` · пропусков хода: ${mine.skipTurns}` : '';
      const suzerain = mine.suzerainId ? r.factions?.find(f => f.id === mine.suzerainId)?.name : null;
      const politics = suzerain ? ` · вассал: ${suzerain}` : (mine.enemyFactionIds?.length ? ` · вражда: ${mine.enemyFactionIds.length}` : '');
      $('youStatus').innerHTML = `<strong>${escapeHtml(mine.name)}</strong><br><span class="muted">${SHIP_NAMES[mine.shipClass]} ${ROMAN[mine.level] || mine.level} · ${mine.ducats} дукатов${mine.debt ? ` · долг ${mine.debt}` : ''} · слава ${mine.glory || 0} · островов ${mine.islandCount} · клетка ${mine.col + 1}:${mine.row + 1}${escapeHtml(cargo)}${escapeHtml(cards)}${escapeHtml(eventHand)}${escapeHtml(legendary)}${escapeHtml(skip)}${escapeHtml(politics)}</span>`;
    }

    renderPlayers();
    renderControls();
    renderMapNavigation();
    renderMapContext();
    renderEvents();
    renderPolitics();
    renderStatePrize();
    renderIslandCorrection();
    renderFleetAdjustment();
    renderAssignments();
    renderLegendary();
    renderFleet();
    renderTrade();
    renderAnchors();
    renderIsland();
    renderAlliances();
    renderCombat();
    renderMap();
    renderLog();
    updateContextualActionPanels();
  }

  function renderPlayers() {
    const r = state.room;
    $('players').innerHTML = '';
    const isHost = r.hostId === state.myId;
    const isSpectator = state.spectating;
    r.players.forEach(p => {
      const order = r.started ? r.order.indexOf(p.id) + 1 : null;
      const el = document.createElement('div');
      el.className = 'player-card';
      const cargoLabel = p.landCompany ? ` · рота +${p.landCompany.army}` : (p.cargo ? ` · груз ${state.room.goodsCatalog?.[p.cargo.goodId]?.name || p.cargo.goodId} ×${p.cargo.quantity}` : '');
      const suzerainName = p.suzerainId ? state.room.factions?.find(f => f.id === p.suzerainId)?.name : null;
      const politicalLabel = suzerainName ? ` · вассал ${suzerainName}` : (p.enemyFactionIds?.length ? ` · вражда ${p.enemyFactionIds.length}` : '');
      const readyLabel = !r.started ? (p.ready ? ' · ✓ готов' : ' · не готов') : '';
      el.innerHTML = `<span class="player-dot" style="background:${p.color}"></span><div class="player-meta"><div class="player-name">${escapeHtml(p.name)}${p.isYou ? ' · вы' : ''}${!p.connected ? ' · офлайн' : ''}${readyLabel}</div><div class="player-sub">${SHIP_NAMES[p.shipClass]} ${ROMAN[p.level] || p.level} · ${p.ducats} дукатов${p.debt ? ` · долг ${p.debt}` : ''} · слава ${p.glory || 0} · островов ${p.islandCount} · эскорт ${p.escorts?.length || 0}${p.skipTurns ? ` · пропуск ${p.skipTurns}` : ''}${escapeHtml(cargoLabel)}${escapeHtml(politicalLabel)}</div></div><div class="player-side-actions"><span class="order-badge">${order ? `#${order}` : ''}</span></div>`;
      if (!isSpectator && !r.started && p.isYou) {
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
    const allReady = r.players.length >= 2 && r.players.every(p => p.ready && p.connected);
    const waitingReady = r.players.filter(p => !p.ready || !p.connected).length;
    $('startBtn').classList.toggle('hidden', isSpectator || r.started || !isHost);
    $('startBtn').disabled = r.players.length < r.balanceCatalog.session.players.min || r.players.length > r.balanceCatalog.session.players.max || !allReady;
    $('startBtn').textContent = r.players.length < r.balanceCatalog.session.players.min ? 'Нужен ещё 1 игрок' : (!allReady ? `Ждём готовности: ${waitingReady}` : 'Начать игру');

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

    const addAction = (label, tab, className = '') => {
      const b = document.createElement('button');
      b.type = 'button';
      if (className) b.className = className;
      b.textContent = label;
      b.addEventListener('click', () => openMobileTab(tab));
      actions.appendChild(b);
    };

    if (blocked) {
      let label = 'Требуется решение';
      if (r.pendingBattle?.viewerInvite) label = 'Решение по совместному бою';
      else if (r.pendingEvent?.viewerCanRespond) label = 'Решение по событию';
      else if (r.pendingFeud?.viewerCanRespond) label = 'Решение по вражде';
      else if (r.pendingAssignmentChoice?.viewerCanRespond) label = 'Решение по поручению';
      else if (r.pendingStatePrize?.viewerCanRespond) label = 'Размещение приза';
      else if (r.pendingIslandCorrection?.viewerCanRespond) label = 'Исправление острова';
      else if (r.pendingFleetAdjustment?.viewerCanRespond) label = 'Настройка флотилии';
      else if (r.pendingLegendaryReaction) label = 'Решение по легендарной карте';
      title.textContent = label;
      text.textContent = 'Продолжение хода ждёт вашего выбора.';
      addAction('Открыть решение', 'actions', 'primary');
      overlay.classList.remove('hidden');
      return;
    }

    const hereIslands = currentIslands();
    const hereIsland = hereIslands.find(i => i.id === state.selectedIslandId) || hereIslands[0] || null;
    const hereAnchor = currentAnchorCell();
    const hereLegendary = currentLegendaryPlace();
    const seaTargets = r.players.filter(p => p.id !== state.myId && p.row === mine.row && p.col === mine.col && !areAlliesClient(state.myId, p.id));
    const islandTargets = hereIslands.filter(i => i.ownerId !== state.myId && !(i.kind === 'free' && !i.ownerId) && (!i.ownerId || !areAlliesClient(state.myId, i.ownerId)));

    if (mine.atCitadel) {
      title.textContent = 'Цитадель';
      text.textContent = `Торговля, улучшения и сопровождение · действий осталось: ${mine.actionsLeft ?? 0}`;
      addAction('Корабль и торговля', 'ship', 'primary');
      overlay.classList.remove('hidden');
      return;
    }

    if (hereIsland) {
      state.selectedIslandId = hereIsland.id;
      title.textContent = hereIsland.name;
      if (hereIsland.ownerId === state.myId) {
        text.textContent = `Ваш остров · действий осталось: ${mine.actionsLeft ?? 0}`;
        addAction('Управление островом', 'actions', 'primary');
      } else {
        const owner = islandOwnerLabel(hereIsland);
        text.textContent = `${owner} · защита ${hereIsland.defenseArmy ?? hereIsland.army ?? 0} · действий: ${mine.actionsLeft ?? 0}`;
        if (islandTargets.length && !mine.inPeaceZone) addAction('Штурм и действия', 'actions', 'danger-soft');
        else addAction('Информация', 'actions');
      }
      if (seaTargets.length && !mine.inPeaceZone) addAction('Морской бой', 'actions', 'danger-soft');
      overlay.classList.remove('hidden');
      return;
    }

    if (seaTargets.length && !mine.inPeaceZone) {
      title.textContent = 'Корабль противника рядом';
      text.textContent = `Целей: ${seaTargets.length} · ваша артиллерия: ${mine.fleetArtillery ?? 0}`;
      addAction('Открыть морской бой', 'actions', 'danger-soft');
      overlay.classList.remove('hidden');
      return;
    }

    if (hereAnchor) {
      const encounter = mine.lastAnchorEncounter;
      title.textContent = hereAnchor.name;
      if (encounter) {
        const outcome = encounter.outcome === 'win' ? 'Победа' : encounter.outcome === 'loss' ? 'Поражение' : encounter.outcome === 'tie' ? 'Ничья' : 'Тихое море';
        text.textContent = `${outcome} · результат столкновения уже разыгран автоматически`;
        addAction('Посмотреть результат', 'actions');
      } else {
        text.textContent = 'Столкновение на якоре разыгрывается автоматически при остановке.';
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

    const dock = $('mobileActionDock');
    const mapNavigationActive = myTurn && phase === 'navigation' && !blocked;
    dock.classList.toggle('hidden', state.spectating || !r.started || !myTurn || mapNavigationActive || blocked);
    $('dockRollBtn').disabled = $('rollBtn').disabled;
    $('dockSkipBtn').disabled = $('skipBtn').disabled;
    $('dockEndTurnBtn').disabled = $('endTurnBtn').disabled;
    $('dockRollBtn').classList.add('hidden');
    $('dockSkipBtn').classList.add('hidden');
    $('dockEndTurnBtn').classList.toggle('hidden', !myTurn || phase !== 'actions' || blocked);

    if (!r.started) $('moveResult').textContent = 'Выберите корабль, затем каждый игрок нажимает «Готов». Когда все онлайн и готовы, создатель запускает партию.';
    else if (r.eventPhase?.active) $('moveResult').textContent = r.pendingIslandCorrection?.viewerCanRespond ? `Остров ${r.pendingIslandCorrection.islandName} нужно немедленно исправить перед продолжением Фазы событий.` : r.pendingIslandCorrection ? `Фаза событий приостановлена: ${playerName(r.pendingIslandCorrection.playerId)} исправляет остров ${r.pendingIslandCorrection.islandName}.` : r.pendingAssignmentChoice?.viewerCanRespond ? 'Нужно решить, оставить или заменить поручение сюзерена.' : r.pendingFeud?.viewerCanRespond ? 'Нужно разрешить вашу карту вражды.' : r.pendingEvent?.viewerCanRespond ? 'Нужно принять решение по вашей карте события.' : `Идёт общая Фаза событий: ${playerName(r.eventPhase.currentPlayerId)}.`;
    else if (r.pendingStatePrize?.viewerCanRespond) $('moveResult').textContent = 'Разместите призовую постройку за полное подчинение государства.';
    else if (r.pendingStatePrize) $('moveResult').textContent = `Ожидается размещение итогового приза игроком ${playerName(r.pendingStatePrize.playerId)}.`;
    else if (r.pendingIslandCorrection?.viewerCanRespond) $('moveResult').textContent = `Остров ${r.pendingIslandCorrection.islandName} нужно немедленно привести к допустимым ограничениям.`;
    else if (r.pendingIslandCorrection) $('moveResult').textContent = `Ожидается исправление острова ${r.pendingIslandCorrection.islandName} игроком ${playerName(r.pendingIslandCorrection.playerId)}.`;
    else if (!myTurn) $('moveResult').textContent = aText();
    else if (phase === 'navigation' && mine.roll === null) $('moveResult').textContent = 'Можно бросить d6 или остаться на месте.';
    else if (phase === 'navigation') $('moveResult').textContent = `d6 = ${mine.roll}. Дальность ${mine.movePoints}; подсвечены только клетки, куда реально можно доплыть.`;
    else if (r.pendingAlliance) $('moveResult').textContent = 'Ожидается решение по предложению союза.';
    else if (r.pendingBattle) $('moveResult').textContent = 'Совместный бой ожидает ответов приглашённых союзников.';
    else $('moveResult').textContent = `Навигация завершена. Действий осталось: ${mine.actionsLeft}.`;
  }

  function aText() {
    if (state.room?.eventPhase?.active) return `Идёт общая Фаза событий: ${playerName(state.room.eventPhase.currentPlayerId)}.`;
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

    const decks = r.eventDecks || {};
    const sailing = decks.sailing || { remaining: 0, discard: 0 };
    const treasure = decks.treasure || { remaining: 0, discard: 0 };
    const legendary = decks.legendary || { remaining: 0, discard: 0 };
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

    const stageLabel = phase?.stage === 'feud' ? 'вражда' : phase?.stage === 'assignment' ? 'поручения' : phase?.stage === 'assignment-replace' ? 'замена поручений' : 'плавание';
    badge.textContent = phase?.active ? (phase.stage === 'feud' ? `вражда ${(phase.feudIndex || 0) + 1}/${phase.feudTotal || 0}` : phase.stage === 'assignment' ? `поручения ${(phase.assignmentIndex || 0) + 1}/${phase.assignmentTotal || 0}` : phase.stage === 'assignment-replace' ? `замена ${(phase.replacementIndex || 0) + 1}/${phase.replacementTotal || 0}` : `${(phase.playerIndex || 0) + 1}/${phase.totalPlayers || r.players.length}`) : `${sailing.remaining}`;
    const feudCounts = Object.entries(r.feudDecks || {}).map(([id,d]) => `${r.factions?.find(f => f.id === id)?.name || id}: ${d.remaining}`).join(' · ');
    let html = `<div class="event-decks">События: ${sailing.remaining} / сброс ${sailing.discard} · сокровища: ${treasure.remaining} / ${treasure.discard} · легендарные: ${legendary.remaining}</div>${feudCounts ? `<div class="event-decks">Вражда: ${escapeHtml(feudCounts)}</div>` : ''}`;
    if (phase?.active) {
      const currentName = playerName(phase.currentPlayerId);
      html += `<div class="event-current"><strong>Общая Фаза событий · ${escapeHtml(stageLabel)}</strong><br>Текущий игрок: ${escapeHtml(currentName)}.</div>`;
      if (phase.lastCard) html += `<div class="event-card-line">Последняя карта: <strong>«${escapeHtml(phase.lastCard.cardName)}»</strong>${phase.lastCard.factionName ? ` · ${escapeHtml(phase.lastCard.factionName)}` : ''}${phase.lastCard.pending ? ' · ожидает выбора' : ''}.</div>`;
    } else {
      html += '<div class="event-current">После пятого круга раунда каждый игрок получает одну карту события плавания в постоянном порядке.</div>';
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
      if (pending.kind === 'cargo') {
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
      if (pendingFeud.kind === 'reclaim-island') {
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
    if (!mine.cargo) emptyHolds.push({ id: 'main', name: `Основной трюм (${mine.cargoCapacity})` });
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
    if (suzerain) html += `<div class="event-current"><strong>Сюзерен: ${escapeHtml(suzerain.name)}</strong>${suzerain.tax ? `<br>Налог: ${suzerain.tax} дуката в начале общей Фазы событий.` : '<br>Денежного налога за раунд нет.'}</div>`;
    if (enemies.size) html += `<div class="event-effect"><strong>Вражда:</strong> ${[...enemies].map(id => escapeHtml(r.factions?.find(f => f.id === id)?.name || id)).join(', ')}.</div>`;
    html += (r.factions || []).map(f => {
      const vassal = f.vassalPlayerId ? playerName(f.vassalPlayerId) : 'нет';
      const state = f.exists ? 'существует' : 'прекратило существование';
      const relation = mine.suzerainId === f.id ? ' · ваш сюзерен' : enemies.has(f.id) ? ' · ВРАЖДА' : '';
      const gift = f.giftIslandName ? ` · передаваемый остров: ${escapeHtml(f.giftIslandName)}` : '';
      const prize = f.fullConquestPrize;
      const prizeText = prize ? ` · итоговый приз: сохранить — ${(prize.preserveBuildings || []).map(b => escapeHtml(b.name)).join(' + ') || '—'}; разорить — ${prize.razeDucats} дукатов` : '';
      const claimed = f.fullConquestClaimed ? ` · приз уже получен: ${escapeHtml(playerName(f.fullConquestPlayerId))}` : '';
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



  function renderStatePrize() {
    const r = state.room;
    const mine = me();
    const badge = $('statePrizeBadge');
    const content = $('statePrizeContent');
    const actions = $('statePrizeActions');
    if (!badge || !content || !actions) return;
    actions.innerHTML = '';
    const pending = r?.pendingStatePrize;

    if (!r?.started) {
      badge.textContent = '—';
      content.textContent = 'Итоговый приз появится при первом полном подчинении государства.';
      return;
    }
    if (!pending) {
      const claimed = (r.factions || []).filter(f => f.fullConquestClaimed);
      badge.textContent = claimed.length ? `получено ${claimed.length}` : 'ожидание';
      content.innerHTML = claimed.length
        ? `<div class="event-current">Уже выданы: ${claimed.map(f => `${escapeHtml(f.name)} — ${escapeHtml(playerName(f.fullConquestPlayerId))}`).join('<br>')}</div>`
        : '<div class="event-current">Приз выдаётся один раз за партию, когда один игрок впервые получает контроль над всеми исходными островами государства военным захватом последнего острова.</div>';
      return;
    }

    const current = pending.currentBuilding;
    badge.textContent = pending.viewerCanRespond ? `разместить ${pending.remaining}` : 'ожидание';
    if (!pending.viewerCanRespond) {
      content.innerHTML = `<div class="event-current"><strong>${escapeHtml(playerName(pending.playerId))}</strong> размещает итоговый приз ${escapeHtml(pending.factionName)}.</div>`;
      return;
    }

    const lostText = pending.lost?.length ? `<div class="event-effect">Уже не удалось разместить: ${pending.lost.map(escapeHtml).join(', ')}.</div>` : '';
    content.innerHTML = `<div class="event-current"><strong>${escapeHtml(pending.factionName)}</strong><br>Разместите ${escapeHtml(current?.name || 'наградную постройку')} на любом своём острове. Осталось зданий: ${pending.remaining}.</div><div class="cargo-meta">Приз не требует фермы, форта или нахождения корабля на острове, но должен помещаться по площади и пределу ветви.</div>${lostText}`;

    for (const option of pending.options || []) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'build-btn primary';
      b.textContent = `${option.islandName} · площадь ${option.afterUsedArea}/${option.afterEffectiveArea} · ${option.status}`;
      b.addEventListener('click', () => socket.emit('placeStatePrizeBuilding', { prizeId: pending.id, islandId: option.islandId }, handleGameAck));
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

    const report = pending.report || {};
    const branches = (report.branchViolations || []).map(v => `${escapeHtml(v.name)}: ${v.count}/${v.limit}`).join(' · ');
    const area = report.overArea > 0 ? `Площадь: <strong>${report.usedArea}/${report.effectiveArea}</strong> — нужно освободить минимум ${report.overArea}.` : `Площадь: ${report.usedArea}/${report.effectiveArea}.`;
    badge.textContent = pending.viewerCanRespond ? 'обязательно' : 'ожидание';

    if (!pending.viewerCanRespond) {
      content.innerHTML = `<div class="event-current"><strong>${escapeHtml(pending.islandName)}</strong><br>${escapeHtml(playerName(pending.playerId))} должен удалить лишние постройки.</div><div class="event-effect">Статус: ${escapeHtml(report.status || '—')} · ${area}${branches ? `<br>Превышение ветвей: ${branches}.` : ''}</div>`;
      return;
    }

    const removed = pending.removed?.length ? `<div class="cargo-meta">Уже удалено: ${pending.removed.map(escapeHtml).join(', ')}.</div>` : '';
    content.innerHTML = `<div class="event-current"><strong>${escapeHtml(pending.islandName)}</strong> · статус «${escapeHtml(report.status || '—')}»<br>${escapeHtml(pending.reason || '')}</div><div class="event-effect">${area}${branches ? `<br>Превышение ветвей: ${branches}.` : ''}</div><div class="cargo-meta">Удаляйте выбранные постройки без компенсации, пока одновременно не будут соблюдены площадь и предел каждой обычной ветви.</div>${removed}`;

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
      content.innerHTML = '<div class="event-current">Флотилия соответствует текущим ограничениям.</div><div class="cargo-meta">Здесь появится выбор при потере уровня, места верфи или при получении особого сопровождения Ландина с уже заполненным пределом трёх судов.</div>';
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
    if (pending.stage === 'upgrades' || pending.stage === 'escorts') {
      instruction = `Выберите ровно <strong>${pending.required}</strong> ${pending.stage === 'upgrades' ? 'улучшений' : 'судов сопровождения'}, которые временно не будут действовать.`;
      note = pending.stage === 'escorts' ? 'Неактивное сопровождение продолжает следовать за флотилией; уже погруженный груз сохраняется.' : 'Улучшения остаются установленными и снова включатся, когда мест станет достаточно.';
    } else if (pending.stage === 'shipyard-remove') {
      instruction = `Выберите ровно <strong>${pending.required}</strong> обычных судов сопровождения для окончательного удаления.`;
      note = 'Это не временное отключение: выбранные суда уничтожаются из-за нехватки мест верфи. Их груз также пропадает.';
    } else if (pending.stage === 'landin-replace') {
      instruction = 'Выберите <strong>одно</strong> имеющееся судно, которое заменит особое сопровождение Ландина.';
      note = `Сопровождение Ландина: +${r.escortCatalog.landin.artillery} артиллерии, трюм ${r.escortCatalog.landin.cargo}. Груз заменённого судна пропадёт.`;
    }
    content.innerHTML = `<div class="event-current"><strong>Обязательное решение по флотилии</strong><br>${escapeHtml(pending.reason || '')}</div><div class="event-effect">${instruction}</div>${note ? `<div class="cargo-meta">${escapeHtml(note)}</div>` : ''}`;

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
        } else {
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
    const suzerain = mine.suzerainId ? r.factions?.find(f => f.id === mine.suzerainId) : null;
    badge.textContent = assignment ? 'активно' : (suzerain ? 'ожидание' : 'нет');
    const deck = suzerain ? r.assignmentDecks?.[suzerain.id] : null;
    let html = '';
    if (!suzerain) {
      html = '<div class="event-current">Вы не состоите в подданстве. Поручения выдаются только вассалам Лионии, Кадингира, Суниксии и пиратов.</div>';
    } else if (assignment) {
      const share = Number(suzerain.rewardShare) || 0;
      const withheld = share ? Math.floor(assignment.reward * share) : 0;
      const net = assignment.reward - withheld;
      html = `<div class="event-current"><strong>${escapeHtml(suzerain.name)}</strong><br>«${escapeHtml(assignment.text)}»</div><div class="event-effect">Награда: ${assignment.reward} дукатов${withheld ? ` · сюзерен удержит ${withheld}, вам ${net}` : ''}.</div>`;
      if (assignment.type === 'delivery') html += `<div class="cargo-meta">Для доставки засчитывается только полный трюм, полученный после выдачи этого поручения. Подходящая продажа в Цитадели автоматически получает контрактную премию +${r.balanceCatalog.contractBonusRatio * 100}%.</div>`;
      if (mine.replacedAssignmentConditions?.length) html += `<div class="cargo-meta">Уже платно заменённых условий: ${mine.replacedAssignmentConditions.length}.</div>`;
    } else {
      html = `<div class="event-current"><strong>${escapeHtml(suzerain.name)}</strong><br>Активного поручения нет. Новое выдаётся в ближайшей общей Фазе событий по правилам.</div>`;
    }
    if (deck) html += `<div class="event-decks">Колода поручений: ${deck.remaining} · сброс: ${deck.discard}</div>`;
    content.innerHTML = html;

    const pending = r.pendingAssignmentChoice;
    if (pending?.viewerCanRespond) {
      const label = document.createElement('div');
      label.className = 'action-group-label';
      label.textContent = `Оставить поручение «${pending.assignment?.text || 'текущее'}» или заменить за ${r.balanceCatalog.assignmentReplacementPrice} дуката?`;
      actions.appendChild(label);
      const keep = document.createElement('button');
      keep.type = 'button'; keep.className = 'build-btn'; keep.textContent = 'Оставить поручение';
      keep.addEventListener('click', () => socket.emit('respondAssignmentChoice', { choiceId: pending.id, replace: false }, handleGameAck));
      actions.appendChild(keep);
      const repl = document.createElement('button');
      repl.type = 'button'; repl.className = 'build-btn primary'; repl.textContent = `Заменить за ${r.balanceCatalog.assignmentReplacementPrice} дуката`; repl.disabled = !pending.canReplace;
      repl.title = pending.replaceError || '';
      repl.addEventListener('click', () => socket.emit('respondAssignmentChoice', { choiceId: pending.id, replace: true }, handleGameAck));
      actions.appendChild(repl);
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
      const what = reaction.kind === 'sea-attack' ? `морскую атаку ${source}` : reaction.kind === 'assault' ? `штурм ${island?.name || 'острова'} игроком ${source}` : `«Пламя Ада» против ${island?.name || 'острова'} от ${source}`;
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
      'sea-veil': 'Защитить свою флотилию или один свой остров на три следующих личных хода.',
      hellfire: 'На клетке чужого острова понизить каждую постройку выше I уровня на одну ступень.',
      'mist-path': 'Перенести флотилию на любую клетку, достижимую без запрещённых препятствий.',
      'sea-curse': 'На одной клетке с чужим кораблём дать −3 к обычному движению на три следующих личных хода.',
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
          const blocked = !canUse || mine.inPeaceZone || Boolean(island.legendaryVeil?.remaining) || (owner && (r.round === 1 || areAlliesClient(state.myId, owner.id)));
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'danger-soft'; b.textContent = `Пламя → ${island.name}${island.legendaryVeil?.remaining ? ' · под Покровом' : ''}`; b.disabled = blocked;
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
      </div>
      <div class="building-line"><span class="muted">Улучшения:</span> ${escapeHtml(upgradeNames)}</div>
      <div class="building-line"><span class="muted">Сопровождение:</span> ${escapeHtml(escortNames)}</div>
      <div class="citadel-note">${mine.atCitadel ? 'Вы в Цитадели: доступны покупки флота, городской стражи и постоянных гарнизонов.' : 'Покупки уровней, улучшений, сопровождения и гарнизонов выполняются только в Цитадели.'}</div>`;

    const myTurn = state.room.started && state.room.activePlayerId === state.myId;
    const canAct = myTurn && mine.phase === 'actions' && (mine.actionsLeft ?? 0) > 0 && !isDecisionPending();
    const canBuyHere = canAct && mine.atCitadel;
    const myTurnAnyPhase = myTurn && ['navigation', 'actions'].includes(mine.phase) && !isDecisionPending();

    if (mine.landCompany) {
      const companyLabel = document.createElement('div');
      companyLabel.className = 'action-group-label';
      companyLabel.textContent = 'Рота ландскнехтов';
      actions.appendChild(companyLabel);
      const dismiss = document.createElement('button');
      dismiss.type = 'button';
      dismiss.className = 'build-btn danger-soft';
      dismiss.textContent = `Распустить роту +${mine.landCompany.army} · бесплатно`;
      dismiss.disabled = !myTurnAnyPhase;
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
      const bonus = [u.artillery ? `арт. +${u.artillery}` : '', u.army ? `войско +${u.army}` : '', u.cargo ? `трюм +${u.cargo}` : '', u.movement ? `ход +${u.movement}` : ''].filter(Boolean).join(', ');
      b.textContent = `${u.name} · ${u.price} дук.${bonus ? ` · ${bonus}` : ''}`;
      const dependencyOk = !u.requires || installedIds.has(u.requires);
      const slotOk = upgrades.length < mine.upgradeSlots;
      b.disabled = !canBuyHere || mine.ducats < u.price || !dependencyOk || !slotOk;
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
    const guardTargets = ownedSettlements.filter(i => ['Город', 'Крупный порт'].includes(i.status) && !i.garrisonType);
    const permanentTargets = ownedSettlements.filter(i => i.status === 'Крупный порт' && i.garrisonType === 'guard');
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
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'build-btn';
        b.textContent = `Постоянный гарнизон → ${island.name} · ${state.room.balanceCatalog.garrisons.permanentUpgrade.price} дук. · +${state.room.balanceCatalog.garrisons.permanentUpgrade.defense} защиты`;
        b.disabled = !canBuyHere || mine.ducats < state.room.balanceCatalog.garrisons.permanentUpgrade.price;
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
      b.addEventListener('click', () => socket.emit('sellCargo', { holdId: e.id }, handleGameAck));
      escortActions.appendChild(b);
    }
  }


  function renderAnchors() {
    const mine = me();
    const content = $('anchorContent');
    const badge = $('anchorBadge');
    if (!mine) {
      badge.textContent = '—';
      content.textContent = 'Данные якорей недоступны.';
      return;
    }

    const cells = state.room.anchorCells || [];
    const here = cells.find(a => a.row === mine.row && a.col === mine.col) || null;
    const visitedHere = here && (mine.visitedAnchors || []).includes(`${mine.row},${mine.col}`);
    const encounter = here ? mine.lastAnchorEncounter : null;
    const decks = state.room.anchorDecks || {};
    const deckLine = ['blue','yellow','red'].map(color => {
      const label = color === 'blue' ? 'Синяя' : color === 'yellow' ? 'Жёлтая' : 'Красная';
      const d = decks[color] || { remaining: 0, discard: 0 };
      return `${label}: ${d.remaining} в колоде / ${d.discard} в сбросе`;
    }).join(' · ');

    badge.textContent = here ? (visitedHere ? 'посещён' : 'якорь') : 'море';
    let html = `<div class="anchor-decks">${escapeHtml(deckLine)}</div>`;
    if (here) {
      html += `<div class="anchor-note"><strong>${escapeHtml(here.name)}</strong> · победа даёт ${here.glory} славы. ${visitedHere ? 'Эта клетка уже разыграна вами в текущем раунде.' : 'Если навигация только что завершилась здесь, карта разыгрывается автоматически.'}</div>`;
    } else {
      html += '<div class="anchor-note">Карту получают только при остановке на клетке якоря после навигации. Простое прохождение через клетку не срабатывает.</div>';
    }

    if (encounter) {
      const outcome = encounter.outcome === 'win' ? 'Победа' : encounter.outcome === 'loss' ? 'Поражение' : encounter.outcome === 'tie' ? 'Ничья' : 'На море тихо';
      const enemy = encounter.cardArtillery == null ? '—' : encounter.cardArtillery;
      let effect = '';
      if (encounter.outcome === 'win') {
        const gross = encounter.reward?.gross ?? encounter.rewardValue ?? 0;
        const paid = encounter.reward?.debtPaid || 0;
        effect = `Награда ${gross} дукатов${paid ? `; ${paid} ушло в долг` : ''}. Слава +${encounter.glory || 0}.`;
      } else if (encounter.outcome === 'loss') {
        const p = encounter.penalty || {};
        effect = `Штраф ${p.required || 0}: уплачено ${p.paid || 0}${p.addedDebt ? `, долг +${p.addedDebt}` : ''}.`;
      } else if (encounter.outcome === 'tie') {
        effect = 'Награды нет; следующий личный ход будет пропущен.';
      } else {
        effect = 'Действие не расходуется.';
      }
      html += `<div class="anchor-result"><strong>Последнее столкновение:</strong><br>${escapeHtml(encounter.anchorName)} · «${escapeHtml(encounter.cardName)}» · артиллерия ${enemy}<br>Флотилия ${encounter.fleetPower} · ${outcome}. ${escapeHtml(effect)}</div>`;
    }
    content.innerHTML = html;
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
    const defense = Number(island.defenseArmy) || 0;
    const defenseParts = island.defenseBreakdown || {};

    box.innerHTML = `${switcher}<div class="island-name">${escapeHtml(island.name)}</div>
      <div class="island-grid">
        <span>Владелец</span><strong>${escapeHtml(islandOwnerLabel(island))}</strong>
        <span>Статус</span><strong>${escapeHtml(island.status)}</strong>
        <span>Площадь</span><strong>${island.usedArea}/${island.effectiveArea}</strong>
        <span>Ресурсы</span><strong>${escapeHtml(resources)}</strong>
        <span>Исходное войско</span><strong>${island.army}</strong>
        <span>Текущая защита</span><strong>${defense}</strong>
        <span>Исходный / нанятый / укрепления / бастион / корабль</span><strong>${defenseParts.garrison || 0} / ${defenseParts.hiredGarrison || 0} / ${defenseParts.fortifications || 0} / ${defenseParts.bastions || 0} / ${defenseParts.ownerShip || 0}</strong>
      </div>
      <div class="building-line"><span class="muted">Городской отряд:</span> ${escapeHtml(island.garrisonName || 'нет')}</div>
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
            socket.emit('loadCargo', { islandId: island.id, goodId, holdId: hold.id }, handleGameAck);
          });
          actions.appendChild(button);
        }
      }
    }

    const bastion = island.buildings.find(b => b.type === 'bastion');
    const arsenal = island.buildings.filter(b => b.type === 'arsenal').sort((a, b) => b.level - a.level)[0];
    if (arsenal || bastion || (mine?.bastionSupportCapacity || 0) > (mine?.bastionCount || 0)) {
      const militaryLabel = document.createElement('div');
      militaryLabel.className = 'action-group-label';
      militaryLabel.textContent = 'Военная инфраструктура';
      actions.appendChild(militaryLabel);
      if (arsenal) {
        const companyBtn = document.createElement('button');
        companyBtn.type = 'button'; companyBtn.className = 'build-btn';
        companyBtn.textContent = mine?.landCompany ? `Рота уже снаряжена · +${mine.landCompany.army}` : `Снарядить роту · Арсенал ${ROMAN[arsenal.level] || arsenal.level} · +${(arsenal.level || 1) + 2} войска`;
        companyBtn.disabled = !canAct || Boolean(mine?.landCompany) || Boolean(mine?.cargo);
        companyBtn.addEventListener('click', () => socket.emit('formLandCompany', { islandId: island.id }, handleGameAck));
        actions.appendChild(companyBtn);
      }
      if (!bastion) {
        const bastionBtn = document.createElement('button');
        bastionBtn.type = 'button'; bastionBtn.className = 'build-btn';
        bastionBtn.textContent = `Бастион · ${state.room.balanceCatalog.bastion.price} дук. · +${state.room.balanceCatalog.bastion.defense} защиты`;
        bastionBtn.disabled = !canAct || mine.ducats < state.room.balanceCatalog.bastion.price || (mine.bastionCount || 0) >= (mine.bastionSupportCapacity || 0);
        bastionBtn.addEventListener('click', () => emitDataAction(bastionBtn, 'buildBastion', { islandId: island.id }));
        actions.appendChild(bastionBtn);
      } else if (!bastion.supported && (mine?.bastionSupportCapacity || 0) > 0) {
        const supportBtn = document.createElement('button');
        supportBtn.type = 'button'; supportBtn.className = 'build-btn primary';
        supportBtn.textContent = 'Перенести поддержку на этот бастион · бесплатно';
        supportBtn.disabled = !(myTurn && ['navigation', 'actions'].includes(mine?.phase) && !isDecisionPending());
        supportBtn.addEventListener('click', () => socket.emit('prioritizeBastionSupport', { islandId: island.id }, handleGameAck));
        actions.appendChild(supportBtn);
      }
    }

    const catalog = state.room.buildingCatalog || {};
    const buildLabel = document.createElement('div');
    buildLabel.className = 'action-group-label';
    buildLabel.textContent = 'Строительство';
    actions.appendChild(buildLabel);
    const ordered = ['farm', 'lumbermill', 'quarry', 'mine', 'fort', 'market', 'exotic', 'slaves', 'gold', 'diamonds'];
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
        socket.emit('build', { islandId: island.id, buildingType: id }, handleGameAck);
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
          socket.emit('upgradeBuilding', { islandId: island.id, buildingIndex: b.index }, handleGameAck);
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
    const sameCellPlayers = r.players.filter(p => p.id !== state.myId && p.row === mine.row && p.col === mine.col && !areAlliesClient(state.myId, p.id));
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
    badge.textContent = mine.inPeaceZone ? 'зона мира' : `арт. ${mine.fleetArtillery} · штурм ${mine.assaultArmy ?? mine.stats?.army ?? 0}`;

    const seaTargets = r.players.filter(p => p.id !== state.myId && p.row === mine.row && p.col === mine.col && !areAlliesClient(state.myId, p.id));
    const islandTargets = currentIslands().filter(i => i.ownerId !== state.myId && !(i.kind === 'free' && !i.ownerId) && (!i.ownerId || !areAlliesClient(state.myId, i.ownerId)));

    const notes = [];
    if (mine.inPeaceZone) notes.push('Зона мира Цитадели: морские бои и штурмы запрещены.');
    if (firstRound) notes.push('В первом раунде нельзя атаковать других игроков и их острова; нейтральные и государственные острова остаются целями.');
    if (!seaTargets.length && !islandTargets.length) notes.push('На текущей клетке нет допустимых целей.');
    content.innerHTML = notes.length ? notes.map(n => `<div class="combat-note">${escapeHtml(n)}</div>`).join('') : '<div class="combat-note">Можно атаковать одному или пригласить союзников. Союзники защиты также получают право присоединиться, если находятся в нужной позиции.</div>';

    if (seaTargets.length) {
      const label = document.createElement('div');
      label.className = 'action-group-label';
      label.textContent = 'Морской бой';
      actions.appendChild(label);
      for (const target of seaTargets) {
        const card = document.createElement('div');
        card.className = 'combat-target';
        const attackAllies = r.players.filter(p => p.id !== state.myId && p.id !== target.id && areAlliesClient(state.myId, p.id) && !areAlliesClient(target.id, p.id) && p.row === target.row && p.col === target.col);
        const defenseAllies = r.players.filter(p => p.id !== state.myId && p.id !== target.id && areAlliesClient(target.id, p.id) && !areAlliesClient(state.myId, p.id) && p.row === target.row && p.col === target.col);
        card.innerHTML = `<div><strong>${escapeHtml(target.name)}</strong><div class="cargo-meta">Флотилия цели: артиллерия ${target.fleetArtillery}. Ваши союзники в позиции: ${attackAllies.length}; союзники защиты в позиции: ${defenseAllies.length}.${target.legendaryStatus?.shipVeilTurns ? ` Покров моря: ${target.legendaryStatus.shipVeilTurns} хода.` : ''}</div></div>`;
        const row = document.createElement('div');
        row.className = 'combat-button-row';
        const solo = document.createElement('button');
        solo.type = 'button';
        solo.className = 'danger-soft';
        solo.textContent = `Атаковать · ${mine.fleetArtillery}:${target.fleetArtillery}`;
        solo.disabled = !canAct || firstRound || mine.inPeaceZone || (mine.brokenAlliesThisTurn || []).includes(target.id) || Boolean(target.legendaryStatus?.shipVeilTurns);
        solo.addEventListener('click', () => socket.emit('attackShip', { targetPlayerId: target.id, inviteAllies: false }, handleGameAck));
        const together = document.createElement('button');
        together.type = 'button';
        together.textContent = `Позвать союзников (${attackAllies.length})`;
        together.disabled = solo.disabled || attackAllies.length === 0;
        together.addEventListener('click', () => socket.emit('attackShip', { targetPlayerId: target.id, inviteAllies: true }, handleGameAck));
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
        card.innerHTML = `<div><strong>${escapeHtml(island.name)}</strong><div class="cargo-meta">${escapeHtml(owner)} · ваша сила ${mine.assaultArmy ?? mine.stats?.army ?? 0} · базовая защита ${island.defenseArmy ?? island.army} · союзники атаки в позиции ${attackAllies.length} · защиты ${defenseAllies.length}${island.legendaryVeil?.remaining ? ` · Покров моря ${island.legendaryVeil.remaining} хода` : ''}</div></div>`;
        for (const mode of ['preserve', 'raze']) {
          const row = document.createElement('div');
          row.className = 'combat-button-row';
          const solo = document.createElement('button');
          solo.type = 'button';
          solo.className = mode === 'raze' ? 'danger-soft' : '';
          solo.textContent = mode === 'raze' ? 'Разорить · одному' : 'Сохранить · одному';
          solo.disabled = !canAct || mine.inPeaceZone || (firstRound && pvpIsland) || (island.ownerId && (mine.brokenAlliesThisTurn || []).includes(island.ownerId)) || Boolean(island.legendaryVeil?.remaining);
          solo.addEventListener('click', () => socket.emit('assaultIsland', { islandId: island.id, captureMode: mode, inviteAllies: false }, handleGameAck));
          const together = document.createElement('button');
          together.type = 'button';
          together.textContent = mode === 'raze' ? `Разорить · союз (${attackAllies.length})` : `Сохранить · союз (${attackAllies.length})`;
          together.disabled = solo.disabled || attackAllies.length === 0;
          together.addEventListener('click', () => socket.emit('assaultIsland', { islandId: island.id, captureMode: mode, inviteAllies: true }, handleGameAck));
          row.appendChild(solo); row.appendChild(together);
          card.appendChild(row);
        }
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
    state.mapSelection = null;
    const card = $('mapInfoCard');
    card.classList.add('hidden');
    card.style.visibility = '';
    card.style.maxHeight = '';
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
      const owner = data.ownerId ? playerName(data.ownerId) : (data.faction || (data.kind === 'free' ? 'Свободный остров' : data.kind === 'independent' ? 'Независимый остров' : 'Нет владельца'));
      const resources = data.resources?.length ? data.resources.join(', ') : 'нет';
      meta.innerHTML = `<span>Владелец: <strong>${escapeHtml(owner)}</strong></span><span>Площадь: <strong>${data.area}</strong></span><span>Гарнизон: <strong>${data.army ?? 0}</strong></span><span>Ресурс: <strong>${escapeHtml(resources)}</strong></span>`;
      const here = currentIslands().some(i => i.id === data.id);
      if (here) {
        state.selectedIslandId = data.id;
        action.textContent = 'Действия на острове';
        action.classList.remove('hidden');
        action.onclick = () => { closeMapInfo(); openMobileTab('actions'); };
      }
    } else if (kind === 'citadel') {
      meta.innerHTML = '<span>Нейтральный торговый хаб</span><span>Продажа грузов · улучшения корабля · сопровождение</span><span>Владеть Цитаделью нельзя · бои запрещены</span>';
      if (me()?.atCitadel) {
        action.textContent = 'Открыть корабль и торговлю';
        action.classList.remove('hidden');
        action.onclick = () => { closeMapInfo(); openMobileTab('ship'); };
      }
    } else if (kind === 'anchor') {
      meta.innerHTML = `<span>Морское сражение</span><span>Награда за победу: <strong>+${data.glory || 0} славы</strong></span>`;
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
    card.classList.remove('hidden');
    positionMapInfoAt(resolvedAnchor.row, resolvedAnchor.col);
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
      const t = document.createElement('div');
      t.className = `token${p.id === state.myId ? ' you' : ''}`;
      t.style.left = `calc(${p.col} * 100% / ${cols} + ${(idx % 3) * 4}px)`;
      t.style.top = `calc(${p.row} * 100% / ${rows} + ${Math.floor(idx / 3) * 4}px)`;
      t.style.background = p.color;
      t.textContent = '⚓';
      t.title = p.name;
      tokenLayer.appendChild(t);
    });

    const mine = me();
    if (!mine || !r.started || r.activePlayerId !== state.myId) return;

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
      b.className = `cell-hit navigation-hit${coast ? ' shore' : ''}${citadel ? ' citadel' : ''}${legendary ? ' legendary-destination' : ''}${anchor ? ` anchor-destination anchor-${anchor.color}` : ''}`;
      b.disabled = state.mapMovePending;
      b.dataset.distance = String(cell.dist);
      placeCell(b, cell.row, cell.col);
      const placeName = island?.name || (citadel ? 'Цитадель' : '') || anchor?.name || legendary?.name || '';
      b.setAttribute('aria-label', `Перейти на клетку ${cell.col + 1}:${cell.row + 1}, путь ${cell.dist}${placeName ? `, ${placeName}` : ''}`);
      b.title = placeName ? `${placeName} · ${cell.dist} клет.` : `${cell.dist} клет.`;
      b.addEventListener('click', () => moveToMapCell(cell));
      highlightLayer.appendChild(b);
    }
  }

  function placeCell(el, row, col) {
    const { rows, cols } = mapSize();
    el.style.left = `${(col / cols) * 100}%`;
    el.style.top = `${(row / rows) * 100}%`;
  }

  function renderLog() {
    const logEl = $('log');
    logEl.innerHTML = '';
    for (const item of [...state.room.log].reverse()) {
      const div = document.createElement('div');
      div.className = 'log-entry';
      div.textContent = item.text;
      logEl.appendChild(div);
    }
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
  $('zoomIn').addEventListener('click', () => { state.zoom += .15; applyZoom(); scheduleMapInfoReposition(); });
  $('zoomOut').addEventListener('click', () => { state.zoom -= .15; applyZoom(); scheduleMapInfoReposition(); });
  $('centerMe').addEventListener('click', () => centerMapOnMe('smooth'));
  applyZoom();

  initAuth();
})();
