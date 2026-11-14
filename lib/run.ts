// Shared server helpers: where your data lives, running ffmpeg, opening Claude Code in a terminal, and
// showing a folder in Explorer / Finder. Windows and Mac each keep their own way of doing things.

import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** Everything you make lives here, next to the app: looks, photos, voice takes, jobs, videos, config. */
export const ROOT = process.env.TWIN_DATA || path.join(process.cwd(), "my-twin");

export const DIRS = {
  looks: () => path.join(ROOT, "looks"),
  photos: () => path.join(ROOT, "photos"),
  voice: () => path.join(ROOT, "voice"),
  jobs: () => path.join(ROOT, "jobs"),
  videos: () => path.join(ROOT, "videos"),
  thumbs: () => path.join(ROOT, ".thumbs"),
  trash: () => path.join(ROOT, ".trash"),
  work: () => path.join(ROOT, ".work"),
};

export const ensureDirs = () => {
  mkdirSync(ROOT, { recursive: true });
  Object.values(DIRS).forEach((d) => mkdirSync(d(), { recursive: true }));
};

/** ffmpeg / ffprobe: from FFMPEG_BIN, else PATH, else the usual Homebrew spots on a Mac (a double-clicked
 *  START.command doesn't always carry Homebrew's PATH). */
function findBin(name: "ffmpeg" | "ffprobe"): string {
  const env = name === "ffmpeg" ? process.env.FFMPEG_BIN : process.env.FFPROBE_BIN;
  if (env) return env;
  if (process.platform === "darwin") for (const d of ["/opt/homebrew/bin", "/usr/local/bin"]) if (existsSync(path.join(d, name))) return path.join(d, name);
  return name;
}
export const FFMPEG_BIN = findBin("ffmpeg");
export const FFPROBE_BIN = findBin("ffprobe");

/** execFile that never rejects. windowsHide so no console window flashes up. */
export function runCmd(cmd: string, args: string[], opts: { cwd?: string; timeout?: number } = {}): Promise<{ ok: boolean; stdout: string; stderr: string; err?: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: opts.cwd || process.cwd(), timeout: opts.timeout ?? 300_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) =>
      resolve({ ok: !error, stdout: (stdout || "").toString(), stderr: (stderr || "").toString(), err: error ? error.message || String(error) : undefined }),
    );
  });
}

/** The claude binary: the installer's own copy when it's there, else whatever PATH finds. */
export function claudeBin(): string {
  const local = path.join(os.homedir(), ".local", "bin", process.platform === "win32" ? "claude.exe" : "claude");
  return existsSync(local) ? local : "claude";
}

/** The env a visible terminal gets: without the markers that make a new `claude` think it's nested,
 *  and without NO_COLOR / FORCE_COLOR=0 (they turn the window white). */
export function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k === "CLAUDECODE" || k.startsWith("CLAUDE_CODE_") || k === "CLAUDE_PID" || k === "NO_COLOR") delete env[k];
  if (env.FORCE_COLOR === "0") delete env.FORCE_COLOR;
  return env;
}
const STRIP = ["CLAUDECODE", "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_PID", "NO_COLOR", "FORCE_COLOR"];

/** Opens a new terminal window with Claude Code in `folder`, starting on `prompt`. */
export function launchClaudeIn(folder: string, prompt: string): void {
  const bin = claudeBin();
  const env = cleanEnv();
  if (process.platform === "win32") {
    // A tiny .cmd so a folder path with spaces survives quoting; it clears the same variables in case
    // it's ever run by hand.
    const bat = path.join(folder, "_launch.cmd");
    const sets = STRIP.map((k) => `set "${k}="`).join("\r\n");
    writeFileSync(bat, `@echo off\r\ncd /d "${folder}"\r\n${sets}\r\n"${bin}" "${prompt.replace(/"/g, "'")}"\r\n`);
    spawn("cmd", ["/c", `start "Twin - Claude Code" cmd /k "${bat}"`], { detached: true, stdio: "ignore", windowsHide: false, env, windowsVerbatimArguments: true }).unref();
    return;
  }
  if (process.platform === "darwin") {
    const cmd = `cd ${JSON.stringify(folder)} && unset ${STRIP.join(" ")}; ${JSON.stringify(bin)} ${JSON.stringify(prompt)}`;
    const osa = `tell application "Terminal"\nactivate\ndo script ${JSON.stringify(cmd)}\nend tell`;
    spawn("osascript", ["-e", osa], { detached: true, stdio: "ignore", env }).unref();
    return;
  }
  spawn("x-terminal-emulator", ["-e", "bash", "-lc", `cd ${JSON.stringify(folder)} && ${JSON.stringify(bin)} ${JSON.stringify(prompt)}; exec bash`], { detached: true, stdio: "ignore", env }).unref();
}

/** Show a folder, or a file selected inside its folder. */
export function reveal(target: string, isFile = false): void {
  if (process.platform === "win32") spawn("explorer", isFile ? ["/select,", target] : [target], { detached: true, stdio: "ignore" }).unref();
  else if (process.platform === "darwin") spawn("open", isFile ? ["-R", target] : [target], { detached: true, stdio: "ignore" }).unref();
  else spawn("xdg-open", [isFile ? path.dirname(target) : target], { detached: true, stdio: "ignore" }).unref();
}
