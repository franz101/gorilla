# GORILLAS.BAS — modern multiplayer clone

A modern JavaScript remake of the classic QBasic **GORILLAS.BAS** (1990), with DOS-style menus, chiptune music, destructible buildings, and serverless P2P multiplayer.

**Play it here: https://franz101.github.io/gorilla/**

## Features

- Faithful physics and win-rules transcribed from the original `gorilla.bas`
- Hotseat, vs-computer, and online P2P (WebRTC via Trystero — no server)
- Chiptune music + sound effects (Web Audio, no external files)
- DOS/QBasic-style blue menu with ASCII logo
- Arrow-key aiming: `←`/`→` angle, `↑`/`↓` velocity, `Enter` fire (sliders also supported)
- Destructible buildings, self-hit penalty, adjustable gravity

## Files

- `index.html` — the whole game (self-contained, single file)
- `gorillas.bas` — GORILLAS 2.2 Deluxe (reference)
- `source/gorilla.bas` — the original 1990 Microsoft source

---

# LUNAR.BAS — modern multiplayer clone

A modern JavaScript remake of the classic 1978 Creative Computing **LUNAR** lander (Jim Storer's physics via David Ahl's BASIC), in the same single-file style. Playable at `lander/`.

**Play it here: https://franz101.github.io/gorilla/lander/**

## Features

- Rocket-equation physics, initial conditions and landing rules transcribed 1:1 from `lander/lunar.bas` (10-second burn decisions, fuel-out free fall, PERFECT/GOOD/DAMAGE/CRASH verdicts verbatim)
- Solo flight, two-pilot hotseat, and online P2P racing (WebRTC via Trystero — no server)
- Chiptune music + thrust rumble + landing fanfares (Web Audio, no external files)
- DOS-style menu, starfield with Earth, cratered moon surface, exhaust/dust/debris particles, screen shake
- Scoring: fuel left + landing bonus; best-pilot record persists in localStorage

## Files

- `lander/index.html` — the whole game (self-contained, single file)
- `lander/lunar.bas` — the original 1978 LUNAR source (verbatim download)

## Tests

- `bun test:multiplayer` — gorillas P2P integration (two real Chrome instances)
- `bun test:lander` — lander P2P integration (connect, lockstep start, telemetry)
