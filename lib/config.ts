// my-twin/config.json: how you connected HeyGen, your API key (only if you pasted one), the voice you
// picked for typed scripts, and the last connection checks. The key never leaves this computer except to
// api.heygen.com, and the page only ever sees its last 4 characters.

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT, ensureDirs } from "./run";

export type Mode = "account" | "api";
export interface Check {
  ok: boolean;
  status: string;
  checkedAt: number;
}
export interface Config {
  mode?: Mode;
  apiKey?: string;
  voiceId?: string;
  claude?: Check & { version?: string };
  account?: Check;
  api?: Check & { balance?: string };
}

const FILE = () => path.join(ROOT, "config.json");

export function readConfig(): Config {
  try {
    return JSON.parse(readFileSync(FILE(), "utf-8")) as Config;
  } catch {
    return {};
  }
}

/** Writes through a temp file, so a crash mid-write can't leave a half-written config. */
export function writeConfig(patch: Partial<Config>): Config {
  ensureDirs();
  const next = { ...readConfig(), ...patch };
  for (const k of Object.keys(next) as (keyof Config)[]) if (next[k] === undefined) delete next[k];
  const tmp = FILE() + ".tmp";
  writeFileSync(tmp, JSON.stringify(next, null, 2));
  renameSync(tmp, FILE());
  return next;
}

/** What the page is allowed to see: everything except the key itself. */
export function publicConfig() {
  const c = readConfig();
  const { apiKey, ...rest } = c;
  return { ...rest, keyHint: apiKey ? `…${apiKey.slice(-4)}` : undefined, hasKey: !!apiKey, root: ROOT, hasConfig: existsSync(FILE()) };
}

/** Is the chosen way of connecting actually working right now? */
export function connected(c = readConfig()): boolean {
  if (c.mode === "account") return !!c.account?.ok;
  if (c.mode === "api") return !!c.apiKey && !!c.api?.ok;
  return false;
}
