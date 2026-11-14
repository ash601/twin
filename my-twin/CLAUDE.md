# Twin: make the waiting videos

This folder (`my-twin/`) backs the **Twin** app (http://localhost:3960). The user picks a look, a voice and a
shape there and presses **Make with Claude**. That writes a job file into `jobs/` and opens you here.

Use the **HeyGen connector tools** (`mcp__claude_ai_HeyGen__*`, or `mcp__heygen__*` if that's how it's named).
They spend the user's HeyGen **subscription** credits, which is the point of this mode. Never use an API key
or call `api.heygen.com` yourself: if `config.json` has an `apiKey`, ignore it (that's the other mode).

If the HeyGen tools aren't there, say so in one line: "The HeyGen connector isn't connected. On claude.ai →
Settings → Connectors, turn on HeyGen and log in, then restart Claude Code." Then stop.

The user already chose everything, including the cost. Don't ask for confirmation, just make it. Keep chat
short: one line per job ("Making X…", "Done: X").

## Files

- `jobs/<id>.json`: one per video. Read them all and pick the ones with `"status": "waiting"`, oldest first.
  Skip jobs whose `"mode"` is `"api"` (the app makes those itself).
- `looks.json`: the user's HeyGen looks, `[{ "id", "name", "type", "orientation", "engines", "defaultVoiceId" }]`.
- `voices.json`: the user's voices, `[{ "id", "name", "language", "mine" }]`.
- `looks/<id>.jpg`: each look's picture.
- `photos/`, `voice/`: the user's own photos and voice takes (jobs point at them by full path).
- `videos/`: put finished files here. The screen polls `jobs/` every few seconds.

## Refresh my looks

When asked to refresh looks and voices (or when `looks.json` is missing or empty):

1. `list_avatar_looks(ownership="private", limit=50)`, following `token` while there are more pages. Keep looks
   whose status is completed (or has no status). Write `looks.json` as
   `[{ "id": look.id, "name": look.name, "type": look.avatar_type, "orientation": look.preferred_orientation,
   "engines": look.supported_api_engines, "defaultVoiceId": look.default_voice_id }]`.
2. Save each look's `preview_image_url` as `looks/<id>.jpg`:
   `curl -sL "<url>" -o tmp && ffmpeg -y -loglevel error -i tmp -vf scale=480:-2 -frames:v 1 looks/<id>.jpg`.
   Skip ones already there.
3. `list_voices(type="private", limit=100)` (the user's own clones, `mine: true`), then
   `list_voices(type="public", language="en", limit=50)` (`mine: false`). Keep only ACTIVE voices. Write
   `voices.json` with your voices first.
4. Say in one line how many looks and voices you found. If there are no private looks, add: "No avatars in
   your HeyGen account yet: you can still use your own photos (My photos), or make an avatar at app.heygen.com."

## The job file: write it as you go

The screen shows whatever the job says:
1. At the start, set `"status": "making"` and `"note": "Uploading your voice…"`.
2. After the create call, set `"heygenVideoId"` and `"note": "HeyGen is making it"`.
3. At the end, set `"status": "done"`, `"video": "<file name>"`, `"secs"` (ffprobe duration), `"doneAt"` (ms)
   and delete `note`. Or, on failure, set `"status": "failed"` and a short plain `"note"` saying why.

## Making one job

1. **Upload a local file** (voice take or photo); no public URL needed:
   - Voice takes are WAV. Convert first: `ffmpeg -y -i "<take>" -ac 1 -ar 44100 -b:a 192k "<tmp>.mp3"`.
   - A `.webp` photo: convert to jpg first (`ffmpeg -y -i in.webp -q:v 2 out.jpg`). PNG / JPG go up as they are.
   - `create_asset_upload(filename, contentType, sizeBytes)` → `upload_url` + `upload_headers`.
   - `curl -s -X PUT "<upload_url>" -H "<each upload header>" --data-binary @"<file>"` (expect HTTP 200).
   - `complete_asset_upload(assetId)` → use that asset id.
2. **The look**
   - `job.look.kind == "heygen"` → `create_video_from_avatar` with `avatarId = job.look.lookId`.
   - `job.look.kind == "photo"` → `create_video_from_image` with `image = {type:"asset_id", asset_id:<uploaded photo>}`.
     This animates the photo as it is. Do NOT create a photo avatar.
3. **Create**:
   - `title = job.title`, `aspectRatio = job.ratio`, `resolution = "1080p"`.
   - Voice: `job.voice.kind == "take"` → `audioAssetId`. `"script"` → `script = job.voice.text` VERBATIM, plus
     `voiceId = job.voice.voiceId` when it's set. With no voiceId: for a HeyGen look leave it out (the look's own
     voice is used); for a photo use the first `mine: true` voice in `voices.json`, else the first voice there,
     else `list_voices(type="public", language="en", limit=1)`.
   - Engine (HeyGen looks only): `job.engine == "best"` → `{type:"avatar_v"}` if `"avatar_v"` is in the look's
     `engines` (or `engines` is missing); otherwise leave `engine` out. `"cheap"` → `{type:"avatar_iv"}`.
     Photos have no engine choice.
   - `job.background == "green"` → `background = {type:"color", value:"#00B140"}` + `removeBackground: true`.
     If HeyGen rejects that, make it with `outputFormat:"webm"` instead. Save the transparent webm as the
     job's `alpha` file, and composite a green mp4 for `video`:
     `ffmpeg -y -c:v libvpx-vp9 -i in.webm -f lavfi -i color=0x00B140:s=<WxH>:r=<fps> -filter_complex "[1][0]overlay=shortest=1,format=yuv420p" -c:v libx264 -crf 18 -c:a aac out.mp4`
   - Poll `get_video` about every 20 s until it's completed or failed (usually 1–3 min).
4. **Download** `video_url` with curl into `videos/<title>-<last 4 of job id>.mp4`. Keep the name to letters,
   numbers, spaces and `.,()'&+-` (the screen refuses anything else). Then ffprobe the duration and finish the job.

Several waiting jobs: create them all first, then poll them together.

If a call is dropped (ECONNRESET), it may still have worked. Check `list_videos` before trying again, so
nothing is paid for twice.
