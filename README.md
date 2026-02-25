# Browser Games Collection

This repository contains original browser games and strategy prototypes.

## Projects

- `games/pacman/` -> Pac-Man style maze chase game
- `games/risk-online/` -> Conquest Six (Risk-inspired 2-6 player online strategy)

## Run Pacman

```bash
cd /Users/patu/Documents/CursorProjects/Games/Pacman
python3 -m http.server 8080
```

Open: `http://localhost:8080/games/pacman/`

## Run Conquest Six (Risk-inspired)

```bash
cd /Users/patu/Documents/CursorProjects/Games/Pacman/games/risk-online
python3 server.py
```

Open: `http://localhost:8787`

## Notes

- Conquest Six v1 is human-only multiplayer (AI planned for a later phase).
- Max seats: 6 players.
