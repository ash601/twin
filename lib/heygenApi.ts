// API mode: this server talks to HeyGen directly with your API key (pay per second from your HeyGen API
// balance). Every endpoint here is from HeyGen's v3 docs at developers.heygen.com (checked 2026-11-14):
//
//   GET  /v3/users/me                     check the key + balance          (lib/connect.ts)   docs/api-key, user-profile
//   GET  /v3/avatars/looks?ownership=private&limit=50[&token=]   your looks   docs/avatar-looks
//        → { data: [{ id, name, avatar_type, preview_image_url, supported_api_engines, default_voice_id, preferred_orientation, status }], has_more, next_token }
//   GET  /v3/models/audio/voices?type=private|public[&language=en]&limit=   voices   docs/voices/overview
//        → { data: [{ voice_id, name, language, status, mode }], has_more, next_token }
//   POST /v3/assets  (multipart "file")   upload a take / photo → { data: { asset_id, url } }   docs/upload-assets
//        images: PNG/JPEG ≤32 MB; audio: MP3/WAV ≤50 MB (audio_asset_id takes ≤32 MB, per audio-to-video)
//   POST /v3/videos                       make it → { data: { video_id, status } }   reference/create-video
//        type "avatar": avatar_id + engine {type: avatar_v | avatar_iv}    generate-avatar-video, avatar-v, avatar-iv
//        type "image":  image {type:"asset_id", asset_id} (Avatar IV, no avatar is created)   image-to-video, audio-to-video
//        audio_asset_id | script + voice_id, aspect_ratio, resolution "1080p", background {type:"color", value}, remove_background
//        Idempotency-Key header = the job id, so a retried request can't make (and bill) the video twice.
//   GET  /v3/videos/{video_id}            poll → { data: { status: pending|processing|completed|failed, video_url, duration, failure_message } }
//
// NOT RUN against HeyGen while building this app: uploadAsset, createVideo and the poll/download loop
// (they spend API balance). The read-only calls (users/me, looks, voices) cost nothing.

import { createWriteStream, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { readConfig } from "./config";
import { DIRS, FFMPEG_BIN, FFPROBE_BIN, ROOT, ensureDirs, runCmd } from "./run";
import { listJobs, listLooks, readJob, saveJob, writeJson, type Job, type Look, type LookType, type Voice } from "./twinServer";

const BASE = "https://api.heygen.com";
const GREEN = "#00B140";

async function hg<T>(key: string, method: "GET" | "POST", p: string, body?: object | FormData, headers: Record<string, string> = {}): Promise<T> {
  const r = await fetch(`${BASE}${p}`, {
    method,
    headers: { "X-Api-Key": key, accept: "application/json", ...(body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body ? (body instanceof FormData ? body : JSON.stringify(body)) : undefined,
    signal: AbortSignal.timeout(120_000),
  });
  const j = (await r.json().catch(() => ({}))) as { data?: T; error?: { message?: string; code?: string } };
  if (!r.ok || j.error) throw new Error(j.error?.message || `HeyGen said no (HTTP ${r.status}).`);
  return j.data as T;
}

const keyOrThrow = () => {
  const c = readConfig();
  if (!c.apiKey) throw new Error("No API key saved. Paste it on the Connect strip.");
  return c.apiKey;
};

// ── Looks and voices (read-only, free) ──────────────────────────────────────────────────────────────

type ApiLook = { id: string; name?: string; avatar_type?: LookType; preview_image_url?: string; supported_api_engines?: string[]; default_voice_id?: string; preferred_orientation?: string; status?: string };
type ApiVoice = { voice_id: string; name?: string; language?: string; status?: string };
type Page<T> = { data?: T[]; has_more?: boolean; next_token?: string | null };

async function pages<T>(key: string, p: string, max: number): Promise<T[]> {
  const out: T[] = [];
  let token: string | null | undefined;
  for (let i = 0; i < max; i++) {
    const r = await fetch(`${BASE}${p}${token ? `&token=${encodeURIComponent(token)}` : ""}`, { headers: { "X-Api-Key": key, accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
    const j = (await r.json().catch(() => ({}))) as Page<T> & { error?: { message?: string } };
    if (!r.ok) throw new Error(j.error?.message || `HeyGen said no (HTTP ${r.status}).`);
    out.push(...(j.data || []));
    if (!j.has_more || !j.next_token) break;
    token = j.next_token;
  }
  return out;
}

/** The look's picture → looks/<id>.jpg (small). Kept as-is if ffmpeg can't shrink it. */
async function saveThumb(id: string, url?: string) {
  const out = path.join(DIRS.looks(), `${id}.jpg`);
  if (!url || existsSync(out)) return;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!r.ok) return;
    const tmp = path.join(DIRS.work(), `look-${id}`);
    writeFileSync(tmp, Buffer.from(await r.arrayBuffer()));
    const c = await runCmd(FFMPEG_BIN, ["-y", "-loglevel", "error", "-i", tmp, "-vf", "scale=480:-2", "-frames:v", "1", "-q:v", "4", out], { timeout: 30_000 });
    if (!c.ok || !existsSync(out)) writeFileSync(out, readFileSync(tmp));
  } catch {
    /* no picture: the tile shows its name */
  }
}

/** Fills looks.json and voices.json from your HeyGen account. Free: list calls only. */
export async function refreshFromApi(): Promise<{ looks: number; voices: number }> {
  const key = keyOrThrow();
  ensureDirs();
  const raw = await pages<ApiLook>(key, "/v3/avatars/looks?ownership=private&limit=50", 10);
  const looks: Look[] = raw
    .filter((l) => l.id && l.status !== "failed" && l.status !== "processing")
    .map((l) => ({ id: l.id, name: l.name || "Look", type: l.avatar_type || "photo_avatar", orientation: l.preferred_orientation, engines: l.supported_api_engines, defaultVoiceId: l.default_voice_id }));
  writeJson(path.join(ROOT, "looks.json"), looks);
  await Promise.all(raw.map((l) => saveThumb(l.id, l.preview_image_url)));

  const mine = await pages<ApiVoice>(key, "/v3/models/audio/voices?type=private&limit=100", 5);
  const pub = await pages<ApiVoice>(key, "/v3/models/audio/voices?type=public&language=en&limit=50", 1);
  const ok = (v: ApiVoice) => v.voice_id && (!v.status || v.status === "ACTIVE");
  const voices: Voice[] = [
    ...mine.filter(ok).map((v) => ({ id: v.voice_id, name: v.name || "My voice", language: v.language, mine: true })),
    ...pub.filter(ok).map((v) => ({ id: v.voice_id, name: v.name || "HeyGen voice", language: v.language, mine: false })),
  ];
  writeJson(path.join(ROOT, "voices.json"), voices);
  return { looks: looks.length, voices: voices.length };
}

// ── Making a video (spends API balance: untested here) ──────────────────────────────────────────────

/** Uploads a local file with POST /v3/assets → asset_id. UNTESTED (uploading is free, but only used on Make). */
async function uploadAsset(key: string, file: string, mime: string): Promise<string> {
  const fd = new FormData();
  fd.append("file", new Blob([readFileSync(file)], { type: mime }), path.basename(file));
  const d = await hg<{ asset_id: string }>(key, "POST", "/v3/assets", fd);
  if (!d?.asset_id) throw new Error("HeyGen took the upload but gave no asset id.");
  return d.asset_id;
}

/** HeyGen wants MP3/WAV audio and PNG/JPEG pictures. Takes go up as a small mp3; a webp photo as jpg. */
async function toMp3(src: string): Promise<string> {
  const out = path.join(DIRS.work(), `${path.basename(src).replace(/\.\w+$/, "")}-${Date.now()}.mp3`);
  const r = await runCmd(FFMPEG_BIN, ["-y", "-loglevel", "error", "-i", src, "-ac", "1", "-ar", "44100", "-b:a", "192k", out], { timeout: 300_000 });
  if (!r.ok || !existsSync(out)) throw new Error("Couldn't turn the take into an mp3. Is ffmpeg installed?");
  return out;
}
async function toJpg(src: string): Promise<string> {
  if (/\.(png|jpe?g)$/i.test(src)) return src;
  const out = path.join(DIRS.work(), `${path.basename(src).replace(/\.\w+$/, "")}-${Date.now()}.jpg`);
  const r = await runCmd(FFMPEG_BIN, ["-y", "-loglevel", "error", "-i", src, "-q:v", "2", out], { timeout: 60_000 });
  if (!r.ok || !existsSync(out)) throw new Error("Couldn't turn the photo into a jpg. Is ffmpeg installed?");
  return out;
}

const fileSafe = (s: string) => s.replace(/[^\w .,()'&+-]/g, "").replace(/\s+/g, " ").trim().slice(0, 60) || "Twin";

function update(id: string, patch: Partial<Job>) {
  const j = readJob(id);
  if (!j) return null;
  Object.assign(j, patch);
  for (const k of Object.keys(patch) as (keyof Job)[]) if (patch[k] === undefined) delete j[k];
  saveJob(j);
  return j;
}

// Jobs this server process is working on, so a poll is never started twice (kept on globalThis so a dev
// reload doesn't forget them).
const g = globalThis as unknown as { __twinActive?: Set<string> };
const active = (g.__twinActive ||= new Set<string>());

/** The request body for POST /v3/videos, from a job. Exported so it can be checked without sending it. */
export async function videoRequest(job: Job, key: string, upload = uploadAsset): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = { title: job.title, aspect_ratio: job.ratio, resolution: "1080p" };
  if (job.look.kind === "heygen") {
    body.type = "avatar";
    body.avatar_id = job.look.lookId;
    const eng = job.look.engines;
    if (job.engine === "best") {
      if (!eng || eng.includes("avatar_v")) body.engine = { type: "avatar_v" };
      else if (eng.includes("heygen-avatar-6")) body.engine = { type: "heygen-avatar-6" };
    } else body.engine = { type: "avatar_iv" };
  } else {
    // A photo is animated as-is (Avatar IV). No avatar is created in your account.
    body.type = "image";
    const jpg = await toJpg(job.look.path);
    body.image = { type: "asset_id", asset_id: await upload(key, jpg, /\.png$/i.test(jpg) ? "image/png" : "image/jpeg") };
  }
  if (job.voice.kind === "take") {
    update(job.id, { status: "making", note: "Uploading your voice…" });
    const mp3 = await toMp3(job.voice.path);
    body.audio_asset_id = await upload(key, mp3, "audio/mpeg");
  } else {
    body.script = job.voice.text;
    const look = job.look;
    const lookVoice = look.kind === "heygen" ? listLooks().find((l) => l.id === look.lookId)?.defaultVoiceId : undefined;
    const voiceId = job.voice.voiceId || lookVoice;
    if (voiceId) body.voice_id = voiceId;
    else if (job.look.kind === "photo") throw new Error("Pick a voice to read the script (step 2).");
  }
  if (job.background === "green") {
    body.background = { type: "color", value: GREEN };
    body.remove_background = true;
  }
  return body;
}

/** Make one job through the API, then poll it to the end. Returns at once; the work runs on. */
export function startApiJob(id: string): void {
  if (active.has(id)) return;
  active.add(id);
  void (async () => {
    try {
      const key = keyOrThrow();
      let job = readJob(id);
      if (!job) return;
      if (!job.heygenVideoId) {
        update(id, { status: "making", note: "Sending it to HeyGen…" });
        const body = await videoRequest(job, key);
        update(id, { note: "Sending it to HeyGen…" });
        const d = await hg<{ video_id: string }>(key, "POST", "/v3/videos", body, { "Idempotency-Key": `twin-${id}` });
        if (!d?.video_id) throw new Error("HeyGen didn't send back a video id.");
        job = update(id, { heygenVideoId: d.video_id, note: "HeyGen is making it" })!;
      }
      await pollToEnd(key, job);
    } catch (e) {
      update(id, { status: "failed", note: (e as Error).message.slice(0, 300) });
    } finally {
      active.delete(id);
    }
  })();
}

async function pollToEnd(key: string, job: Job) {
  const until = Date.now() + 90 * 60_000;
  while (Date.now() < until) {
    let v: { status?: string; video_url?: string | null; duration?: number | null; failure_message?: string | null };
    try {
      v = await hg(key, "GET", `/v3/videos/${encodeURIComponent(job.heygenVideoId!)}`);
    } catch (e) {
      // A dropped poll isn't a failed video: wait and ask again.
      update(job.id, { note: `Checking on it… (${(e as Error).message.slice(0, 80)})` });
      await new Promise((r) => setTimeout(r, 30_000));
      continue;
    }
    if (v.status === "failed") throw new Error(v.failure_message || "HeyGen couldn't make it.");
    if (v.status === "completed" && v.video_url) {
      update(job.id, { note: "Downloading it…" });
      ensureDirs();
      const name = `${fileSafe(job.title)}-${job.id.slice(-4)}.mp4`;
      const out = path.join(DIRS.videos(), name);
      const r = await fetch(v.video_url);
      if (!r.ok || !r.body) throw new Error(`Couldn't download the finished video (HTTP ${r.status}). It's still in your HeyGen account.`);
      await pipeline(Readable.fromWeb(r.body as import("node:stream/web").ReadableStream), createWriteStream(out));
      let secs = typeof v.duration === "number" ? v.duration : undefined;
      if (!secs) {
        const p = await runCmd(FFPROBE_BIN, ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", out], { timeout: 30_000 });
        secs = parseFloat(p.stdout) || undefined;
      }
      update(job.id, { status: "done", video: name, secs, doneAt: Date.now(), note: undefined });
      if (statSync(out).size < 1000) update(job.id, { status: "failed", note: "The downloaded file is empty. It's still in your HeyGen account." });
      return;
    }
    update(job.id, { status: "making", note: v.status === "pending" ? "Waiting in HeyGen's queue" : "HeyGen is making it" });
    await new Promise((r) => setTimeout(r, 15_000));
  }
  throw new Error("HeyGen took over 90 minutes. Press Try again to check on it once more (it won't be made twice).");
}

/** After a restart: pick up API jobs that were mid-way, so nothing paid for is lost. */
export function resumeApiJobs(): void {
  if (!readConfig().apiKey) return;
  for (const j of listJobs()) if (j.mode === "api" && (j.status === "making" || j.status === "waiting") && !active.has(j.id)) startApiJob(j.id);
}
