# Sponsor / API usage

## Google Gemini (via Vertex AI)
- **Model:** `gemini-2.5-flash-image`. Configurable with `GEMINI_IMAGE_MODEL`.
- **Where:** `server/avatar/pipeline.js`.
- **What it does:** turns a player's full-body phone photo into an original, toy-like party-game character. It keeps the player's hair, skin tone, outfit colors and accessories, and outputs a front view in T-pose on a plain white background so the next stage can make a clean 3D model. If the first result isn't usable, the pipeline retries once with a stricter prompt.
- **Latency:** about 10 s from upload to the image appearing on the big screen and on the player's phone.
- **Privacy:** the original photo is held in memory only. It is downscaled and never written to disk.

## Tripo (image to 3D and auto-rig)
- **Where:** `server/avatar/pipeline.js`. It uses the Tripo v3 OpenAPI: `image_to_model`, then the rig check, then `animate_rig` on the biped template, with GLB output.
- **What it does:** turns the Gemini character image into a textured, rigged 3D Buddy.
- **Post-processing in our code:**
  - `@gltf-transform` maps the bones to our canonical skeleton.
  - Every model is normalized to height 1.0, feet at y=0, facing +Z.
  - All Buddies then share the same procedural animation code: idle, run, bowl, swing, serve, cheer, sad, fall, and the driving pose.
- **Credit discipline:** paid calls are never retried blindly. Pre-generation is cache-aware. Setting `AVATAR_3D=0` switches to image-only.

## Tiger Data (Timescale / Postgres), optional
- **Where:** `server/stats.js`. Enable it by setting `DATABASE_URL`.
- **Tables:**
  - `matches`: every result, with game, standings and records.
  - `motion_events`: a Timescale hypertable of per-swing and per-release motion summaries (power, spin, peak acceleration) streamed from the phones.
- **Fallback:** without `DATABASE_URL`, the same data goes to a local JSON file, which powers the rivalry board and the all-time records.

## Cloudflare
- **Where:** `deploy/deploy.sh`.
- **What it does:** a quick tunnel gives the realtime server a trusted HTTPS URL. iOS only grants motion-sensor access over HTTPS.
