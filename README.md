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
