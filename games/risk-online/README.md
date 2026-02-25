# Conquest Six (Risk-Inspired Online Game)

`Conquest Six` is a browser-based online strategy game inspired by the classic Risk turn structure:

- 2 to 6 human players
- Online room code join
- Reinforce -> Attack -> Fortify turn phases
- Dice-based combat resolution
- Territory capture, elimination, and win condition

This v1 is human-only. AI seats are intentionally deferred and the code is structured so AI bots can be added later.

## Why this is feasible

Yes, this is feasible online for up to 6 players. The game is turn-based and requires low bandwidth, so simple polling is enough for stable multiplayer play.

## Rules implemented in v1

- Territory control map with adjacency graph
- Reinforcements each turn: `max(3, floor(owned_territories / 3)) + continent bonuses`
- Attack dice: attacker up to 3 (must leave 1 behind), defender up to 2
- Compare top dice pairs; defender wins ties
- On capture, attacker moves troops into captured territory
- One optional fortify per turn (adjacent friendly territories in v1)
- Player elimination and winner detection

## Run locally

```bash
cd /Users/patu/Documents/CursorProjects/Games/Pacman/games/risk-online
python3 server.py
```

Open:

- `http://localhost:8787`

To test multiplayer locally, open multiple browser tabs/windows and join with the same room code.

## Deploy

Any host that can run Python 3 can serve this app.

- Entry point: `games/risk-online/server.py`
- Default port: `8787` (adjust in `main()` if needed)
- Static assets served from `games/risk-online/static`

## AI plan for v2 (not enabled yet)

- Add `is_human = False` seats in lobby
- At turn start, if current seat is AI, run strategy function and submit actions server-side
- Keep current API and action validators; AI should use the same action path as humans
