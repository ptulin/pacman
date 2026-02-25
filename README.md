# Maze Chase (Pac-Man style)

This project is an original browser implementation inspired by classic maze-chase gameplay.

Path for hosting:

- `/games/pacman/index.html`

## Run locally

Any static server works. Example:

```bash
cd /Users/patu/Documents/CursorProjects/Games/Pacman
python3 -m http.server 8080
```

Then open:

- `http://localhost:8080/games/pacman/`

## Deploy to disruptiveexperience.com

Upload the `games/pacman` directory to your site so these files exist:

- `/games/pacman/index.html`
- `/games/pacman/styles.css`
- `/games/pacman/game.js`

## Create GitHub project

```bash
cd /Users/patu/Documents/CursorProjects/Games/Pacman
git init
git add .
git commit -m "Add original Pac-Man style maze game"
git branch -M main
git remote add origin https://github.com/<your-user>/<your-repo>.git
git push -u origin main
```

If you use GitHub CLI:

```bash
gh repo create <your-repo> --public --source=. --remote=origin --push
```
