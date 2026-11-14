import { NextResponse } from "next/server";
import { publicConfig, readConfig, writeConfig, type Mode } from "../../../lib/config";
import { checkAccount, checkApiKey, checkClaude, setupPrompt } from "../../../lib/connect";
import { ROOT, ensureDirs, launchClaudeIn } from "../../../lib/run";

// The Connect strip.
//   GET                                → { config (never the key), prompt }
//   POST { action: "mode", mode }      → use account | api
//   POST { action: "check-claude" }    → `claude --version`
//   POST { action: "check-account" }   → `claude mcp list`, HeyGen line only
//   POST { action: "save-key", key }   → checks it with HeyGen; saved only if it works
//   POST { action: "check-key" }       → checks the saved key again
//   POST { action: "forget-key" }
//   POST { action: "voice", voiceId }  → the voice typed scripts are read in
//   POST { action: "open-claude" }     → Claude Code in my-twin/ with the setup prompt
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const out = (extra: object = {}) => NextResponse.json({ ok: true, config: publicConfig(), prompt: setupPrompt(), ...extra });

export async function GET() {
  return out();
}

export async function POST(req: Request) {
  try {
    const b = (await req.json().catch(() => ({}))) as { action?: string; mode?: Mode; key?: string; voiceId?: string };
    if (b.action === "mode") {
      if (b.mode !== "account" && b.mode !== "api") throw new Error("pick account or api");
      writeConfig({ mode: b.mode });
      return out();
    }
    if (b.action === "check-claude") return out({ result: await checkClaude() });
    if (b.action === "check-account") return out({ result: await checkAccount() });
    if (b.action === "save-key") {
      const res = await checkApiKey(b.key || "");
      if (res.ok) writeConfig({ apiKey: (b.key || "").trim(), api: res, mode: "api" });
      return out({ result: res });
    }
    if (b.action === "check-key") {
      const key = readConfig().apiKey;
      if (!key) throw new Error("No key saved yet.");
      const res = await checkApiKey(key);
      writeConfig({ api: res });
      return out({ result: res });
    }
    if (b.action === "forget-key") {
      writeConfig({ apiKey: undefined, api: undefined });
      return out();
    }
    if (b.action === "voice") {
      writeConfig({ voiceId: b.voiceId || undefined });
      return out();
    }
    if (b.action === "open-claude") {
      ensureDirs();
      launchClaudeIn(ROOT, setupPrompt());
      return out();
    }
    return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
