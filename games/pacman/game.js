/* eslint-disable no-magic-numbers */
(function () {
  const TILE = 24;
  const COLS = 28;
  const ROWS = 31;
  const WIDTH = COLS * TILE;
  const HEIGHT = ROWS * TILE;
  const DECISION_EPSILON = 6;

  const MAP_TEMPLATE = [
    "############################",
    "#o####.#####.##.#####.####o#",
    "#.####.#####.##.#####.####.#",
    "#..........................#",
    "#.####.##.########.##.####.#",
    "#......##....##....##......#",
    "######.##### ## #####.######",
    "     #.##### ## #####.#     ",
    "     #.##          ##.#     ",
    "     #.## ###--### ##.#     ",
    "######.## #      # ##.######",
    "      .   #      #   .      ",
    "######.## #      # ##.######",
    "     #.## ######## ##.#     ",
    "     #.##          ##.#     ",
    "     #.## ######## ##.#     ",
    "######.## ######## ##.######",
    "#............##............#",
    "#.####.#####.##.#####.####.#",
    "#o..##................##..o#",
    "###.##.##.########.##.##.###",
    "#......##....##....##......#",
    "#.##########.##.##########.#",
    "#..........................#",
    "#.####.#####.##.#####.####.#",
    "#.####.#####.##.#####.####.#",
    "#o..##................##..o#",
    "###.##.##.########.##.##.###",
    "#......##....##....##......#",
    "#.########################.#",
    "############################"
  ];

  if (!MAP_TEMPLATE.every((row) => row.length === COLS) || MAP_TEMPLATE.length !== ROWS) {
    throw new Error("Map size is invalid.");
  }

  const DIRS = {
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 }
  };

  const OPPOSITE = {
    left: "right",
    right: "left",
    up: "down",
    down: "up"
  };

  const WRAP_ROWS = new Set([11]);
  const PACMAN_WALKABLE = MAP_TEMPLATE.map((row, r) => row.split("").map((ch) => ch === "." || ch === "o" || (r === 11 && ch === " ")));

  const MODE_SCHEDULE = [
    { mode: "scatter", seconds: 7 },
    { mode: "chase", seconds: 20 },
    { mode: "scatter", seconds: 7 },
    { mode: "chase", seconds: 20 },
    { mode: "scatter", seconds: 5 }
  ];

  const GHOST_COLORS = {
    blinky: "#ff4d4d",
    pinky: "#ff98da",
    inky: "#57d9ff",
    clyde: "#ffb45c"
  };

  const cornerTargets = {
    blinky: { c: 26, r: 1 },
    pinky: { c: 1, r: 1 },
    inky: { c: 26, r: 29 },
    clyde: { c: 1, r: 29 }
  };

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const scoreEl = document.getElementById("score");
  const livesEl = document.getElementById("lives");
  const levelEl = document.getElementById("level");
  const messageEl = document.getElementById("message");

  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  canvas.setAttribute("tabindex", "0");

  function cloneGrid() {
    return MAP_TEMPLATE.map((row) => row.split(""));
  }

  function centerOf(col, row) {
    return {
      x: col * TILE + TILE / 2,
      y: row * TILE + TILE / 2
    };
  }

  function pxToTile(x, y) {
    return {
      c: Math.floor(x / TILE),
      r: Math.floor(y / TILE)
    };
  }

  function isWall(grid, col, row) {
    if (row < 0 || row >= ROWS) {
      return true;
    }
    if (col < 0 || col >= COLS) {
      return false;
    }
    const ch = grid[row][col];
    return ch === "#" || ch === "-";
  }

  function dist2(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
  }

  const state = {
    grid: cloneGrid(),
    pelletsLeft: 0,
    score: 0,
    level: 1,
    lives: 3,
    paused: false,
    gameOver: false,
    levelTimer: 0,
    frightenedTimer: 0,
    frightenedChain: 0,
    lastTime: 0,
    pacman: null,
    ghosts: []
  };

  function makePacman() {
    const spawn = centerOf(14, 23);
    return {
      x: spawn.x,
      y: spawn.y,
      dir: "left",
      want: "left",
      speed: 82,
      decisionTileKey: null
    };
  }

  function makeGhost(name, col, row, dir) {
    const spawn = centerOf(col, row);
    return {
      name,
      x: spawn.x,
      y: spawn.y,
      dir,
      speed: 95,
      eatenTimer: 0,
      decisionTileKey: null
    };
  }

  function countPellets() {
    let pellets = 0;
    for (let r = 0; r < ROWS; r += 1) {
      for (let c = 0; c < COLS; c += 1) {
        if (state.grid[r][c] === "." || state.grid[r][c] === "o") {
          pellets += 1;
        }
      }
    }
    state.pelletsLeft = pellets;
  }

  function resetActors() {
    state.pacman = makePacman();
    state.ghosts = [
      makeGhost("blinky", 13, 11, "left"),
      makeGhost("pinky", 14, 11, "right"),
      makeGhost("inky", 13, 13, "up"),
      makeGhost("clyde", 14, 13, "up")
    ];
    state.frightenedTimer = 0;
    state.frightenedChain = 0;
  }

  function resetLevel(fullReset) {
    if (fullReset) {
      state.grid = cloneGrid();
      state.levelTimer = 0;
      countPellets();
    }
    resetActors();
  }

  function passable(col, row) {
    return !isWall(state.grid, col, row);
  }

  function nearCenter(entity) {
    const tile = pxToTile(entity.x, entity.y);
    const center = centerOf(tile.c, tile.r);
    return Math.abs(center.x - entity.x) <= DECISION_EPSILON && Math.abs(center.y - entity.y) <= DECISION_EPSILON;
  }

  function alignPerpendicular(entity) {
    const tile = pxToTile(entity.x, entity.y);
    const center = centerOf(tile.c, tile.r);
    if (entity.dir === "left" || entity.dir === "right") {
      entity.y = center.y;
    } else {
      entity.x = center.x;
    }
  }

  function canMove(entity, dirName) {
    const dir = DIRS[dirName];
    const tile = pxToTile(entity.x, entity.y);
    const nextC = tile.c + dir.x;
    const nextR = tile.r + dir.y;
    if (nextC < 0 || nextC >= COLS) {
      return WRAP_ROWS.has(tile.r);
    }
    return passable(nextC, nextR);
  }

  function pacmanCanMove(entity, dirName) {
    const dir = DIRS[dirName];
    const tile = pxToTile(entity.x, entity.y);
    const nextC = tile.c + dir.x;
    const nextR = tile.r + dir.y;
    if (nextR < 0 || nextR >= ROWS) {
      return false;
    }
    if (nextC < 0 || nextC >= COLS) {
      return WRAP_ROWS.has(tile.r);
    }
    return Boolean(PACMAN_WALKABLE[nextR] && PACMAN_WALKABLE[nextR][nextC]);
  }

  function movePacman(entity, speed, dt) {
    let remaining = speed * dt;
    const step = 2;
    while (remaining > 0) {
      if (!pacmanCanMove(entity, entity.dir)) {
        break;
      }
      const move = Math.min(step, remaining);
      const dir = DIRS[entity.dir];
      entity.x += dir.x * move;
      entity.y += dir.y * move;
      alignPerpendicular(entity);

      const row = Math.max(0, Math.min(ROWS - 1, Math.floor(entity.y / TILE)));
      if (entity.x < -TILE / 2) {
        entity.x = WRAP_ROWS.has(row) ? WIDTH + TILE / 2 : TILE / 2;
      } else if (entity.x > WIDTH + TILE / 2) {
        entity.x = WRAP_ROWS.has(row) ? -TILE / 2 : WIDTH - TILE / 2;
      }
      remaining -= move;
    }
  }

  function tileKeyFor(entity) {
    const tile = pxToTile(entity.x, entity.y);
    return `${tile.c},${tile.r}`;
  }

  function onDecisionTile(entity, callback) {
    if (!nearCenter(entity)) {
      return false;
    }
    const key = tileKeyFor(entity);
    if (entity.decisionTileKey === key) {
      return false;
    }
    snapToTileCenter(entity);
    entity.decisionTileKey = key;
    callback();
    return true;
  }

  function snapToTileCenter(entity) {
    const tile = pxToTile(entity.x, entity.y);
    const center = centerOf(tile.c, tile.r);
    entity.x = center.x;
    entity.y = center.y;
  }

  function moveEntity(entity, speed, dt) {
    const dir = DIRS[entity.dir];
    entity.x += dir.x * speed * dt;
    entity.y += dir.y * speed * dt;

    const row = Math.max(0, Math.min(ROWS - 1, Math.floor(entity.y / TILE)));
    const canWrap = WRAP_ROWS.has(row);
    entity.y = Math.max(TILE / 2, Math.min(HEIGHT - TILE / 2, entity.y));
    if (entity.x < -TILE / 2) {
      entity.x = canWrap ? WIDTH + TILE / 2 : TILE / 2;
    } else if (entity.x > WIDTH + TILE / 2) {
      entity.x = canWrap ? -TILE / 2 : WIDTH - TILE / 2;
    }
  }

  function pacmanStep(dt) {
    const p = state.pacman;
    alignPerpendicular(p);
    let blocked = false;
    onDecisionTile(p, () => {
      if (pacmanCanMove(p, p.want)) {
        p.dir = p.want;
      }
      if (!pacmanCanMove(p, p.dir)) {
        blocked = true;
      }
    });
    if (blocked) {
      return;
    }
    const speed = p.speed + state.level;
    movePacman(p, speed, dt);
  }

  function currentMode() {
    if (state.frightenedTimer > 0) {
      return "frightened";
    }
    let timer = state.levelTimer;
    for (const phase of MODE_SCHEDULE) {
      if (timer < phase.seconds) {
        return phase.mode;
      }
      timer -= phase.seconds;
    }
    return "chase";
  }

  function randomChoice(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function chooseGhostDirection(ghost, mode) {
    const tile = pxToTile(ghost.x, ghost.y);
    const candidates = [];
    for (const dirName of Object.keys(DIRS)) {
      if (dirName === OPPOSITE[ghost.dir]) {
        continue;
      }
      const d = DIRS[dirName];
      const next = { c: tile.c + d.x, r: tile.r + d.y };
      if (passable(next.c, next.r)) {
        candidates.push({ dirName, next });
      }
    }

    if (candidates.length === 0) {
      ghost.dir = OPPOSITE[ghost.dir];
      return;
    }

    if (mode === "frightened") {
      ghost.dir = randomChoice(candidates).dirName;
      return;
    }

    const target = getGhostTarget(ghost);
    candidates.sort((a, b) => {
      const ac = centerOf(a.next.c, a.next.r);
      const bc = centerOf(b.next.c, b.next.r);
      return dist2(ac, target) - dist2(bc, target);
    });
    ghost.dir = candidates[0].dirName;
  }

  function getGhostTarget(ghost) {
    const pac = state.pacman;
    const pacTile = pxToTile(pac.x, pac.y);
    const pacDir = DIRS[pac.dir];
    const blinky = state.ghosts.find((g) => g.name === "blinky");
    const mode = currentMode();

    if (mode === "scatter") {
      const corner = cornerTargets[ghost.name];
      return centerOf(corner.c, corner.r);
    }

    if (ghost.name === "blinky") {
      return centerOf(pacTile.c, pacTile.r);
    }

    if (ghost.name === "pinky") {
      return centerOf(pacTile.c + pacDir.x * 4, pacTile.r + pacDir.y * 4);
    }

    if (ghost.name === "inky") {
      const ahead = { c: pacTile.c + pacDir.x * 2, r: pacTile.r + pacDir.y * 2 };
      const bTile = pxToTile(blinky.x, blinky.y);
      const vec = { x: ahead.c - bTile.c, y: ahead.r - bTile.r };
      return centerOf(ahead.c + vec.x, ahead.r + vec.y);
    }

    const gTile = pxToTile(ghost.x, ghost.y);
    const dPac = Math.hypot(gTile.c - pacTile.c, gTile.r - pacTile.r);
    if (dPac > 8) {
      return centerOf(pacTile.c, pacTile.r);
    }
    const corner = cornerTargets.clyde;
    return centerOf(corner.c, corner.r);
  }

  function ghostStep(ghost, dt) {
    if (ghost.eatenTimer > 0) {
      ghost.eatenTimer -= dt;
      if (ghost.eatenTimer <= 0) {
        const base = makeGhost(ghost.name, 14, 11, "left");
        ghost.x = base.x;
        ghost.y = base.y;
        ghost.dir = base.dir;
        ghost.decisionTileKey = null;
      }
      return;
    }

    const mode = currentMode();
    alignPerpendicular(ghost);
    onDecisionTile(ghost, () => {
      chooseGhostDirection(ghost, mode);
      if (!canMove(ghost, ghost.dir)) {
        ghost.dir = OPPOSITE[ghost.dir];
      }
    });

    const speed = mode === "frightened" ? ghost.speed * 0.7 : ghost.speed + state.level * 2;
    moveEntity(ghost, speed, dt);
  }

  function consumePellet() {
    const tile = pxToTile(state.pacman.x, state.pacman.y);
    const val = state.grid[tile.r] && state.grid[tile.r][tile.c];
    if (val === ".") {
      state.grid[tile.r][tile.c] = " ";
      state.pelletsLeft -= 1;
      state.score += 10;
    } else if (val === "o") {
      state.grid[tile.r][tile.c] = " ";
      state.pelletsLeft -= 1;
      state.score += 50;
      state.frightenedTimer = 7;
      state.frightenedChain = 0;
      for (const ghost of state.ghosts) {
        if (ghost.eatenTimer <= 0) {
          ghost.dir = OPPOSITE[ghost.dir];
        }
      }
    }
  }

  function loseLife() {
    state.lives -= 1;
    if (state.lives <= 0) {
      state.gameOver = true;
      showMessage("Game Over<br>Press Enter to restart");
      return;
    }
    showMessage("Ready!");
    resetActors();
    setTimeout(() => hideMessage(), 800);
  }

  function handleCollisions() {
    const pac = state.pacman;
    for (const ghost of state.ghosts) {
      if (ghost.eatenTimer > 0) {
        continue;
      }
      if (Math.hypot(pac.x - ghost.x, pac.y - ghost.y) < TILE * 0.55) {
        if (currentMode() === "frightened") {
          ghost.eatenTimer = 2.5;
          state.frightenedChain += 1;
          state.score += 200 * (2 ** (state.frightenedChain - 1));
        } else {
          loseLife();
        }
      }
    }
  }

  function checkWin() {
    if (state.pelletsLeft > 0) {
      return;
    }
    state.level += 1;
    showMessage(`Level ${state.level}`);
    state.grid = cloneGrid();
    countPellets();
    state.levelTimer = 0;
    resetActors();
    setTimeout(() => hideMessage(), 900);
  }

  function update(dt) {
    if (state.paused || state.gameOver) {
      return;
    }
    state.levelTimer += dt;
    if (state.frightenedTimer > 0) {
      state.frightenedTimer -= dt;
      if (state.frightenedTimer <= 0) {
        state.frightenedTimer = 0;
        state.frightenedChain = 0;
      }
    }

    pacmanStep(dt);
    consumePellet();
    for (const ghost of state.ghosts) {
      ghostStep(ghost, dt);
    }
    handleCollisions();
    checkWin();
    refreshHud();
  }

  function drawMaze() {
    ctx.fillStyle = "#050816";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    for (let r = 0; r < ROWS; r += 1) {
      for (let c = 0; c < COLS; c += 1) {
        const ch = state.grid[r][c];
        const x = c * TILE;
        const y = r * TILE;
        if (ch === "#") {
          ctx.fillStyle = "#2447a5";
          ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
        } else if (ch === "-") {
          ctx.fillStyle = "#d7a35e";
          ctx.fillRect(x + 3, y + TILE / 2 - 2, TILE - 6, 4);
        } else if (ch === ".") {
          ctx.fillStyle = "#f5f7ff";
          ctx.beginPath();
          ctx.arc(x + TILE / 2, y + TILE / 2, 2.5, 0, Math.PI * 2);
          ctx.fill();
        } else if (ch === "o") {
          ctx.fillStyle = "#fff49a";
          ctx.beginPath();
          ctx.arc(x + TILE / 2, y + TILE / 2, 5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  function drawPacman() {
    const p = state.pacman;
    const angleByDir = {
      right: 0,
      left: Math.PI,
      up: -Math.PI / 2,
      down: Math.PI / 2
    };
    const base = angleByDir[p.dir];
    const mouth = 0.22 + Math.abs(Math.sin(performance.now() / 100)) * 0.18;
    ctx.fillStyle = "#ffd84d";
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.arc(p.x, p.y, TILE * 0.43, base + mouth, base - mouth + Math.PI * 2);
    ctx.closePath();
    ctx.fill();
  }

  function drawGhost(ghost) {
    if (ghost.eatenTimer > 0) {
      return;
    }
    const frightened = currentMode() === "frightened";
    const color = frightened ? "#3b72ff" : GHOST_COLORS[ghost.name];
    const w = TILE * 0.82;
    const h = TILE * 0.86;
    const x = ghost.x - w / 2;
    const y = ghost.y - h / 2;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(ghost.x, y + w / 2, w / 2, Math.PI, 0);
    ctx.rect(x, y + w / 2, w, h - w / 2);
    ctx.fill();

    ctx.fillStyle = frightened ? "#f2f5ff" : "#ffffff";
    ctx.beginPath();
    ctx.arc(ghost.x - 6, ghost.y - 2, 3.6, 0, Math.PI * 2);
    ctx.arc(ghost.x + 6, ghost.y - 2, 3.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = frightened ? "#f2f5ff" : "#2f55bf";
    ctx.beginPath();
    ctx.arc(ghost.x - 5, ghost.y - 2, 1.6, 0, Math.PI * 2);
    ctx.arc(ghost.x + 5, ghost.y - 2, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  function render() {
    drawMaze();
    drawPacman();
    for (const ghost of state.ghosts) {
      drawGhost(ghost);
    }
  }

  function refreshHud() {
    scoreEl.textContent = String(state.score);
    livesEl.textContent = String(state.lives);
    levelEl.textContent = String(state.level);
  }

  function showMessage(html) {
    messageEl.innerHTML = html;
    messageEl.classList.remove("hidden");
  }

  function hideMessage() {
    messageEl.classList.add("hidden");
  }

  function loop(ts) {
    if (!state.lastTime) {
      state.lastTime = ts;
    }
    const dt = Math.min(0.033, (ts - state.lastTime) / 1000);
    state.lastTime = ts;
    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  function startFreshGame() {
    state.score = 0;
    state.level = 1;
    state.lives = 3;
    state.gameOver = false;
    state.paused = false;
    hideMessage();
    resetLevel(true);
    refreshHud();
  }

  const KEY_TO_DIR = {
    ArrowLeft: "left",
    Left: "left",
    a: "left",
    A: "left",
    ArrowRight: "right",
    Right: "right",
    d: "right",
    D: "right",
    ArrowUp: "up",
    Up: "up",
    w: "up",
    W: "up",
    ArrowDown: "down",
    Down: "down",
    s: "down",
    S: "down"
  };

  function setDirection(key) {
    const dir = KEY_TO_DIR[key];
    if (dir && state.pacman) {
      state.pacman.want = dir;
      // Re-evaluate turn choice immediately even if Pac-Man is stationary on this tile.
      state.pacman.decisionTileKey = null;
    }
  }

  window.addEventListener("keydown", (evt) => {
    if (KEY_TO_DIR[evt.key]) {
      evt.preventDefault();
      setDirection(evt.key);
      return;
    }

    if (evt.key === "p" || evt.key === "P") {
      evt.preventDefault();
      if (!state.gameOver) {
        state.paused = !state.paused;
        if (state.paused) {
          showMessage("Paused");
        } else {
          hideMessage();
        }
      }
      return;
    }

    if (evt.key === "Enter" && state.gameOver) {
      evt.preventDefault();
      startFreshGame();
      return;
    }
  }, { passive: false });

  canvas.addEventListener("pointerdown", () => {
    canvas.focus();
  });

  startFreshGame();
  canvas.focus();
  showMessage("Ready!");
  setTimeout(() => hideMessage(), 900);
  requestAnimationFrame(loop);
})();
