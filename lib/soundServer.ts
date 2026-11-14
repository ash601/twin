// Your voice takes: recorded in the browser and written into my-twin/voice/ as mono 48 kHz 24-bit WAV.
// The folder IS the list: a WAV or MP3 dropped in by hand shows up under "Use a take" too.
// (The recording side of Content Research's Sound screen, cut down to just takes.)

import { closeSync, existsSync, openSync, readSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DIRS, FFMPEG_BIN, ensureDirs, runCmd } from "./run";

const AUDIO_RE = /\.(wav|mp3|m4a|aac|webm|ogg|oga|opus|flac|aif|aiff)$/i;
/** At or below this the mic was muted. */
const SILENT_DB = -70;

export interface Take {
  id: string; // the file name in my-twin/voice
  name: string;
  size: number;
  mtime: number;
  secs?: number;
}

/** A WAV's length from its own header. */
function wavSecs(full: string): number | undefined {
  let fd: number | null = null;
  try {
    fd = openSync(full, "r");
    const b = Buffer.alloc(4096);
    const n = readSync(fd, b, 0, b.length, 0);
    if (n < 12 || b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WAVE") return undefined;
    let off = 12;
    let byteRate = 0;
    const size = statSync(full).size;
    while (off + 8 <= n) {
      const id = b.toString("ascii", off, off + 4);
      const len = b.readUInt32LE(off + 4);
      if (id === "fmt ") byteRate = b.readUInt32LE(off + 16);
      if (id === "data") return byteRate ? (len && off + 8 + len <= size ? len : size - off - 8) / byteRate : undefined;
      off += 8 + len + (len & 1);
    }
  } catch {
    /* unreadable: no length */
  } finally {
    if (fd !== null) closeSync(fd);
  }
  return undefined;
}

const itemOf = (name: string): Take => {
  const full = path.join(DIRS.voice(), name);
  const st = statSync(full);
  return { id: name, name, size: st.size, mtime: st.mtimeMs, secs: /\.wav$/i.test(name) ? wavSecs(full) : undefined };
};

export function listTakes(): Take[] {
  ensureDirs();
  return readdirSync(DIRS.voice(), { withFileTypes: true })
    .filter((d) => d.isFile() && AUDIO_RE.test(d.name))
    .map((d) => itemOf(d.name))
    .sort((a, b) => b.mtime - a.mtime);
}

/** A take's full path, or null. Only a bare file name that exists in my-twin/voice gets through. */
export function takePath(id: string): string | null {
  if (!id || id !== path.basename(id) || id.includes("..") || !AUDIO_RE.test(id)) return null;
  const full = path.join(DIRS.voice(), id);
  return existsSync(full) ? full : null;
}

const cleanBase = (s: string) =>
  s
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "")
    .slice(0, 120);

function uniqueName(dir: string, base: string, ext: string): string {
  let name = `${base}${ext}`;
  for (let i = 2; existsSync(path.join(dir, name)); i++) name = `${base} (${i})${ext}`;
  return name;
}

const pad = (n: number) => String(n).padStart(2, "0");
const stamp = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;

const tryUnlink = (p: string) => {
  try {
    if (existsSync(p)) unlinkSync(p);
  } catch {
    /* scratch */
  }
};

async function maxDb(full: string): Promise<number | null> {
  const r = await runCmd(FFMPEG_BIN, ["-hide_banner", "-nostats", "-i", full, "-af", "volumedetect", "-f", "null", "-"], { timeout: 120_000 });
  const m = /max_volume:\s*(-?[\d.]+|-inf) dB/.exec(r.stderr);
  if (!m) return null;
  return m[1] === "-inf" ? -Infinity : parseFloat(m[1]);
}

/** Turns a quiet take up to normal speech loudness (-16 LUFS), in place. Never fails the save. */
async function turnUp(full: string): Promise<void> {
  const clean = "highpass=f=70,afftdn=nf=-30:nr=10";
  const m = await runCmd(FFMPEG_BIN, ["-hide_banner", "-nostats", "-i", full, "-af", `${clean},loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json`, "-f", "null", "-"], { timeout: 120_000 });
  const j = /\{[\s\S]*\}/.exec(m.stderr);
  if (!m.ok || !j) return;
  let v: Record<string, string>;
  try {
    v = JSON.parse(j[0]);
  } catch {
    return;
  }
  if (!Number.isFinite(parseFloat(v.input_i)) || parseFloat(v.input_i) > -18) return;
  const tmp = full.replace(/\.wav$/i, ".loud.wav");
  const af = `${clean},loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${v.input_i}:measured_TP=${v.input_tp}:measured_LRA=${v.input_lra}:measured_thresh=${v.input_thresh}:offset=${v.target_offset}:linear=true`;
  const r = await runCmd(FFMPEG_BIN, ["-y", "-hide_banner", "-i", full, "-af", af, "-ar", "48000", "-c:a", "pcm_s24le", "-fflags", "+bitexact", "-map_metadata", "-1", tmp], { timeout: 120_000 });
  if (r.ok && existsSync(tmp) && statSync(tmp).size > 100) renameSync(tmp, full);
  else tryUnlink(tmp);
}

/** A take from the browser (webm/opus) → a WAV. If ffmpeg fails, the upload itself is kept, so a take is
 *  never lost to a conversion error. */
export async function saveTake(data: Buffer, wanted?: string): Promise<{ item: Take; warning?: string }> {
  if (data.length < 200) throw new Error("the recording was empty");
  ensureDirs();
  const dir = DIRS.voice();
  const raw = path.join(DIRS.work(), `${Date.now()}.webm`);
  writeFileSync(raw, data);
  const base = cleanBase(wanted || "") || `Voice ${stamp()}`;
  const name = uniqueName(dir, base, ".wav");
  const out = path.join(dir, name);
  const r = await runCmd(FFMPEG_BIN, ["-y", "-hide_banner", "-i", raw, "-vn", "-ac", "1", "-ar", "48000", "-c:a", "pcm_s24le", "-fflags", "+bitexact", "-map_metadata", "-1", out], { timeout: 600_000 });
  if (!r.ok || !existsSync(out) || statSync(out).size < 100) {
    tryUnlink(out);
    const keep = uniqueName(dir, base, ".webm");
    renameSync(raw, path.join(dir, keep));
    return { item: itemOf(keep), warning: "Couldn't turn it into a WAV (is ffmpeg installed?), so it's saved as the original .webm. HeyGen needs WAV or MP3, so install ffmpeg before you use it." };
  }
  tryUnlink(raw);
  const peak = await maxDb(out);
  const silent = peak !== null && peak <= SILENT_DB;
  if (!silent) await turnUp(out);
  return { item: itemOf(name), warning: silent ? "This take is pure silence: your mic was muted (check the mute button on the mic itself). It's saved anyway." : undefined };
}
