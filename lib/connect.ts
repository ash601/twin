// The connection checks behind the Connect strip.
//   Claude Code: `claude --version`.
//   Account mode: `claude mcp list`, looking for the HeyGen connector and whether it says Connected.
//     Only the HeyGen line's name and status are kept: other lines can carry private URLs and tokens.
//   API mode: GET https://api.heygen.com/v3/users/me with the key (free, read-only), per HeyGen's docs
//     (developers.heygen.com/docs/api-key: "Verify your key is working by fetching /v3/users/me").

import { claudeBin, ROOT, runCmd } from "./run";
import { writeConfig, type Config } from "./config";

/** Runs claude. A `claude` that is an npm .cmd shim can't be run by execFile on Windows, so on ENOENT /
 *  EINVAL it tries once more through cmd. */
async function claude(args: string[], timeout: number) {
  const bin = claudeBin();
  let r = await runCmd(bin, args, { cwd: ROOT, timeout });
  if (!r.ok && process.platform === "win32" && bin === "claude" && /ENOENT|EINVAL|not recognized/i.test(r.err || "")) r = await runCmd("cmd", ["/c", "claude", ...args], { cwd: ROOT, timeout });
  return r;
}

export async function checkClaude(): Promise<Config["claude"]> {
  const r = await claude(["--version"], 30_000);
  const version = (r.stdout.match(/\d+\.\d+\.\d+/) || [])[0];
  const res = r.ok && version ? { ok: true, status: `Claude found · ${version}`, version, checkedAt: Date.now() } : { ok: false, status: "Claude not found", checkedAt: Date.now() };
  writeConfig({ claude: res });
  return res;
}

export async function checkAccount(): Promise<Config["account"]> {
  const r = await claude(["mcp", "list"], 90_000);
  let res: NonNullable<Config["account"]>;
  if (!r.ok && !r.stdout) {
    res = { ok: false, status: "Claude Code isn't installed (or won't start), so the HeyGen connector can't be checked.", checkedAt: Date.now() };
  } else {
    const lines = r.stdout.split(/\r?\n/).filter((l) => /heygen/i.test(l.split(":")[0] || ""));
    const good = lines.find((l) => /✔|✓|\bConnected\b/.test(l) && !/needs auth|failed|✗|✘/i.test(l));
    if (good) res = { ok: true, status: `Connected · ${good.split(":")[0].trim()}`, checkedAt: Date.now() };
    else if (lines.some((l) => /needs auth/i.test(l))) res = { ok: false, status: "HeyGen is added in Claude but needs you to log in.", checkedAt: Date.now() };
    else if (lines.length) res = { ok: false, status: "HeyGen is added in Claude but isn't connecting.", checkedAt: Date.now() };
    else res = { ok: false, status: "Claude Code doesn't have the HeyGen connector yet.", checkedAt: Date.now() };
  }
  writeConfig({ account: res });
  return res;
}

const money = (n: number) => `$${n.toFixed(2)}`;

/** Checks a key against HeyGen. Saves the result (and the key, when it works or when asked to). */
export async function checkApiKey(key: string): Promise<NonNullable<Config["api"]>> {
  const k = key.trim();
  if (!k) return { ok: false, status: "Paste your API key first.", checkedAt: Date.now() };
  let res: NonNullable<Config["api"]>;
  try {
    const r = await fetch("https://api.heygen.com/v3/users/me", { headers: { "X-Api-Key": k, accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    const j = (await r.json().catch(() => ({}))) as {
      data?: {
        billing_type?: string;
        wallet?: { currency?: string; remaining_balance?: number | null } | null;
        subscription?: { plan?: string; credits?: { premium_credits?: { remaining?: number } } } | null;
        usage_based?: { spending_current_usd?: number | null; spending_cap_usd?: number | null } | null;
      };
      error?: { message?: string; code?: string };
    };
    if (r.ok && j.data) {
      const d = j.data;
      let balance: string | undefined;
      if (d.wallet && typeof d.wallet.remaining_balance === "number")
        balance = d.wallet.currency === "usd" ? `${money(d.wallet.remaining_balance)} left` : `${d.wallet.remaining_balance} credits left`;
      else if (d.subscription) balance = `${d.subscription.plan || "plan"}${d.subscription.credits?.premium_credits?.remaining !== undefined ? ` · ${d.subscription.credits.premium_credits.remaining} credits` : ""}`;
      else if (d.usage_based && typeof d.usage_based.spending_current_usd === "number")
        balance = `${money(d.usage_based.spending_current_usd)} spent${typeof d.usage_based.spending_cap_usd === "number" ? ` of ${money(d.usage_based.spending_cap_usd)}` : ""}`;
      res = { ok: true, status: "Connected · API key", balance, checkedAt: Date.now() };
    } else {
      const said = j.error?.message || `HTTP ${r.status}`;
      res = {
        ok: false,
        status: r.status === 401 || r.status === 403 ? `HeyGen didn't accept that key (${said}). Copy it again from platform.heygen.com → API keys.` : `HeyGen said no: ${said}`,
        checkedAt: Date.now(),
      };
    }
  } catch (e) {
    res = { ok: false, status: `Couldn't reach HeyGen: ${(e as Error).message}`, checkedAt: Date.now() };
  }
  return res;
}

/** The prompt the page shows to copy, and that "Open Claude here" starts with. */
export function setupPrompt(): string {
  return `Set up my Twin app in this folder (${ROOT}): check the HeyGen connector is connected, list my HeyGen looks and voices into looks.json and voices.json (follow CLAUDE.md here), and tell me if anything is missing.`;
}
