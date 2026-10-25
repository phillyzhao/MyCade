# Mycade

**Your personal arcade.** Open Mycade on a laptop or TV, scan the QR code, and every phone in the room becomes a motion controller. Snap one photo and about 10 seconds later you have a toy-like mini-me in your own outfit and hairstyle (your **Buddy**). A rigged 3D version follows a minute or two later and plays every game as you.

Built at HackPSU Fall 2026 for the General Track, *The Mystery Stack*.

| Track requirement | How Mycade does it |
|---|---|
| Phone motion is the core input | Tilt to aim and balance, swing like a racket, wind up and release a bowling ball, steer like a wheel, shake to boost. Buttons only grip or confirm. |
| Rivalry | Session leaderboard across games, head-to-head records ("Omar leads Mark 3-1"), records (fastest bowl, best lap, longest rally, longest balance), and a champion podium. |
| Group play, 4+ | Every game seats 4. Racing and balance run all players at once, bowling rotates turns, tennis is 2v2 doubles. CPUs fill any empty seats. |

## The games

- **Strike Lanes** (bowling): tilt to line up, hold A, swing back and forward, then release A. Release speed sets ball speed and wrist twist sets the hook. Rapier physics pins, classic scoring, and STRIKE / SPARE / GUTTER / Split popups.
- **Sky Wobble** (balance): every player tilts their own floating island at the same time. Wind gusts push everyone and the islands shrink. Last one standing wins.
- **Cloud Karts** (racing): 2x2 split screen with a chase camera per player. Hold the phone sideways like a wheel, use the on-screen gas and brake, and shake to fire a full boost meter. Includes boost pads, 3 laps, and a photo-finish slow-mo.
- **Rally Court** (tennis): 2v2 doubles. Your player runs to the ball automatically; you time and power the swing. Swing hard and downward to smash, and flick up to toss your serve.

## Architecture

```
web/      Vite + React + react-three-fiber host screen (/) and phone controller (/play/ABCD)
server/   Node http(s) + ws rooms, avatar pipeline (Gemini -> Tripo), stats API
shared/   wire protocol, motion toolkit (calibration, tilt, steer, swing, release, shake, flick)
deploy/   VPS deploy script (Cloudflare quick tunnel for HTTPS)
```

- **Phones** run the motion detectors locally at sensor rate and stream compact input at 60 Hz. Discrete gestures (swing, release, shake, flick) are sent as events the instant they happen, so network jitter never smears a swing.
- **The host** is the authority for all game state. The server only relays input and screen changes, keyed by a 4-letter room code. Phones reconnect to the same seat.
- **Calibration** handles the iOS/Android sign difference in `accelerationIncludingGravity`, plus the player's resting grip.
- **Buddies** come in three tiers, and play never waits on the next one: a default toy body tinted in your color, then the Gemini image as a billboard card (about 10 s), then a rigged Tripo GLB normalized to height 1.0 with feet at y=0 and posed procedurally from the same animation code as everyone else.
- **Audio**: all music is original and composed in code with Tone.js (6 tracks plus stings). All sound effects are synthesized.

## Run it

```bash
npm install
cp .env.example .env     # add Vertex AI / Gemini + Tripo keys for Buddies (optional)
npm run demo             # builds the web app and starts the server
```

- Host screen: http://localhost:8787 on the laptop or TV.
- Phones: scan the QR code. The server also listens on **https://<LAN-IP>:8443** with a self-signed certificate, because iOS only allows motion sensors over HTTPS. For a certificate with no warning, run the server behind a tunnel or proxy and set `PUBLIC_URL` (see `deploy/deploy.sh`).
- No phones handy? In the lobby, use **+ Keyboard** (arrow keys tilt, Space = hold/release A, Enter = swing, S = shake) and **+ CPU**.
- Press **D** on the host for a live motion-debug overlay and **M** to mute.
- Dev mode with hot reload: `npm run dev` (Vite on 5173, proxied to the server on 8787).

Pre-generate Buddies for your team: drop full-body photos named `<name>.jpg` into a folder and run

```bash
node server/avatar/pregen.js path/to/photos
```

When a player joins with a matching name, they get their Buddy instantly.

## Tech

React 19, three.js r186, @react-three/fiber, drei, @react-three/postprocessing, Rapier (WASM physics), Tone.js, zustand, ws, Gemini 2.5 Flash Image (Vertex AI), Tripo (image-to-3D and auto-rig), @gltf-transform, sharp.

## Originality

All code was written at the event. All music, sound, art and 3D models are original and made in code. The only exception is each player's own Buddy, which Gemini and Tripo generate from their photo. Mycade has no affiliation with any console maker and uses no third-party game assets, names, logos, or music.
