(() => {
  const API = {
    createRoom: '/api/create-room',
    joinRoom: '/api/join-room',
    state: '/api/state',
    start: '/api/start-game',
    action: '/api/action',
  };

  const TERRITORY_POSITIONS = {
    na1: [80, 60], na2: [185, 70], na3: [290, 60], na4: [120, 160], na5: [260, 160], na6: [200, 250],
    eu1: [410, 80], eu2: [520, 85], eu3: [410, 180], eu4: [520, 185], eu5: [625, 90], eu6: [625, 195],
    af1: [430, 300], af2: [540, 300], af3: [645, 300], af4: [430, 400], af5: [540, 410], af6: [645, 410],
    sa1: [120, 350], sa2: [220, 350], sa3: [120, 460], sa4: [220, 460],
    as1: [780, 115], as2: [890, 115], as3: [780, 235], as4: [890, 235],
  };

  const state = {
    code: '',
    playerId: '',
    name: '',
    snapshot: null,
    pollId: null,
    selection: {
      reinforce: null,
      attackFrom: null,
      attackTo: null,
      fortifyFrom: null,
      fortifyTo: null,
    },
  };

  const el = {
    setup: byId('setup'),
    roomPanel: byId('roomPanel'),
    gamePanel: byId('gamePanel'),
    logPanel: byId('logPanel'),
    nameInput: byId('nameInput'),
    codeInput: byId('codeInput'),
    createBtn: byId('createBtn'),
    joinBtn: byId('joinBtn'),
    setupMessage: byId('setupMessage'),
    roomCode: byId('roomCode'),
    roomState: byId('roomState'),
    playersList: byId('playersList'),
    startBtn: byId('startBtn'),
    turnInfo: byId('turnInfo'),
    phaseInfo: byId('phaseInfo'),
    actionMessage: byId('actionMessage'),
    phaseControls: byId('phaseControls'),
    reinforceControls: byId('reinforceControls'),
    attackControls: byId('attackControls'),
    fortifyControls: byId('fortifyControls'),
    reinforceBtn: byId('reinforceBtn'),
    attackBtn: byId('attackBtn'),
    endAttackBtn: byId('endAttackBtn'),
    fortifyBtn: byId('fortifyBtn'),
    endTurnBtn: byId('endTurnBtn'),
    attackDice: byId('attackDice'),
    fortifyCount: byId('fortifyCount'),
    map: byId('map'),
    legend: byId('legend'),
    logList: byId('logList'),
  };

  function byId(id) {
    return document.getElementById(id);
  }

  async function post(url, payload) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  async function getState() {
    if (!state.code || !state.playerId) return;
    const res = await fetch(`${API.state}?room=${encodeURIComponent(state.code)}&player=${encodeURIComponent(state.playerId)}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'State fetch failed');
    state.snapshot = data.state;
    render();
  }

  function startPolling() {
    stopPolling();
    state.pollId = setInterval(() => {
      getState().catch((err) => setActionMessage(err.message));
    }, 1100);
  }

  function stopPolling() {
    if (state.pollId) clearInterval(state.pollId);
    state.pollId = null;
  }

  function currentPlayerId(game) {
    if (!game || !game.turn_order.length) return '';
    return game.turn_order[game.turn_index];
  }

  function you() {
    if (!state.snapshot) return null;
    return state.snapshot.players.find((p) => p.id === state.playerId) || null;
  }

  function playerById(pid) {
    if (!state.snapshot) return null;
    return state.snapshot.players.find((p) => p.id === pid) || null;
  }

  function render() {
    const snap = state.snapshot;
    if (!snap) return;

    el.setup.classList.add('hidden');
    el.roomPanel.classList.remove('hidden');
    el.logPanel.classList.remove('hidden');

    el.roomCode.textContent = snap.code;
    el.roomState.textContent = snap.status === 'lobby' ? 'Lobby' : snap.status === 'finished' ? 'Finished' : 'In Progress';

    renderPlayers(snap);
    renderLogs(snap.log || []);

    if (snap.game) {
      el.gamePanel.classList.remove('hidden');
      renderGame(snap);
    } else {
      el.gamePanel.classList.add('hidden');
      el.phaseControls.classList.add('hidden');
      if (snap.host_id === state.playerId) el.startBtn.classList.remove('hidden');
      else el.startBtn.classList.add('hidden');
    }
  }

  function renderPlayers(snap) {
    el.playersList.innerHTML = '';
    snap.players.forEach((p) => {
      const li = document.createElement('li');
      const left = document.createElement('span');
      left.textContent = p.name + (p.id === snap.host_id ? ' (Host)' : '') + (p.id === state.playerId ? ' (You)' : '');
      const right = document.createElement('span');
      right.textContent = p.alive ? 'Alive' : 'Out';
      right.style.color = p.alive ? '#74d680' : '#ff8b8b';
      li.style.borderColor = p.color;
      li.append(left, right);
      el.playersList.appendChild(li);
    });
  }

  function renderLogs(logs) {
    el.logList.innerHTML = '';
    [...logs].reverse().forEach((line) => {
      const li = document.createElement('li');
      li.textContent = line;
      el.logList.appendChild(li);
    });
  }

  function renderGame(snap) {
    const game = snap.game;
    const turnPid = currentPlayerId(game);
    const turnPlayer = playerById(turnPid);
    const myTurn = turnPid === state.playerId;

    if (game.winner_id) {
      const winner = playerById(game.winner_id);
      el.turnInfo.textContent = `Winner: ${winner ? winner.name : 'Unknown'}`;
      el.phaseInfo.textContent = 'Game over';
      el.phaseControls.classList.add('hidden');
    } else {
      el.turnInfo.textContent = `Turn: ${turnPlayer ? turnPlayer.name : 'Unknown'}`;
      let phaseText = `Phase: ${game.phase}`;
      if (game.phase === 'reinforce') phaseText += ` | Remaining: ${game.reinforcements_left}`;
      el.phaseInfo.textContent = phaseText;
      el.phaseControls.classList.toggle('hidden', !myTurn);
      el.reinforceControls.classList.toggle('hidden', !(myTurn && game.phase === 'reinforce'));
      el.attackControls.classList.toggle('hidden', !(myTurn && game.phase === 'attack'));
      el.fortifyControls.classList.toggle('hidden', !(myTurn && game.phase === 'fortify'));
    }

    renderMap(snap, game);
    renderLegend(snap.players);
  }

  function renderLegend(players) {
    el.legend.innerHTML = '';
    players.forEach((p) => {
      const item = document.createElement('div');
      item.className = 'legend-item';
      const sw = document.createElement('span');
      sw.className = 'swatch';
      sw.style.background = p.color;
      const tx = document.createElement('span');
      tx.textContent = p.name;
      item.append(sw, tx);
      el.legend.appendChild(item);
    });
  }

  function territoryStyle(ownerColor) {
    return `
      background: rgba(15, 23, 42, 0.92);
      border-color: ${ownerColor};
    `;
  }

  function renderMap(snap, game) {
    const defs = game.territory_defs;
    el.map.innerHTML = '';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'links');
    svg.setAttribute('viewBox', '0 0 1000 620');
    svg.setAttribute('preserveAspectRatio', 'none');

    Object.entries(defs).forEach(([tid, def]) => {
      const [x1, y1] = TERRITORY_POSITIONS[tid] || [20, 20];
      def.adj.forEach((other) => {
        if (tid < other) {
          const [x2, y2] = TERRITORY_POSITIONS[other] || [20, 20];
          const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          line.setAttribute('x1', String(x1 + 42));
          line.setAttribute('y1', String(y1 + 28));
          line.setAttribute('x2', String(x2 + 42));
          line.setAttribute('y2', String(y2 + 28));
          line.setAttribute('stroke', '#355172');
          line.setAttribute('stroke-width', '2');
          svg.appendChild(line);
        }
      });
    });
    el.map.appendChild(svg);

    Object.entries(defs).forEach(([tid, def]) => {
      const [x, y] = TERRITORY_POSITIONS[tid] || [20, 20];
      const tState = game.territories[tid];
      const owner = playerById(tState.owner);
      const color = owner ? owner.color : '#94a3b8';

      const btn = document.createElement('button');
      btn.className = 'territory';
      btn.style.left = `${x}px`;
      btn.style.top = `${y}px`;
      btn.style.cssText += territoryStyle(color);

      const selected = isSelectedTerritory(tid, game.phase);
      if (selected) btn.classList.add('selected');

      const name = document.createElement('div');
      name.textContent = def.name;
      const troops = document.createElement('div');
      troops.className = 'troops';
      troops.textContent = String(tState.troops);

      btn.append(name, troops);
      btn.addEventListener('click', () => onTerritoryClick(tid));
      el.map.appendChild(btn);
    });
  }

  function isSelectedTerritory(tid, phase) {
    if (phase === 'reinforce') return state.selection.reinforce === tid;
    if (phase === 'attack') return state.selection.attackFrom === tid || state.selection.attackTo === tid;
    if (phase === 'fortify') return state.selection.fortifyFrom === tid || state.selection.fortifyTo === tid;
    return false;
  }

  function onTerritoryClick(tid) {
    const snap = state.snapshot;
    if (!snap || !snap.game) return;

    const game = snap.game;
    const mine = game.territories[tid].owner === state.playerId;

    if (game.phase === 'reinforce') {
      state.selection.reinforce = mine ? tid : null;
    }

    if (game.phase === 'attack') {
      if (mine) {
        state.selection.attackFrom = tid;
      } else {
        state.selection.attackTo = tid;
      }
    }

    if (game.phase === 'fortify') {
      if (mine) {
        if (!state.selection.fortifyFrom || state.selection.fortifyFrom === tid) {
          state.selection.fortifyFrom = tid;
        } else {
          state.selection.fortifyTo = tid;
        }
      }
    }

    render();
  }

  function resetSelections() {
    state.selection.reinforce = null;
    state.selection.attackFrom = null;
    state.selection.attackTo = null;
    state.selection.fortifyFrom = null;
    state.selection.fortifyTo = null;
  }

  function setSetupMessage(text) {
    el.setupMessage.textContent = text;
  }

  function setActionMessage(text) {
    el.actionMessage.textContent = text;
  }

  async function sendAction(action) {
    await post(API.action, {
      code: state.code,
      player: state.playerId,
      action,
    });
    await getState();
    resetSelections();
  }

  async function createRoom() {
    const name = (el.nameInput.value || '').trim();
    if (!name) return setSetupMessage('Enter your name first.');

    try {
      const res = await post(API.createRoom, { name });
      state.name = name;
      state.code = res.code;
      state.playerId = res.player;
      setSetupMessage('');
      await getState();
      startPolling();
    } catch (err) {
      setSetupMessage(err.message);
    }
  }

  async function joinRoom() {
    const name = (el.nameInput.value || '').trim();
    const code = (el.codeInput.value || '').trim().toUpperCase();
    if (!name || !code) return setSetupMessage('Enter name and room code.');

    try {
      const res = await post(API.joinRoom, { name, code });
      state.name = name;
      state.code = code;
      state.playerId = res.player;
      setSetupMessage('');
      await getState();
      startPolling();
    } catch (err) {
      setSetupMessage(err.message);
    }
  }

  async function startGame() {
    try {
      await post(API.start, { code: state.code, player: state.playerId });
      await getState();
      resetSelections();
    } catch (err) {
      setActionMessage(err.message);
    }
  }

  function validateAttackSelection(game) {
    const from = state.selection.attackFrom;
    const to = state.selection.attackTo;
    if (!from || !to) return 'Select attacker then target territory.';
    if (!game.territory_defs[from].adj.includes(to)) return 'Attack requires adjacent territories.';
    const src = game.territories[from];
    const dst = game.territories[to];
    if (src.owner !== state.playerId) return 'Attacker must be yours.';
    if (dst.owner === state.playerId) return 'Target must be enemy.';
    if (src.troops < 2) return 'Need at least 2 troops to attack.';
    return '';
  }

  function bindEvents() {
    el.createBtn.addEventListener('click', createRoom);
    el.joinBtn.addEventListener('click', joinRoom);
    el.startBtn.addEventListener('click', startGame);

    el.reinforceBtn.addEventListener('click', async () => {
      const tid = state.selection.reinforce;
      if (!tid) return setActionMessage('Select one of your territories to reinforce.');
      try {
        await sendAction({ type: 'reinforce', territory: tid, count: 1 });
        setActionMessage('');
      } catch (err) {
        setActionMessage(err.message);
      }
    });

    el.attackBtn.addEventListener('click', async () => {
      const game = state.snapshot?.game;
      if (!game) return;
      const errText = validateAttackSelection(game);
      if (errText) return setActionMessage(errText);
      const dice = Number(el.attackDice.value || 1);
      try {
        await sendAction({ type: 'attack', from: state.selection.attackFrom, to: state.selection.attackTo, dice });
        setActionMessage('');
      } catch (err) {
        setActionMessage(err.message);
      }
    });

    el.endAttackBtn.addEventListener('click', async () => {
      try {
        await sendAction({ type: 'end_attack' });
      } catch (err) {
        setActionMessage(err.message);
      }
    });

    el.fortifyBtn.addEventListener('click', async () => {
      const from = state.selection.fortifyFrom;
      const to = state.selection.fortifyTo;
      const count = Number(el.fortifyCount.value || 1);
      if (!from || !to) return setActionMessage('Select your source territory, then destination territory.');
      try {
        await sendAction({ type: 'fortify', from, to, count });
        setActionMessage('');
      } catch (err) {
        setActionMessage(err.message);
      }
    });

    el.endTurnBtn.addEventListener('click', async () => {
      try {
        await sendAction({ type: 'end_turn' });
      } catch (err) {
        setActionMessage(err.message);
      }
    });
  }

  bindEvents();
})();
