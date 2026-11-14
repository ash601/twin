"use client";

// The Connect strip on top of the Twin screen: pick ONE way for HeyGen to make your videos, see whether it
// is connected, switch any time.
//   Account → your HeyGen subscription credits, through the HeyGen connector in Claude Code.
//   API key → pay per second from your HeyGen API balance; this app calls HeyGen itself.

import { useEffect, useState } from "react";

export type Check = { ok: boolean; status: string; checkedAt: number };
export type PublicConfig = {
  mode?: "account" | "api";
  voiceId?: string;
  claude?: Check & { version?: string };
  account?: Check;
  api?: Check & { balance?: string };
  keyHint?: string;
  hasKey: boolean;
  root: string;
};

const LINKS = {
  connectors: "https://claude.ai/settings/connectors",
  claudeCode: "https://code.claude.com/docs/en/setup",
  apiKeys: "https://platform.heygen.com/api-keys",
  pricing: "https://platform.heygen.com/pricing",
};

const smallBtn =
  "text-[12px] px-2.5 py-1.5 border border-white/10 rounded-md text-[color:var(--mist)] hover:text-[color:var(--warm-ivory)] hover:border-white/25 disabled:opacity-40 disabled:cursor-not-allowed";
const Dot = ({ on }: { on: boolean }) => <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${on ? "bg-emerald-400" : "bg-white/25"}`} />;

const post = (body: object) => fetch("/api/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());

export function isConnected(c?: PublicConfig | null) {
  if (!c?.mode) return false;
  return c.mode === "account" ? !!c.account?.ok : c.hasKey && !!c.api?.ok;
}

export default function ConnectStrip({ cfg, prompt, onChange }: { cfg: PublicConfig | null; prompt: string; onChange: (c: PublicConfig) => void }) {
  const [busy, setBusy] = useState<string>("");
  const [key, setKey] = useState("");
  const [keyErr, setKeyErr] = useState("");

  const act = async (what: string, body: object) => {
    setBusy(what);
    try {
      const j = await post(body);
      if (j.config) onChange(j.config);
      return j;
    } finally {
      setBusy("");
    }
  };

  // First time on this computer: find out if Claude Code is here and has HeyGen (runs in the background).
  useEffect(() => {
    if (!cfg) return;
    if (!cfg.claude) void act("claude", { action: "check-claude" });
    if (!cfg.account) void act("account", { action: "check-account" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!cfg]);

  const mode = cfg?.mode;
  const [showKey, setShowKey] = useState(false);
  const claudeOk = !!cfg?.claude?.ok;
  const mcpOk = !!cfg?.account?.ok;
  const apiOk = !!cfg?.hasKey && !!cfg?.api?.ok;

  // Use whatever is connected: your HeyGen account (MCP) first, else the API key.
  useEffect(() => {
    if (!cfg) return;
    const want = mcpOk && claudeOk ? "account" : apiOk ? "api" : undefined;
    if (want && mode !== want && !(mode && isConnected(cfg))) void act("mode", { action: "mode", mode: want });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg?.mode, mcpOk, apiOk, claudeOk]);

  const saveKey = async () => {
    setKeyErr("");
    const j = await act("key", { action: "save-key", key });
    if (j.result?.ok) {
      setKey("");
      setShowKey(false);
      if (!(mcpOk && claudeOk)) await act("mode", { action: "mode", mode: "api" });
    } else setKeyErr(j.result?.status || j.error || "That key didn't work.");
  };
  const recheck = async () => {
    await act("claude", { action: "check-claude" });
    await act("account", { action: "check-account" });
  };

  const link = "text-[12px] text-[color:var(--hot-ember)] hover:underline";
  const item = (ok: boolean, label: string, fix: React.ReactNode) => (
    <span className="flex items-center gap-2 text-[14px]">
      <span className={ok ? "text-emerald-300" : "text-[color:var(--mist)]"}>{ok ? "✓" : "○"}</span>
      <span className={ok ? "text-[color:var(--warm-ivory)]" : "text-[color:var(--mist)]"}>{label}</span>
      {!ok ? fix : null}
    </span>
  );

  return (
    <section className="glass-flat rounded-xl px-4 py-3 mb-6 flex flex-col gap-2">
      <div className="flex items-center gap-6 flex-wrap">
        {item(claudeOk, "Claude", <a className={link} href={LINKS.claudeCode} target="_blank" rel="noreferrer">install</a>)}
        {item(mcpOk, "HeyGen MCP", <button className={link} onClick={() => window.open(LINKS.connectors, "_blank", "noopener")}>connect</button>)}
        {item(apiOk, "API key", <button className={link} onClick={() => setShowKey((v) => !v)}>add</button>)}
        <button className="ml-auto text-[12px] text-[color:var(--mist)] hover:text-[color:var(--warm-ivory)]" disabled={!!busy} onClick={recheck}>
          {busy ? "checking…" : "check again"}
        </button>
      </div>
      {showKey ? (
        <div className="flex gap-1.5 items-center flex-wrap">
          <input type="password" autoComplete="off" autoFocus className="field flex-1 min-w-[220px] rounded-md px-2.5 py-1.5 text-[13px]" placeholder="Paste your HeyGen API key" value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === "Enter" && key.trim() && saveKey()} />
          <button className={smallBtn} disabled={!key.trim() || !!busy} onClick={saveKey}>{busy === "key" ? "Checking…" : "Save"}</button>
          <a className={link} href={LINKS.apiKeys} target="_blank" rel="noreferrer">get a key</a>
        </div>
      ) : null}
      {keyErr ? <div className="text-[12px] text-[#fca5a5]">{keyErr}</div> : null}
    </section>
  );
}
