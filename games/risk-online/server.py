#!/usr/bin/env python3
import json
import math
import random
import secrets
import threading
import time
from copy import deepcopy
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"

MAX_PLAYERS = 6
MIN_PLAYERS = 2
ROOM_TTL_SECONDS = 60 * 60 * 8

STARTING_ARMIES_BY_COUNT = {
    2: 40,
    3: 35,
    4: 30,
    5: 25,
    6: 20,
}

TERRITORIES = {
    "na1": {"name": "Arctic Gate", "continent": "north", "adj": ["na2", "na3", "eu1"]},
    "na2": {"name": "Pine Ridge", "continent": "north", "adj": ["na1", "na3", "na4"]},
    "na3": {"name": "Iron Bay", "continent": "north", "adj": ["na1", "na2", "na5"]},
    "na4": {"name": "Dust Plains", "continent": "north", "adj": ["na2", "na6", "sa1"]},
    "na5": {"name": "Cold Fjord", "continent": "north", "adj": ["na3", "na6", "eu2"]},
    "na6": {"name": "Frontier", "continent": "north", "adj": ["na4", "na5", "sa2"]},
    "eu1": {"name": "West Crown", "continent": "europe", "adj": ["na1", "eu2", "eu3", "af1"]},
    "eu2": {"name": "Central Hold", "continent": "europe", "adj": ["na5", "eu1", "eu4", "eu5"]},
    "eu3": {"name": "Frost March", "continent": "europe", "adj": ["eu1", "eu4", "as1"]},
    "eu4": {"name": "Amber Fields", "continent": "europe", "adj": ["eu2", "eu3", "eu6", "af2"]},
    "eu5": {"name": "East Bastion", "continent": "europe", "adj": ["eu2", "eu6", "as2"]},
    "eu6": {"name": "River Delta", "continent": "europe", "adj": ["eu4", "eu5", "af3"]},
    "af1": {"name": "Sun Coast", "continent": "africa", "adj": ["eu1", "af2", "af4", "sa1"]},
    "af2": {"name": "Lion Steppe", "continent": "africa", "adj": ["eu4", "af1", "af3", "af5"]},
    "af3": {"name": "Ivory Basin", "continent": "africa", "adj": ["eu6", "af2", "af6", "as3"]},
    "af4": {"name": "Cocoa Reach", "continent": "africa", "adj": ["af1", "af5", "sa2"]},
    "af5": {"name": "Nile Bridge", "continent": "africa", "adj": ["af2", "af4", "af6"]},
    "af6": {"name": "Cape Watch", "continent": "africa", "adj": ["af3", "af5", "as4"]},
    "sa1": {"name": "Amazonia", "continent": "south", "adj": ["na4", "af1", "sa2", "sa3"]},
    "sa2": {"name": "Andes", "continent": "south", "adj": ["na6", "af4", "sa1", "sa4"]},
    "sa3": {"name": "Gran Chaco", "continent": "south", "adj": ["sa1", "sa4", "as1"]},
    "sa4": {"name": "Patagonia", "continent": "south", "adj": ["sa2", "sa3", "as2"]},
    "as1": {"name": "Silk North", "continent": "asia", "adj": ["eu3", "sa3", "as2", "as3"]},
    "as2": {"name": "Steppe East", "continent": "asia", "adj": ["eu5", "sa4", "as1", "as4"]},
    "as3": {"name": "Spice Sea", "continent": "asia", "adj": ["af3", "as1", "as4"]},
    "as4": {"name": "Jade Coast", "continent": "asia", "adj": ["af6", "as2", "as3"]},
}

CONTINENT_BONUS = {
    "north": 3,
    "europe": 3,
    "africa": 3,
    "south": 2,
    "asia": 2,
}

CONTINENTS = {}
for tid, t in TERRITORIES.items():
    CONTINENTS.setdefault(t["continent"], []).append(tid)

PLAYER_COLORS = [
    "#ff6b6b",
    "#4dabf7",
    "#51cf66",
    "#ffd43b",
    "#b197fc",
    "#ffa94d",
]


def now() -> float:
    return time.time()


def make_room_code() -> str:
    letters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(random.choice(letters) for _ in range(5))


def json_response(handler: BaseHTTPRequestHandler, status: int, payload: dict):
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(body)


def text_response(handler: BaseHTTPRequestHandler, status: int, text: str, content_type: str):
    body = text.encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


@dataclass
class ApiError(Exception):
    status: int
    message: str


class GameStore:
    def __init__(self):
        self.rooms = {}
        self.lock = threading.Lock()

    def cleanup(self):
        cutoff = now() - ROOM_TTL_SECONDS
        dead = [code for code, room in self.rooms.items() if room.get("updated_at", 0) < cutoff]
        for code in dead:
            self.rooms.pop(code, None)

    def create_room(self, name: str):
        with self.lock:
            self.cleanup()
            for _ in range(200):
                code = make_room_code()
                if code not in self.rooms:
                    break
            else:
                raise ApiError(500, "Unable to generate room code")

            player_id = secrets.token_hex(16)
            player = {
                "id": player_id,
                "name": self.clean_name(name),
                "color": PLAYER_COLORS[0],
                "is_human": True,
                "alive": True,
                "joined_at": now(),
            }
            room = {
                "code": code,
                "host_id": player_id,
                "status": "lobby",
                "players": [player],
                "game": None,
                "log": [f"{player['name']} created room {code}."],
                "updated_at": now(),
            }
            self.rooms[code] = room
            return code, player_id

    def join_room(self, code: str, name: str):
        with self.lock:
            room = self.rooms.get(code.upper())
            if not room:
                raise ApiError(404, "Room not found")
            if room["status"] != "lobby":
                raise ApiError(400, "Game already started")
            if len(room["players"]) >= MAX_PLAYERS:
                raise ApiError(400, "Room is full")

            clean = self.clean_name(name)
            used = {p["name"].lower() for p in room["players"]}
            if clean.lower() in used:
                clean = self.dedupe_name(clean, used)

            player_id = secrets.token_hex(16)
            color = PLAYER_COLORS[len(room["players"]) % len(PLAYER_COLORS)]
            room["players"].append({
                "id": player_id,
                "name": clean,
                "color": color,
                "is_human": True,
                "alive": True,
                "joined_at": now(),
            })
            room["log"].append(f"{clean} joined.")
            room["updated_at"] = now()
            return player_id

    def start_game(self, code: str, player_id: str):
        with self.lock:
            room = self.rooms.get(code.upper())
            if not room:
                raise ApiError(404, "Room not found")
            if room["host_id"] != player_id:
                raise ApiError(403, "Only host can start")
            if room["status"] != "lobby":
                raise ApiError(400, "Game already started")
            if len(room["players"]) < MIN_PLAYERS:
                raise ApiError(400, "Need at least 2 players")

            room["status"] = "in_progress"
            room["game"] = self.create_game_state(room["players"])
            room["updated_at"] = now()
            room["log"].append("Game started.")

    def get_state(self, code: str, player_id: str):
        with self.lock:
            room = self.rooms.get(code.upper())
            if not room:
                raise ApiError(404, "Room not found")
            if not any(p["id"] == player_id for p in room["players"]):
                raise ApiError(403, "Invalid player")
            room["updated_at"] = now()
            return self.sanitize_room(room, player_id)

    def apply_action(self, code: str, player_id: str, action: dict):
        with self.lock:
            room = self.rooms.get(code.upper())
            if not room:
                raise ApiError(404, "Room not found")
            game = room.get("game")
            if room["status"] != "in_progress" or not game:
                raise ApiError(400, "Game not in progress")

            player = self.find_player(room, player_id)
            if not player:
                raise ApiError(403, "Invalid player")

            if game["winner_id"]:
                raise ApiError(400, "Game is over")

            current_id = game["turn_order"][game["turn_index"]]
            if current_id != player_id:
                raise ApiError(400, "Not your turn")

            if action.get("type") == "reinforce":
                self.action_reinforce(room, player_id, action)
            elif action.get("type") == "attack":
                self.action_attack(room, player_id, action)
            elif action.get("type") == "end_attack":
                self.action_end_attack(room, player_id)
            elif action.get("type") == "fortify":
                self.action_fortify(room, player_id, action)
            elif action.get("type") == "end_turn":
                self.action_end_turn(room, player_id)
            else:
                raise ApiError(400, "Unsupported action")

            room["updated_at"] = now()

    def action_reinforce(self, room: dict, player_id: str, action: dict):
        game = room["game"]
        if game["phase"] != "reinforce":
            raise ApiError(400, "Not in reinforce phase")

        territory = action.get("territory")
        count = int(action.get("count", 1))
        if territory not in game["territories"]:
            raise ApiError(400, "Unknown territory")
        if count < 1:
            raise ApiError(400, "Invalid troop count")
        if game["reinforcements_left"] < count:
            raise ApiError(400, "Not enough reinforcements")

        spot = game["territories"][territory]
        if spot["owner"] != player_id:
            raise ApiError(400, "You must own that territory")

        spot["troops"] += count
        game["reinforcements_left"] -= count
        room["log"].append(f"{self.name_by_id(room, player_id)} reinforced {TERRITORIES[territory]['name']} (+{count}).")

        if game["reinforcements_left"] == 0:
            game["phase"] = "attack"
            room["log"].append(f"{self.name_by_id(room, player_id)} is now attacking.")

    def action_attack(self, room: dict, player_id: str, action: dict):
        game = room["game"]
        if game["phase"] != "attack":
            raise ApiError(400, "Not in attack phase")

        origin = action.get("from")
        target = action.get("to")
        dice = int(action.get("dice", 1))

        if origin not in game["territories"] or target not in game["territories"]:
            raise ApiError(400, "Unknown territory")
        if target not in TERRITORIES[origin]["adj"]:
            raise ApiError(400, "Territories are not adjacent")

        src = game["territories"][origin]
        dst = game["territories"][target]

        if src["owner"] != player_id:
            raise ApiError(400, "You must own attack origin")
        if dst["owner"] == player_id:
            raise ApiError(400, "Target must be enemy territory")
        if src["troops"] < 2:
            raise ApiError(400, "Need at least 2 troops to attack")

        max_attacker_dice = min(3, src["troops"] - 1)
        if dice < 1 or dice > max_attacker_dice:
            raise ApiError(400, f"Attacker dice must be 1..{max_attacker_dice}")

        defender_dice = min(2, dst["troops"])
        attack_rolls = sorted([random.randint(1, 6) for _ in range(dice)], reverse=True)
        defend_rolls = sorted([random.randint(1, 6) for _ in range(defender_dice)], reverse=True)

        losses_att = 0
        losses_def = 0
        for i in range(min(len(attack_rolls), len(defend_rolls))):
            if attack_rolls[i] > defend_rolls[i]:
                losses_def += 1
            else:
                losses_att += 1

        src["troops"] -= losses_att
        dst["troops"] -= losses_def

        attacker_name = self.name_by_id(room, player_id)
        defender_name = self.name_by_id(room, dst["owner"])
        room["log"].append(
            f"{attacker_name} attacked {TERRITORIES[target]['name']} from {TERRITORIES[origin]['name']} | "
            f"A:{attack_rolls} D:{defend_rolls} -> losses A-{losses_att} D-{losses_def}."
        )

        if dst["troops"] <= 0:
            prev_owner = dst["owner"]
            move = min(src["troops"] - 1, max(dice, 1))
            move = max(move, 1)
            dst["owner"] = player_id
            dst["troops"] = move
            src["troops"] -= move
            room["log"].append(
                f"{attacker_name} captured {TERRITORIES[target]['name']} moving {move} troops in."
            )
            self.handle_player_elimination(room, prev_owner)
            self.check_winner(room)

    def action_end_attack(self, room: dict, player_id: str):
        game = room["game"]
        if game["phase"] != "attack":
            raise ApiError(400, "Not in attack phase")
        game["phase"] = "fortify"
        room["log"].append(f"{self.name_by_id(room, player_id)} entered fortify phase.")

    def action_fortify(self, room: dict, player_id: str, action: dict):
        game = room["game"]
        if game["phase"] != "fortify":
            raise ApiError(400, "Not in fortify phase")
        if game.get("fortified_this_turn"):
            raise ApiError(400, "Fortify already used this turn")

        origin = action.get("from")
        target = action.get("to")
        count = int(action.get("count", 1))

        if origin not in game["territories"] or target not in game["territories"]:
            raise ApiError(400, "Unknown territory")
        if target not in TERRITORIES[origin]["adj"]:
            raise ApiError(400, "Fortify requires adjacent territories in v1")

        src = game["territories"][origin]
        dst = game["territories"][target]

        if src["owner"] != player_id or dst["owner"] != player_id:
            raise ApiError(400, "You must own both territories")
        if count < 1 or src["troops"] - count < 1:
            raise ApiError(400, "Must leave at least 1 troop behind")

        src["troops"] -= count
        dst["troops"] += count
        game["fortified_this_turn"] = True
        room["log"].append(
            f"{self.name_by_id(room, player_id)} fortified {TERRITORIES[target]['name']} from {TERRITORIES[origin]['name']} (+{count})."
        )

    def action_end_turn(self, room: dict, player_id: str):
        game = room["game"]
        if game["phase"] not in ("attack", "fortify"):
            raise ApiError(400, "You can end turn after reinforcements")

        self.advance_turn(room)

    def advance_turn(self, room: dict):
        game = room["game"]
        if game["winner_id"]:
            return

        old_order = list(game["turn_order"])
        old_index = game["turn_index"] if old_order else 0
        old_current = old_order[old_index % len(old_order)] if old_order else None

        active = [pid for pid in old_order if self.player_alive(room, pid)]
        game["turn_order"] = active
        if len(active) <= 1:
            game["winner_id"] = active[0] if active else None
            room["status"] = "finished"
            return

        if old_current in active:
            current_index = active.index(old_current)
        else:
            current_index = 0
        next_index = (current_index + 1) % len(active)
        game["turn_index"] = next_index
        next_id = active[next_index]

        game["phase"] = "reinforce"
        game["reinforcements_left"] = self.calculate_reinforcements(game, next_id)
        game["fortified_this_turn"] = False
        game["last_combat"] = None

        room["log"].append(
            f"Turn: {self.name_by_id(room, next_id)} gets {game['reinforcements_left']} reinforcements."
        )

    def create_game_state(self, players: list):
        player_ids = [p["id"] for p in players]
        random.shuffle(player_ids)

        territories = {tid: {"owner": None, "troops": 0} for tid in TERRITORIES}
        ids = list(territories.keys())
        random.shuffle(ids)

        for idx, tid in enumerate(ids):
            owner = player_ids[idx % len(player_ids)]
            territories[tid]["owner"] = owner
            territories[tid]["troops"] = 1

        for pid in player_ids:
            owned = [tid for tid, t in territories.items() if t["owner"] == pid]
            target_total = STARTING_ARMIES_BY_COUNT[len(player_ids)]
            to_place = target_total - len(owned)
            while to_place > 0:
                tid = random.choice(owned)
                territories[tid]["troops"] += 1
                to_place -= 1

        game = {
            "territories": territories,
            "turn_order": player_ids,
            "turn_index": 0,
            "phase": "reinforce",
            "reinforcements_left": 0,
            "fortified_this_turn": False,
            "winner_id": None,
            "created_at": now(),
            "last_combat": None,
        }
        first = player_ids[0]
        game["reinforcements_left"] = self.calculate_reinforcements(game, first)
        return game

    def calculate_reinforcements(self, game: dict, player_id: str) -> int:
        owned = [tid for tid, t in game["territories"].items() if t["owner"] == player_id]
        base = max(3, math.floor(len(owned) / 3))
        continent = 0
        for c_name, c_territories in CONTINENTS.items():
            if all(game["territories"][tid]["owner"] == player_id for tid in c_territories):
                continent += CONTINENT_BONUS[c_name]
        return base + continent

    def check_winner(self, room: dict):
        game = room["game"]
        alive = [p["id"] for p in room["players"] if self.player_alive(room, p["id"])]
        if len(alive) == 1:
            game["winner_id"] = alive[0]
            room["status"] = "finished"
            room["log"].append(f"Winner: {self.name_by_id(room, alive[0])}.")

    def handle_player_elimination(self, room: dict, player_id: str):
        if not self.player_alive(room, player_id):
            pl = self.find_player(room, player_id)
            if pl and pl["alive"]:
                pl["alive"] = False
                room["log"].append(f"{pl['name']} was eliminated.")

    def player_alive(self, room: dict, player_id: str) -> bool:
        game = room["game"]
        return any(t["owner"] == player_id for t in game["territories"].values())

    def find_player(self, room: dict, player_id: str):
        for p in room["players"]:
            if p["id"] == player_id:
                return p
        return None

    def name_by_id(self, room: dict, player_id: str) -> str:
        pl = self.find_player(room, player_id)
        return pl["name"] if pl else "Unknown"

    def clean_name(self, name: str) -> str:
        text = (name or "Player").strip()
        text = " ".join(text.split())
        text = text[:18]
        return text or "Player"

    def dedupe_name(self, base: str, used: set) -> str:
        i = 2
        candidate = base
        while candidate.lower() in used:
            suffix = f" {i}"
            candidate = (base[: max(1, 18 - len(suffix))] + suffix).strip()
            i += 1
        return candidate

    def sanitize_room(self, room: dict, player_id: str):
        out = {
            "code": room["code"],
            "status": room["status"],
            "host_id": room["host_id"],
            "you": player_id,
            "players": [
                {
                    "id": p["id"],
                    "name": p["name"],
                    "color": p["color"],
                    "is_human": p["is_human"],
                    "alive": p["alive"],
                }
                for p in room["players"]
            ],
            "log": room["log"][-30:],
            "config": {
                "max_players": MAX_PLAYERS,
                "min_players": MIN_PLAYERS,
                "ai_supported": False,
            },
        }

        if room["game"]:
            game = room["game"]
            out["game"] = {
                "turn_order": game["turn_order"],
                "turn_index": game["turn_index"],
                "phase": game["phase"],
                "reinforcements_left": game["reinforcements_left"],
                "winner_id": game["winner_id"],
                "fortified_this_turn": game["fortified_this_turn"],
                "territories": deepcopy(game["territories"]),
                "territory_defs": TERRITORIES,
                "continent_bonus": CONTINENT_BONUS,
            }
        else:
            out["game"] = None
        return out


STORE = GameStore()


class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/" or path == "/index.html":
            return self.serve_static("index.html", "text/html; charset=utf-8")
        if path == "/styles.css":
            return self.serve_static("styles.css", "text/css; charset=utf-8")
        if path == "/app.js":
            return self.serve_static("app.js", "application/javascript; charset=utf-8")
        if path == "/api/state":
            query = parse_qs(parsed.query)
            room = (query.get("room") or [""])[0]
            player = (query.get("player") or [""])[0]
            try:
                payload = STORE.get_state(room, player)
                return json_response(self, 200, {"ok": True, "state": payload})
            except ApiError as err:
                return json_response(self, err.status, {"ok": False, "error": err.message})

        return json_response(self, 404, {"ok": False, "error": "Not found"})

    def do_POST(self):
        parsed = urlparse(self.path)
        try:
            payload = self.read_json()
        except ApiError as err:
            return json_response(self, err.status, {"ok": False, "error": err.message})

        if parsed.path == "/api/create-room":
            try:
                code, player_id = STORE.create_room(payload.get("name", "Player"))
                return json_response(self, 200, {"ok": True, "code": code, "player": player_id})
            except ApiError as err:
                return json_response(self, err.status, {"ok": False, "error": err.message})

        if parsed.path == "/api/join-room":
            try:
                player_id = STORE.join_room(payload.get("code", ""), payload.get("name", "Player"))
                return json_response(self, 200, {"ok": True, "player": player_id})
            except ApiError as err:
                return json_response(self, err.status, {"ok": False, "error": err.message})

        if parsed.path == "/api/start-game":
            try:
                STORE.start_game(payload.get("code", ""), payload.get("player", ""))
                return json_response(self, 200, {"ok": True})
            except ApiError as err:
                return json_response(self, err.status, {"ok": False, "error": err.message})

        if parsed.path == "/api/action":
            try:
                STORE.apply_action(payload.get("code", ""), payload.get("player", ""), payload.get("action", {}))
                return json_response(self, 200, {"ok": True})
            except ApiError as err:
                return json_response(self, err.status, {"ok": False, "error": err.message})

        return json_response(self, 404, {"ok": False, "error": "Not found"})

    def read_json(self):
        length_str = self.headers.get("Content-Length", "0")
        try:
            length = int(length_str)
        except ValueError:
            raise ApiError(400, "Invalid content length")
        raw = self.rfile.read(length) if length > 0 else b"{}"
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            raise ApiError(400, "Body must be JSON")

    def serve_static(self, filename: str, content_type: str):
        path = STATIC_DIR / filename
        if not path.exists():
            return json_response(self, 404, {"ok": False, "error": "Missing static file"})
        text_response(self, 200, path.read_text(encoding="utf-8"), content_type)

    def log_message(self, fmt, *args):
        return


def main():
    host = "0.0.0.0"
    port = 8787
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"Risk Online server running at http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
