// Twin: you on camera without filming. A HeyGen look (yours) or one of your own photos + your voice
// (a take, or a typed script read by a voice you pick) → an mp4.
//
// Two ways to make it, picked on the Connect strip:
//   account → Make writes a JOB file and opens Claude Code in my-twin/. Claude follows my-twin/CLAUDE.md,
//             makes the video with the HeyGen connector on your subscription credits, downloads it into
//             videos/ and marks the job done.
//   api     → Make writes the same job file and this server calls HeyGen's API with your key (pay per
//             second from your API balance), then updates the job the same way (lib/heygenApi.ts).
// Either way the screen just polls the job files.
//
// Everything is plain files under my-twin/, so Claude and you can both read and fix them by hand:
//   looks.json      your HeyGen looks  [{ id, name, type, orientation?, engines?, defaultVoiceId? }]
//   voices.json     your HeyGen voices [{ id, name, language?, mine }]   (for typed scripts)
//   looks/<id>.jpg  the looks' pictures
//   photos/         your own photos (any png / jpg / webp you drop in)
//   voice/          your voice takes
//   jobs/<id>.json  one per video asked for (status waiting → making → done | failed)
//   videos/         the finished mp4s (+ a transparent .webm when HeyGen gave one)
//   .thumbs/        cached small pictures      .trash/  deleted videos, kept just in case

import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readConfig, type Mode } from "./config";
import { takePath } from "./soundServer";
import { DIRS, FFMPEG_BIN, ROOT, ensureDirs, launchClaudeIn, reveal as revealPath, runCmd } from "./run";

const IMG_RE = /\.(png|jpe?g|webp)$/i;

export type Ratio = "9:16" | "16:9" | "1:1";
export type Background = "keep" | "green";
export type Engine = "best" | "cheap";
export type JobStatus = "waiting" | "making" | "done" | "failed";
export type LookType = "digital_twin" | "photo_avatar" | "studio_avatar";

export interface Look {
  id: string;
  name: string;
  type: LookType;
  orientation?: string;
  engines?: string[];
  defaultVoiceId?: string;
}
export interface Voice {
  id: string;
  name: string;
  language?: string;
  mine?: boolean;
}
export interface Photo {
  id: string; // "photos/<file name>"
  name: string;
  green: boolean;
}
export interface Job {
  id: string;
  createdAt: number;
  title: string;
  mode: Mode;
  look: { kind: "heygen"; lookId: string; name: string; type: LookType; engines?: string[] } | { kind: "photo"; photo: string; path: string; name: string };
  voice: { kind: "take"; take: string; path: string } | { kind: "script"; text: string; voiceId?: string; voiceName?: string };
  ratio: Ratio;
  background: Background;
  engine: Engine;
  status: JobStatus;
  note?: string;
  heygenVideoId?: string;
  video?: string;
  alpha?: string;
  secs?: number;
  doneAt?: number;
}

export const readJson = <T>(p: string, fallback: T): T => {
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as T;
  } catch {
    return fallback;
  }
};
export const writeJson = (p: string, v: unknown) => {
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(v, null, 2));
  renameSync(tmp, p);
};

export const listLooks = (): Look[] => readJson<Look[]>(path.join(ROOT, "looks.json"), []).filter((l) => l && l.id);
export const listVoices = (): Voice[] => readJson<Voice[]>(path.join(ROOT, "voices.json"), []).filter((v) => v && v.id);

/** Your photos, read live from my-twin/photos: a picture dropped in shows up as a look to pick. */
export function listPhotos(): { id: string; label: string; dir: string; photos: Photo[] }[] {
  ensureDirs();
  const photos = readdirSync(DIRS.photos())
    .filter((f) => IMG_RE.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((f) => ({ id: `photos/${f}`, name: f.replace(IMG_RE, ""), green: /green/i.test(f) }));
  return [{ id: "photos", label: "My photos", dir: DIRS.photos(), photos }];
}

export function photoPath(id: string): string | null {
  const file = id.startsWith("photos/") ? id.slice(7) : "";
  if (!file || file !== path.basename(file) || file.includes("..") || !IMG_RE.test(file)) return null;
  const p = path.join(DIRS.photos(), file);
  return existsSync(p) ? p : null;
}

/** A photo dropped onto the screen → into my-twin/photos (never over an existing one). */
export function addPhoto(name: string, data: Buffer): string {
  ensureDirs();
  const ext = (path.extname(name) || ".png").toLowerCase();
  if (!IMG_RE.test(ext)) throw new Error("That isn't a png, jpg or webp picture.");
  const base = path.basename(name, path.extname(name)).replace(/[<>:"/\\|?*\x00-\x1f]/g, "").trim().slice(0, 80) || `Photo ${Date.now()}`;
  let file = `${base}${ext}`;
  for (let i = 2; existsSync(path.join(DIRS.photos(), file)); i++) file = `${base} (${i})${ext}`;
  writeFileSync(path.join(DIRS.photos(), file), data);
  return `photos/${file}`;
}

export function listJobs(): Job[] {
  ensureDirs();
  return readdirSync(DIRS.jobs())
    .filter((f) => f.endsWith(".json"))
    .map((f) => readJson<Job | null>(path.join(DIRS.jobs(), f), null))
    .filter((j): j is Job => !!j && !!j.id)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export const jobFile = (id: string) => {
  if (!/^[\w-]+$/.test(id)) throw new Error("bad id");
  return path.join(DIRS.jobs(), `${id}.json`);
};
export const readJob = (id: string) => readJson<Job | null>(jobFile(id), null);
export const saveJob = (j: Job) => writeJson(jobFile(j.id), j);

const safeName = (s: string) => /^[\w .,()'&+-]+\.(mp4|webm|jpg)$/i.test(s) && !s.includes("..");

export function videoPath(file: string): string | null {
  if (!safeName(file)) return null;
  const p = path.join(DIRS.videos(), file);
  return existsSync(p) ? p : null;
}

export function lookThumbPath(id: string): string | null {
  if (!/^[\w-]{6,80}$/.test(id)) return null;
  const p = path.join(DIRS.looks(), `${id}.jpg`);
  return existsSync(p) ? p : null;
}

/** A small jpg of a photo, or of a video's first second, cached by path + size + mtime. Without ffmpeg
 *  it's null, and the route sends the photo itself instead. */
export async function thumbOf(full: string, isVideo: boolean): Promise<string | null> {
  ensureDirs();
  const st = statSync(full);
  const key = createHash("sha1").update(`${full}|${st.size}|${st.mtimeMs}`).digest("hex").slice(0, 20);
  const out = path.join(DIRS.thumbs(), `${key}.jpg`);
  if (existsSync(out)) return out;
  const args = isVideo
    ? ["-y", "-loglevel", "error", "-ss", "0.5", "-i", full, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "4", out]
    : ["-y", "-loglevel", "error", "-i", full, "-vf", "scale=480:480:force_original_aspect_ratio=increase", "-frames:v", "1", "-q:v", "4", out];
  const r = await runCmd(FFMPEG_BIN, args, { timeout: 30_000 });
  return r.ok && existsSync(out) ? out : null;
}

const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

export interface MakeInput {
  look: { kind: "heygen"; lookId: string } | { kind: "photo"; photo: string };
  voice: { kind: "take"; take: string } | { kind: "script"; text: string; voiceId?: string };
  ratio: Ratio;
  background: Background;
  engine: Engine;
  title?: string;
}

/** Writes the job file. Nothing is spent until it's made. */
export function makeJob(inp: MakeInput, mode: Mode): Job {
  ensureDirs();
  const ratio: Ratio = (["9:16", "16:9", "1:1"] as const).includes(inp.ratio) ? inp.ratio : "9:16";
  const background: Background = inp.background === "green" ? "green" : "keep";
  const engine: Engine = inp.engine === "cheap" ? "cheap" : "best";

  let look: Job["look"];
  if (inp.look?.kind === "heygen") {
    const l = listLooks().find((x) => x.id === (inp.look as { lookId: string }).lookId);
    if (!l) throw new Error("That look isn't in your HeyGen looks any more. Pick another.");
    look = { kind: "heygen", lookId: l.id, name: l.name, type: l.type, engines: l.engines };
  } else if (inp.look?.kind === "photo") {
    const p = photoPath(inp.look.photo);
    if (!p) throw new Error("That photo isn't in my-twin/photos any more.");
    look = { kind: "photo", photo: inp.look.photo, path: p, name: path.basename(p).replace(IMG_RE, "") };
  } else throw new Error("Pick how you look.");

  let voice: Job["voice"];
  if (inp.voice?.kind === "take") {
    const p = takePath(inp.voice.take);
    if (!p) throw new Error("That take isn't in my-twin/voice any more.");
    voice = { kind: "take", take: inp.voice.take, path: p };
  } else {
    const text = (inp.voice?.text || "").trim();
    if (!text) throw new Error("Write the script first.");
    if (text.length > 5000) throw new Error("That script is over 5,000 characters. Split it into parts.");
    const v = listVoices().find((x) => x.id === (inp.voice as { voiceId?: string }).voiceId);
    voice = { kind: "script", text, voiceId: v?.id, voiceName: v?.name };
  }

  const title =
    (inp.title || "").trim().slice(0, 80) ||
    (voice.kind === "script" ? voice.text.replace(/\s+/g, " ").slice(0, 48) + (voice.text.length > 48 ? "…" : "") : path.basename(voice.path).replace(/\.\w+$/, ""));
  const id = `${stamp()}-${randomBytes(2).toString("hex")}`;
  const job: Job = { id, createdAt: Date.now(), title, mode, look, voice, ratio, background, engine, status: "waiting" };
  saveJob(job);
  return job;
}

/** "Delete" moves the job and its files into my-twin/.trash, so nothing paid for is ever really gone. */
export function deleteJob(id: string): void {
  const p = jobFile(id);
  const job = readJson<Job | null>(p, null);
  if (!job) throw new Error("not found");
  ensureDirs();
  for (const f of [job.video, job.alpha]) {
    const src = f ? videoPath(f) : null;
    if (src) renameSync(src, path.join(DIRS.trash(), `${id}-${f}`));
  }
  renameSync(p, path.join(DIRS.trash(), `${id}.json`));
}

export function renameJob(id: string, title: string): void {
  const job = readJob(id);
  if (!job) throw new Error("not found");
  job.title = title.trim().slice(0, 80) || job.title;
  saveJob(job);
}

/** Put a job back in the queue after it failed (or got stuck). */
export function retryJob(id: string): Job {
  const job = readJob(id);
  if (!job) throw new Error("not found");
  job.status = "waiting";
  delete job.note;
  saveJob(job);
  return job;
}

/** Open Claude Code in my-twin/ and have it make every waiting job. */
export function launchMaker(): void {
  ensureDirs();
  launchClaudeIn(ROOT, "Make the waiting Twin videos. Follow CLAUDE.md in this folder.");
}

/** Open Claude Code in my-twin/ to refresh looks.json and voices.json from your HeyGen account. */
export function launchLookRefresh(): void {
  ensureDirs();
  launchClaudeIn(ROOT, "Refresh my looks and voices. Follow the 'Refresh my looks' part of CLAUDE.md in this folder.");
}

export function reveal(what?: { file?: string; folder?: "photos" | "voice" | "videos" | "root" }): void {
  ensureDirs();
  const full = what?.file ? videoPath(what.file) : null;
  if (full) return revealPath(full, true);
  const f = what?.folder;
  revealPath(f === "photos" ? DIRS.photos() : f === "voice" ? DIRS.voice() : f === "root" ? ROOT : DIRS.videos());
}

export const currentMode = (): Mode | undefined => readConfig().mode;
