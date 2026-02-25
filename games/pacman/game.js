/* eslint-disable no-magic-numbers */
(function () {
  const TILE = 24;
  const COLS = 28;
  const ROWS = 31;
  const WIDTH = COLS * TILE;
  const HEIGHT = ROWS * TILE;

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
      speed: 105
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
      eatenTimer: 0
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
    return Math.abs(center.x - entity.x) < 2 && Math.abs(center.y - entity.y) < 2;
  }

  function canMove(entity, dirName) {
    const dir = DIRS[dirName];
    const tile = pxToTile(entity.x, entity.y);
    const nextC = tile.c + dir.x;
    const nextR = tile.r + dir.y;
    return passable(nextC, nextR);
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

    if (entity.x < -TILE / 2) {
      entity.x = WIDTH + TILE / 2;
    } else if (entity.x > WIDTH + TILE / 2) {
      entity.x = -TILE / 2;
    }
  }

  function pacmanStep(dt) {
    const p = state.pacman;
    const centered = nearCenter(p);
    if (centered) {
      snapToTileCenter(p);
      if (canMove(p, p.want)) {
        p.dir = p.want;
      }
      if (!canMove(p, p.dir)) {
        return;
      }
    }
    moveEntity(p, p.speed + state.level * 3, dt);
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
      }
      return;
    }

    const mode = currentMode();
    if (nearCenter(ghost)) {
      snapToTileCenter(ghost);
      chooseGhostDirection(ghost, mode);
      if (!canMove(ghost, ghost.dir)) {
        ghost.dir = OPPOSITE[ghost.dir];
      }
    }

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

  function setDirection(key) {
    if (key === "ArrowLeft" || key.toLowerCase() === "a") {
      state.pacman.want = "left";
    } else if (key === "ArrowRight" || key.toLowerCase() === "d") {
      state.pacman.want = "right";
    } else if (key === "ArrowUp" || key.toLowerCase() === "w") {
      state.pacman.want = "up";
    } else if (key === "ArrowDown" || key.toLowerCase() === "s") {
      state.pacman.want = "down";
    }
  }

  window.addEventListener("keydown", (evt) => {
    if (evt.key === "p" || evt.key === "P") {
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
      startFreshGame();
      return;
    }

    setDirection(evt.key);
  });

  startFreshGame();
  showMessage("Ready!");
  setTimeout(() => hideMessage(), 900);
  requestAnimationFrame(loop);
})();
