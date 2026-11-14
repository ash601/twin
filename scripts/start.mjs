// What START.cmd (Windows) and START.command (Mac) run:
//   1. Twin already running? Just open the browser.
//   2. First time: install (npm install) and build (next build).
//   3. Start Twin on http://localhost:3960 and open the browser once it answers.
// Close this window (or press Turn off in the app) to stop it.

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3960;
const URL = `http://localhost:${PORT}`;
const win = process.platform === "win32";

const up = async () => {
  try {
    const r = await fetch(`${URL}/api/connect`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
};

const openBrowser = () => {
  if (process.env.TWIN_NO_BROWSER) return console.log(`Twin is up at ${URL}`);
  if (win) spawn("cmd", ["/c", "start", "", URL], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  else if (process.platform === "darwin") spawn("open", [URL], { detached: true, stdio: "ignore" }).unref();
  else spawn("xdg-open", [URL], { detached: true, stdio: "ignore" }).unref();
};

const npm = (args) => {
  const r = spawnSync(win ? "npm.cmd" : "npm", args, { cwd: ROOT, stdio: "inherit", shell: win });
  if (r.status !== 0) {
    console.error(`\n"npm ${args.join(" ")}" didn't work (see above). Check your internet connection and try START again.`);
    process.exit(1);
  }
};

if (await up()) {
  console.log(`Twin is already running. Opening ${URL}`);
  openBrowser();
  process.exit(0);
}

const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore", shell: win }).status === 0 || existsSync("/opt/homebrew/bin/ffmpeg") || existsSync("/usr/local/bin/ffmpeg");
if (!hasFfmpeg) console.log("Note: ffmpeg isn't installed. Twin runs without it, but recorded takes stay .webm and HeyGen needs WAV or MP3. See HOW-TO.html.\n");

if (!existsSync(path.join(ROOT, "node_modules", "next"))) {
  console.log("First run: installing (a minute or two)…\n");
  npm(["install", "--no-audit", "--no-fund"]);
}
if (!existsSync(path.join(ROOT, ".next", "BUILD_ID"))) {
  console.log("\nFirst run: building the app (about a minute)…\n");
  npm(["run", "build"]);
}

console.log(`\nStarting Twin on ${URL}  (close this window to stop it)\n`);
const next = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
const server = spawn(process.execPath, [next, "start", "-H", "127.0.0.1", "-p", String(PORT)], { cwd: ROOT, stdio: "inherit" });
server.on("exit", (code) => process.exit(code ?? 0));
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => server.kill());

for (let i = 0; i < 120; i++) {
  await new Promise((r) => setTimeout(r, 500));
  if (await up()) {
    openBrowser();
    break;
  }
}
