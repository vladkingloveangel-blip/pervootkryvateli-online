(() => {
  const socket = io();
  const $ = id => document.getElementById(id);
  const state = { room: null, myId: null, code: null, playerToken: null, zoom: 1, selectedIslandId: null, mistCardRef: null, accountToken: localStorage.getItem('pervo:accountToken') || '', accountUser: null, accountsEnabled: false, authResolved: false, socketConnected: false, resumeAttempted: false, spectating: false };
  const SHIP_NAMES = { brigantine: 'Бригантина', frigate: 'Фрегат', caravel: 'Каравелла', carrack: 'Каракка' };
  const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
  let deferredInstallPrompt = null;

  const roomFromUrl = new URLSearchParams(location.search).get('room');
  if (roomFromUrl) $('codeInput').value = String(roomFromUrl).toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 5);

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

  function showAuth(message = '') {
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
    if (!$('nameInput').value) $('nameInput').value = user?.displayName || user?.username || '';
    if (!state.spectating && !state.room && $('adminPanel').classList.contains('hidden')) $('entry').classList.remove('hidden');
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
    const last = localStorage.getItem('pervo:lastRoom');
    if (!last) return;
    state.resumeAttempted = true;
    try {
      const sess = JSON.parse(localStorage.getItem(keyFor(last)) || 'null');
      if (sess?.code && sess?.playerToken) {
        socket.emit('resumeRoom', { ...sess, accountToken: state.accountToken }, res => {
          if (res?.ok) acceptSession(res);
          else if (res?.error === 'Комната больше не существует.') {
            localStorage.removeItem(keyFor(last));
            localStorage.removeItem('pervo:lastRoom');
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
      card.innerHTML = `<div><strong>Комната ${escapeHtml(room.code)}</strong><div class="muted">${room.started ? `Игра · раунд ${room.round}, круг ${room.circle}` : 'Лобби'} · игроков ${room.players.length}/5${room.activePlayerName ? ` · ход: ${escapeHtml(room.activePlayerName)}` : ''}</div><div class="admin-players">${players}</div></div><div class="admin-room-actions"></div>`;
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
    $('game').classList.add('hidden');
    $('entry').classList.remove('hidden');
    setError('gameError', '');
    setError('entryError', message);
    try {
      const url = new URL(location.href);
      url.searchParams.delete('room');
      history.replaceState(null, '', url.pathname + url.search + url.hash);
    } catch {}
  }

  socket.on('connect', () => {
    setConnected(true);
    state.socketConnected = true;
    state.resumeAttempted = false;
    maybeResumeLastRoom();
  });
  socket.on('disconnect', () => {
    setConnected(false);
    state.socketConnected = false;
    state.resumeAttempted = false;
  });
  socket.on('roomState', room => {
    if (state.spectating) return;
    state.room = room;
    render();
  });
  socket.on('adminRoomState', room => {
    if (!state.spectating) return;
    state.room = room;
    $('spectatorRoomCode').textContent = room.code;
    render();
  });
  socket.on('adminRoomClosed', data => {
    if (!state.spectating) return;
    state.spectating = false;
    state.room = null;
    document.body.classList.remove('spectator-mode');
    $('game').classList.add('hidden');
    $('spectatorBanner').classList.add('hidden');
    showAdminPanel();
    setError('adminError', data?.reason || 'Комната закрыта.');
  });
  socket.on('roomClosed', data => clearSession(data?.reason || 'Комната закрыта.'));
  socket.on('removedFromRoom', data => clearSession(data?.reason || 'Вы удалены из комнаты.'));

  function acceptSession(res) {
    state.code = res.code;
    state.myId = res.playerId;
    state.playerToken = res.playerToken;
    saveSession();
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

  $('joinBtn').addEventListener('click', () => {
    setError('entryError');
    const code = $('codeInput').value.trim().toUpperCase();
    if (code.length < 4) return setError('entryError', 'Введите код комнаты.');
    const saved = (() => { try { return JSON.parse(localStorage.getItem(keyFor(code)) || 'null'); } catch { return null; } })();
    socket.emit('joinRoom', { ...profile(), code, playerToken: saved?.playerToken || null }, res => {
      if (!res?.ok) return setError('entryError', res?.error || 'Не удалось войти.');
      acceptSession(res);
    });
  });

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
  $('adminOpenBtn').addEventListener('click', showAdminPanel);
  $('adminRefreshBtn').addEventListener('click', loadAdminRooms);
  $('adminBackBtn').addEventListener('click', () => {
    socket.emit('adminStopWatching', {}, () => {});
    showAdminPanel();
  });
  $('logoutBtn').addEventListener('click', () => {
    if (!confirm('Выйти из аккаунта на этом устройстве?')) return;
    localStorage.removeItem('pervo:accountToken');
    state.accountToken = '';
    state.accountUser = null;
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
  $('sellCargoBtn').addEventListener('click', () => socket.emit('sellCargo', {}, handleGameAck));

  function handleGameAck(res) { setError('gameError', res?.ok ? '' : (res?.error || 'Действие отклонено.')); }
  function me() { return state.room?.players.find(p => p.id === state.myId) || null; }
  function active() { return state.room?.players.find(p => p.id === state.room?.activePlayerId) || null; }

  function currentIslands() {
    const mine = me();
    if (!mine) return [];
    return (state.room?.islands || []).filter(island => island.cells.some(([r, c]) => r === mine.row && c === mine.col));
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

  function render() {
    const r = state.room;
    if (!r) return;
    $('entry').classList.add('hidden');
    $('game').classList.remove('hidden');
    $('roomCode').textContent = r.code;
    $('roundLabel').textContent = !r.started ? 'Лобби' : r.eventPhase?.active ? `Раунд ${r.round} · общая Фаза событий` : `Раунд ${r.round} · круг ${r.circle}/5`;
    const a = active();
    const eventPlayer = r.eventPhase?.currentPlayerId ? r.players.find(p => p.id === r.eventPhase.currentPlayerId) : null;
    $('turnLabel').textContent = !r.started ? `Игроков: ${r.players.length}/5` : r.eventPhase?.active ? `Событие: ${eventPlayer?.name || '—'}` : (a ? `Ход: ${a.name}` : '—');

    const mine = me();
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
      el.innerHTML = `<span class="player-dot" style="background:${p.color}"></span><div class="player-meta"><div class="player-name">${escapeHtml(p.name)}${p.isYou ? ' · вы' : ''}${!p.connected ? ' · офлайн' : ''}</div><div class="player-sub">${SHIP_NAMES[p.shipClass]} ${ROMAN[p.level] || p.level} · ${p.ducats} дукатов${p.debt ? ` · долг ${p.debt}` : ''} · слава ${p.glory || 0} · островов ${p.islandCount} · эскорт ${p.escorts?.length || 0}${p.skipTurns ? ` · пропуск ${p.skipTurns}` : ''}${escapeHtml(cargoLabel)}${escapeHtml(politicalLabel)}</div></div><div class="player-side-actions"><span class="order-badge">${order ? `#${order}` : ''}</span></div>`;
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
    $('startBtn').classList.toggle('hidden', isSpectator || r.started || !isHost);
    $('startBtn').disabled = r.players.length < 2 || r.players.length > 5;
    $('startBtn').textContent = r.players.length < 2 ? 'Нужен ещё 1 игрок' : 'Начать игру';

    $('closeRoomBtn').classList.toggle('hidden', isSpectator || !isHost);
    $('leaveRoomBtn').classList.toggle('hidden', isSpectator || isHost || r.started);
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

    if (!r.started) $('moveResult').textContent = 'Ждём 2–5 игроков и старта от создателя комнаты.';
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
      note = 'Ландин занимает одно из трёх мест сопровождения и совмещает боевые и торговые возможности: +6 артиллерии и отдельный трюм 5. Груз заменённого судна пропадёт.';
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
      if (assignment.type === 'delivery') html += '<div class="cargo-meta">Для доставки засчитывается только полный трюм, полученный после выдачи этого поручения. Подходящая продажа в Цитадели автоматически получает контрактную премию +50%.</div>';
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
      label.textContent = `Оставить поручение «${pending.assignment?.text || 'текущее'}» или заменить за 2 дуката?`;
      actions.appendChild(label);
      const keep = document.createElement('button');
      keep.type = 'button'; keep.className = 'build-btn'; keep.textContent = 'Оставить поручение';
      keep.addEventListener('click', () => socket.emit('respondAssignmentChoice', { choiceId: pending.id, replace: false }, handleGameAck));
      actions.appendChild(keep);
      const repl = document.createElement('button');
      repl.type = 'button'; repl.className = 'build-btn primary'; repl.textContent = 'Заменить за 2 дуката'; repl.disabled = !pending.canReplace;
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
      levelBtn.addEventListener('click', () => socket.emit('buyShipLevel', {}, handleGameAck));
    } else {
      levelBtn.textContent = 'Достигнут VII уровень';
      levelBtn.disabled = true;
    }
    actions.appendChild(levelBtn);

    const upLabel = document.createElement('div');
    upLabel.className = 'action-group-label';
    upLabel.textContent = 'Улучшения';
    actions.appendChild(upLabel);
    const installedIds = new Set(upgrades.map(u => u.id));
    const upgradeCatalog = state.room.shipUpgradeCatalog || {};
    const ordered = ['falcons', 'culverins', 'musketeers', 'pikemen', 'orlop', 'sternStores', 'foreStengha', 'foreMarsel'];
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
      b.addEventListener('click', () => socket.emit('buyShipUpgrade', { upgradeId: id }, handleGameAck));
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
    const escortRoom = ordinaryCount < mine.shipyardSlots && escorts.length < mine.escortUseLimit && escorts.length < 3;
    for (const type of ['cargo', 'combat']) {
      const e = escortCatalog[type];
      if (!e) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'build-btn escort-btn';
      const spec = type === 'cargo' ? `трюм ${e.cargo}` : `арт. ${e.artillery}`;
      b.textContent = price == null ? `${e.name} · лимит` : `${e.name} · ${price} дук. · ${spec}`;
      b.disabled = !canBuyHere || price == null || mine.ducats < price || !escortRoom;
      b.addEventListener('click', () => socket.emit('buyEscort', { escortType: type }, handleGameAck));
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
        b.textContent = `Городская стража → ${island.name} · 6 дук. · +5 защиты`;
        b.disabled = !canBuyHere || mine.ducats < 6;
        b.addEventListener('click', () => socket.emit('buyCityGuard', { islandId: island.id }, handleGameAck));
        actions.appendChild(b);
      }
      for (const island of permanentTargets) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'build-btn';
        b.textContent = `Постоянный гарнизон → ${island.name} · 12 дук. · +10 защиты`;
        b.disabled = !canBuyHere || mine.ducats < 12;
        b.addEventListener('click', () => socket.emit('buyPermanentGarrison', { islandId: island.id }, handleGameAck));
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

    sell.disabled = !mine.cargo || !canAct || !mine.atCitadel;
    sell.textContent = mine.cargo && mine.atCitadel ? `Продать основной груз за ${mine.cargo.value} дукатов` : 'Продать основной груз в Цитадели';

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
    const encounter = mine.lastAnchorEncounter;
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
        bastionBtn.textContent = `Бастион · 10 дук. · +8 защиты`;
        bastionBtn.disabled = !canAct || mine.ducats < 10 || (mine.bastionCount || 0) >= (mine.bastionSupportCapacity || 0);
        bastionBtn.addEventListener('click', () => socket.emit('buildBastion', { islandId: island.id }, handleGameAck));
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

  function renderMap() {
    const r = state.room;
    const tokenLayer = $('tokenLayer');
    const highlightLayer = $('highlightLayer');
    const ownershipLayer = $('ownershipLayer');
    tokenLayer.innerHTML = '';
    highlightLayer.innerHTML = '';
    ownershipLayer.innerHTML = '';

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
      t.style.left = `calc(${p.col} * 100% / 28 + ${(idx % 3) * 4}px)`;
      t.style.top = `calc(${p.row} * 100% / 28 + ${Math.floor(idx / 3) * 4}px)`;
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
      const b = document.createElement('button');
      b.type = 'button';
      const island = r.islands.find(i => i.cells.some(([rr, cc]) => rr === cell.row && cc === cell.col));
      const citadel = (r.citadelCells || []).some(([rr, cc]) => rr === cell.row && cc === cell.col);
      const coast = Boolean(island) || citadel;
      const anchor = (r.anchorCells || []).find(a => a.row === cell.row && a.col === cell.col);
      b.className = `cell-hit${cell.dist === 0 ? ' current' : ''}${coast ? ' shore' : ''}${citadel ? ' citadel' : ''}${anchor ? ` anchor-destination anchor-${anchor.color}` : ''}`;
      placeCell(b, cell.row, cell.col);
      const placeName = island?.name || (citadel ? 'Цитадель' : '') || anchor?.name || '';
      b.setAttribute('aria-label', `Перейти на клетку ${cell.col + 1}:${cell.row + 1}, путь ${cell.dist}${placeName ? `, ${placeName}` : ''}`);
      b.title = placeName ? `${placeName} · ${cell.dist} клет.` : `${cell.dist} клет.`;
      b.addEventListener('click', () => socket.emit('moveTo', { row: cell.row, col: cell.col }, handleGameAck));
      highlightLayer.appendChild(b);
    }
  }

  function placeCell(el, row, col) {
    el.style.left = `${(col / 28) * 100}%`;
    el.style.top = `${(row / 28) * 100}%`;
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
  $('zoomIn').addEventListener('click', () => { state.zoom += .15; applyZoom(); });
  $('zoomOut').addEventListener('click', () => { state.zoom -= .15; applyZoom(); });
  $('centerMe').addEventListener('click', () => {
    const mine = me();
    if (!mine) return;
    const vp = $('mapViewport');
    const board = $('mapBoard');
    const cell = board.clientWidth / 28;
    vp.scrollTo({
      left: mine.col * cell - vp.clientWidth / 2 + cell / 2,
      top: mine.row * cell - vp.clientHeight / 2 + cell / 2,
      behavior: 'smooth',
    });
  });
  applyZoom();

  initAuth();
})();
