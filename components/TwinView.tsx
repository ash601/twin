"use client";

// Twin: you on camera without filming. Pick how you look (one of your HeyGen looks, or any of your own
// photos), give it your voice (record now, a take, or a typed script read by a HeyGen voice), pick the
// shape, and Make. HeyGen makes it one of two ways, picked on the Connect strip:
//   account → Make writes a job and opens Claude Code in my-twin/, which makes it on your HeyGen
//             SUBSCRIPTION credits with the HeyGen connector.
//   API key → this app calls HeyGen itself, paid per second from your HeyGen API balance.
// Either way the finished mp4 lands in "Your videos" by itself: this screen polls.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PageHeader from "./PageHeader";
import { Booth } from "./Booth";
import ConnectStrip, { isConnected, type PublicConfig } from "./ConnectStrip";
import { FolderIcon, PowerIcon, RefreshIcon } from "./icons";

type LookType = "digital_twin" | "photo_avatar" | "studio_avatar";
type Look = { id: string; name: string; type: LookType; orientation?: string; defaultVoiceId?: string };
type Voice = { id: string; name: string; language?: string; mine?: boolean };
type Photo = { id: string; name: string; green: boolean };
type Source = { id: string; label: string; dir: string; photos: Photo[] };
type Job = {
  id: string;
  createdAt: number;
  title: string;
  mode: "account" | "api";
  look: { kind: "heygen"; lookId: string; name: string; type: LookType } | { kind: "photo"; photo: string; name: string };
  voice: { kind: "take"; take: string } | { kind: "script"; text: string; voiceName?: string };
  ratio: Ratio;
  background: "keep" | "green";
  engine: "best" | "cheap";
  status: "waiting" | "making" | "done" | "failed";
  note?: string;
  video?: string;
  alpha?: string;
  secs?: number;
};
type Take = { id: string; name: string; mtime: number; secs?: number };
type Ratio = "9:16" | "16:9" | "1:1";
type VoiceMode = "rec" | "take" | "type";

const API = "/api/twin";
const post = (body: object) => fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;
// ~2.6 spoken words a second is a normal talking pace.
const scriptSecs = (t: string) => words(t) / 2.6;
const GREEN = "#00B140";
const PREF_KEY = "twin.prefs";

// HeyGen's subscription price per minute (Creator plan, as listed on heygen.com). A photo is animated on
// Avatar IV, the cheapest.
function creditsPerMin(engine: "best" | "cheap", photo: boolean) {
  if (photo) return 16;
  return engine === "best" ? 48 : 31;
}

const seg = "flex border border-white/10 rounded-lg p-[3px] gap-[3px]";
const segBtn = (on: boolean) =>
  `flex-1 px-2.5 py-1.5 rounded-md text-[13px] transition ${
    on ? "bg-[rgba(245,92,47,0.16)] text-[color:var(--warm-ivory)] shadow-[inset_0_0_0_1px_rgba(245,92,47,0.5)]" : "text-[color:var(--mist)] hover:text-[color:var(--warm-ivory)]"
  }`;
const chip = (on: boolean) =>
  `px-2.5 py-1 rounded-md text-[12px] border transition ${
    on ? "border-[color:var(--hot-ember)] bg-[rgba(245,92,47,0.14)] text-[color:var(--warm-ivory)]" : "border-white/10 text-[color:var(--mist)] hover:text-[color:var(--warm-ivory)]"
  }`;
const smallBtn = "text-[11.5px] px-2 py-1 border border-white/10 rounded-[5px] text-[color:var(--mist)] hover:text-[color:var(--warm-ivory)] hover:border-white/25";

function Step({ n, title, right, children }: { n: number; title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-t border-white/10 pt-4 pb-5">
      <div className="flex justify-between gap-3 mb-3 font-mono text-[11px] tracking-[0.2em] text-[color:var(--mist)]">
        <span>
          {n} · {title}
        </span>
        {right ? <span className="text-[color:var(--warm-ivory)] tracking-[0.04em] truncate">{right}</span> : null}
      </div>
      {children}
    </section>
  );
}

export default function TwinView() {
  const [looks, setLooks] = useState<Look[]>([]);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [takes, setTakes] = useState<Take[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [cfg, setCfg] = useState<PublicConfig | null>(null);
  const [prompt, setPrompt] = useState("");
  const [off, setOff] = useState(false);

  const [src, setSrc] = useState("heygen");
  const [pick, setPick] = useState<{ kind: "heygen"; lookId: string } | { kind: "photo"; photo: string } | null>(null);
  const [voice, setVoice] = useState<VoiceMode>("rec");
  const [take, setTake] = useState<string | null>(null);
  const [script, setScript] = useState("");
  const [ratio, setRatio] = useState<Ratio>("9:16");
  const [bg, setBg] = useState<"keep" | "green">("keep");
  const [engine, setEngine] = useState<"best" | "cheap">("best");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [msg, setMsg] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [placing, setPlacing] = useState<Job | null>(null);

  const refresh = useCallback(() => {
    fetch(API)
      .then((r) => r.json())
      .then((j) => {
        if (!j.ok) return;
        setLooks(j.looks);
        setVoices(j.voices || []);
        setSources(j.sources);
        setJobs(j.jobs);
        setLoaded(true);
      })
      .catch(() => {});
    fetch("/api/sound")
      .then((r) => r.json())
      .then((j) => j.ok && setTakes(j.items))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/connect")
      .then((r) => r.json())
      .then((j) => {
        if (!j.ok) return;
        setCfg(j.config);
        setPrompt(j.prompt);
      })
      .catch(() => {});
  }, []);

  // Faster while a video is being made, so a finished one shows up within seconds. Nothing while the tab
  // is hidden.
  const working = jobs.some((j) => j.status === "waiting" || j.status === "making");
  useEffect(() => {
    if (off) return;
    refresh();
    const t = setInterval(() => !document.hidden && refresh(), working ? 3000 : 8000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh, working, off]);

  // Remember the last choices, so the next video starts where you left off.
  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem(PREF_KEY) || "{}");
      if (p.src) setSrc(p.src);
      if (p.pick?.kind === "photo") setPick(p.pick);
      if (["rec", "take", "type"].includes(p.voice)) setVoice(p.voice);
      if (["9:16", "16:9", "1:1"].includes(p.ratio)) setRatio(p.ratio);
      if (p.bg === "green" || p.bg === "keep") setBg(p.bg);
      if (p.engine === "best" || p.engine === "cheap") setEngine(p.engine);
      if (typeof p.script === "string") setScript(p.script);
      if (typeof p.take === "string") setTake(p.take);
    } catch {
      /* defaults */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify({ src, pick, voice, ratio, bg, engine, script, take }));
    } catch {
      /* not remembered */
    }
  }, [src, pick, voice, ratio, bg, engine, script, take]);

  // Default pick: your digital twin, else your first look, else your first photo.
  const allPhotos = useMemo(() => sources.flatMap((s) => s.photos), [sources]);
  useEffect(() => {
    if (pick) return;
    if (allPhotos.length) {
      setPick({ kind: "photo", photo: allPhotos[0].id });
      setSrc(sources[0].id);
    }
  }, [looks, allPhotos, sources, pick]);

  const photoById = useMemo(() => {
    const m = new Map<string, Photo>();
    allPhotos.forEach((p) => m.set(p.id, p));
    return m;
  }, [allPhotos]);
  const pickedLook = pick?.kind === "heygen" ? looks.find((l) => l.id === pick.lookId) : undefined;
  const pickedName = pickedLook ? pickedLook.name : pick?.kind === "photo" ? photoById.get(pick.photo)?.name : undefined;
  const pickedIsPhoto = pick?.kind === "photo";

  const chosenTake = takes.find((t) => t.id === take);
  const byNewest = useMemo(() => [...takes].sort((a, b) => b.mtime - a.mtime), [takes]);
  const secs = voice === "type" ? scriptSecs(script) : chosenTake?.secs || 0;
  const credits = Math.max(1, Math.ceil((secs / 60) * creditsPerMin(engine, pickedIsPhoto)));

  const mode = cfg?.mode;
  const connectedNow = isConnected(cfg);
  const voiceId = cfg?.voiceId && voices.some((v) => v.id === cfg.voiceId) ? cfg.voiceId : "";
  const chosenVoice = voices.find((v) => v.id === voiceId);

  let why = "";
  if (!connectedNow) why = "Connect HeyGen first.";
  else if (pick?.kind !== "photo") why = "Upload your photo.";
  else if (!chosenTake) why = "Add your audio.";
    else if (voice === "type" && pickedIsPhoto && !voiceId && mode === "api") why = "Pick the voice that reads it.";

  const make = async () => {
    if (why || busy || !pick) return;
    setBusy(true);
    setMsg(null);
    try {
      const j = await post({
        action: "make",
        look: pick,
        voice: { kind: "take", take },
        ratio,
        background: bg,
        engine,
      });
      if (!j.ok) throw new Error(j.error);
      setMsg({
        tone: "good",
        text:
          mode === "api"
            ? "Sent to HeyGen. It shows up here when it's done (usually 1–5 min). You can leave this screen."
            : "Claude Code opened in a new window and is making it. It shows up here when it's done (about 1–3 min).",
      });
      refresh();
    } catch (e) {
      setMsg({ tone: "bad", text: (e as Error).message });
    }
    setBusy(false);
  };

  const refreshLooks = async () => {
    setRefreshing(true);
    setMsg(null);
    try {
      const j = await post({ action: "refresh-looks" });
      if (!j.ok) throw new Error(j.error);
      setMsg({
        tone: "good",
        text: j.launched ? "Claude Code opened in a new window and is listing your looks and voices. They show up here when it's done." : `Found ${j.looks} look${j.looks === 1 ? "" : "s"} and ${j.voices} voices in your HeyGen account.`,
      });
      refresh();
    } catch (e) {
      setMsg({ tone: "bad", text: (e as Error).message });
    }
    setRefreshing(false);
  };

  const addPhotos = async (files: File[]) => {
    const imgs = files.filter((f) => /^image\/(png|jpe?g|webp)$/.test(f.type));
    if (!imgs.length) return;
    let last = "";
    for (const f of imgs) {
      const j = await fetch(`${API}?photo=${encodeURIComponent(f.name || "Photo.png")}`, { method: "POST", body: f }).then((r) => r.json());
      if (j.ok) last = j.id;
    }
    refresh();
    if (last) {
      setSrc("photos");
      setPick({ kind: "photo", photo: last });
    }
  };

  const pickVoice = async (id: string) => {
    const j = await fetch("/api/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "voice", voiceId: id }) }).then((r) => r.json());
    if (j.config) setCfg(j.config);
  };

  const turnOff = async () => {
    try {
      await fetch("/api/shutdown", { method: "POST" });
    } catch {
      /* it's going down either way */
    }
    setOff(true);
  };

  const waiting = jobs.filter((j) => j.status === "waiting" && j.mode === "account").length;

  // What the step-1 grid shows.
  const tiles: { key: string; img: string; name: string; badge?: string; green?: boolean; on: boolean; choose: () => void }[] =
    src === "heygen"
      ? looks.map((l) => ({
          key: l.id,
          img: `${API}?look=${l.id}`,
          name: l.name,
          badge: l.type === "digital_twin" ? "TWIN" : undefined,
          on: pick?.kind === "heygen" && pick.lookId === l.id,
          choose: () => setPick({ kind: "heygen", lookId: l.id }),
        }))
      : (sources.find((s) => s.id === src)?.photos || []).map((p) => ({
          key: p.id,
          img: `${API}?photo=${encodeURIComponent(p.id)}`,
          name: p.name,
          green: p.green,
          on: pick?.kind === "photo" && pick.photo === p.id,
          choose: () => setPick({ kind: "photo", photo: p.id }),
        }));
  const lookHint =
    pick?.kind === "photo"
      ? "Your photo, animated as it is (Avatar IV). Nothing is added to your HeyGen account."
      : pickedLook?.type === "digital_twin"
        ? "Your digital twin: real filmed movement, the best lip-sync."
        : pickedLook
          ? "A HeyGen look, animated from your avatar."
          : "";
  const emptyLooks =
    src === "heygen"
      ? !connectedNow
        ? "Connect HeyGen above, then press Refresh my looks to bring in your HeyGen avatars."
        : "No HeyGen looks here yet. Press Refresh my looks, or use My photos."
      : "No photos yet. Press Add photos (or drop pictures here): a clear, front-facing photo of you works best.";

  if (off)
    return (
      <div className="min-h-[70vh] grid place-items-center text-center">
        <div>
          <h1 className="font-display text-[28px] leading-none">Twin is off</h1>
          <p className="mt-2 text-[13px] text-[color:var(--mist)]">You can close this tab. Double-click START to open it again.</p>
        </div>
      </div>
    );

  const pickedPhoto = pick?.kind === "photo" ? photoById.get(pick.photo) : undefined;
  const uploadAudio = async (f: File | undefined) => {
    if (!f) return;
    setMsg(null);
    const j = await fetch(`/api/sound?take=1&name=${encodeURIComponent(f.name.replace(/\.\w+$/, ""))}`, { method: "POST", body: f }).then((r) => r.json());
    if (!j.ok) return setMsg({ tone: "bad", text: j.error || "Couldn't add that audio." });
    setTake(j.item.id);
    refresh();
  };
  const tick = (ok: boolean) => <span className={`ml-2 ${ok ? "text-emerald-300" : "text-[color:var(--mist)] opacity-50"}`}>{ok ? "✓" : "○"}</span>;
  const bigBtn = "px-4 py-2.5 rounded-lg border border-white/15 text-[14px] text-[color:var(--warm-ivory)] hover:border-[color:var(--hot-ember)] cursor-pointer";

  return (
    <div>
      <PageHeader
        eyebrow="Make"
        title="Twin"
        subtitle="Upload a photo, add your voice, make the video."
        actions={
          <div className="flex items-center gap-2">
            <button className="px-3 py-2 rounded-xl text-[13px] text-[color:var(--mist)] hover:text-[color:var(--warm-ivory)] flex items-center gap-1.5" onClick={() => post({ action: "reveal", folder: "root" })}>
              <FolderIcon size={15} /> Open folder
            </button>
            <button className="glass-flat px-3 py-2 rounded-xl text-[13px] text-[color:var(--mist)] hover:text-red-300 flex items-center gap-1.5" title="Stops Twin (your videos stay)" onClick={turnOff}>
              <PowerIcon size={15} /> Turn off
            </button>
          </div>
        }
      />

      <ConnectStrip cfg={cfg} prompt={prompt} onChange={setCfg} />

      <div className="grid gap-9 lg:grid-cols-[minmax(320px,440px)_1fr] items-start">
        <div>
          <section className="border-t border-white/10 pt-4 pb-5">
            <div className="text-[15px] mb-3">1 · Upload your photo{tick(!!pickedPhoto)}</div>
            <div className="flex gap-2 flex-wrap items-center">
              <label className={bigBtn}>
                Upload
                <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void addPhotos(Array.from(e.target.files || []))} />
              </label>
              {allPhotos.map((p) => (
                <button key={p.id} onClick={() => setPick({ kind: "photo", photo: p.id })} className={`w-14 h-14 rounded-md overflow-hidden border ${pick?.kind === "photo" && pick.photo === p.id ? "border-[color:var(--hot-ember)] shadow-[0_0_0_1px_var(--hot-ember)]" : "border-white/10 opacity-70 hover:opacity-100"}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`${API}?photo=${encodeURIComponent(p.id)}`} alt={p.name} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          </section>

          <section className="border-t border-white/10 pt-4 pb-5">
            <div className="text-[15px] mb-3">
              2 · Your audio{tick(!!chosenTake)}
              {chosenTake ? <span className="ml-2 text-[12px] text-[color:var(--mist)]">{chosenTake.name} · {fmt(chosenTake.secs || 0)}</span> : null}
            </div>
            <div className="flex gap-2 flex-wrap">
              <button className={`${bigBtn} ${voice === "rec" ? "!border-[color:var(--hot-ember)]" : ""}`} onClick={() => setVoice(voice === "rec" ? "take" : "rec")}>Record</button>
              <label className={bigBtn}>
                Upload
                <input type="file" accept="audio/*" className="hidden" onChange={(e) => void uploadAudio(e.target.files?.[0])} />
              </label>
            </div>
            <div className={voice === "rec" ? "mt-3.5" : "hidden"}>
              <Booth active={voice === "rec"} onSaved={(id) => { setTake(id); refresh(); }} />
            </div>
          </section>

          <button
            className="w-full mt-1.5 py-3.5 rounded-lg bg-[color:var(--hot-ember)] text-[#1a0a05] font-semibold text-[15px] disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={!!why || busy}
            onClick={make}
          >
            {busy ? "Sending…" : "Make video"}
          </button>
          <div className="text-[12px] mt-2 min-h-[1em] text-amber-300">{why}</div>
          {msg ? <div className={`rounded-lg px-3 py-2 text-[12px] border mt-1 ${msg.tone === "good" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200" : "border-red-500/60 bg-red-500/10 text-[#fca5a5]"}`}>{msg.text}</div> : null}
        </div>

        <div className="min-w-0">
          <div className="eyebrow border-b border-white/10 pb-2.5 mb-4">
            Your videos · <span className="text-[color:var(--warm-ivory)]">{jobs.length}</span>
          </div>
          {jobs.length ? (
            <div className="grid gap-x-4 gap-y-5 grid-cols-[repeat(auto-fill,minmax(160px,1fr))] items-start">
              {jobs.map((j) => (
                <VideoCard key={j.id} j={j} onChange={refresh} onPlace={() => setPlacing(j)} />
              ))}
            </div>
          ) : (
            <div className="p-8 border border-dashed border-white/15 rounded-lg text-center text-[13px] text-[color:var(--mist)]">{loaded ? "Your videos show up here." : "Loading…"}</div>
          )}
        </div>
      </div>

      {placing ? <PlaceIt j={placing} onClose={() => setPlacing(null)} /> : null}
    </div>
  );
}

/** Your takes, each with its own play button, so you can record several, listen back, and pick the one
 *  HeyGen gets. One audio element is shared, so only one plays at a time. */
export function TakeList({ takes, take, onPick, title, empty }: { takes: Take[]; take: string | null; onPick: (id: string) => void; title: string; empty: string }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  useEffect(() => () => audio.current?.pause(), []);
  const toggle = (id: string) => {
    if (!audio.current) {
      audio.current = new Audio();
      audio.current.onended = () => setPlaying(null);
    }
    const a = audio.current;
    if (playing === id) {
      a.pause();
      setPlaying(null);
      return;
    }
    a.src = `/api/sound?f=${encodeURIComponent(id)}`;
    a.play().catch(() => setPlaying(null));
    setPlaying(id);
  };
  return (
    <div className="mt-3.5">
      <div className="font-mono text-[10.5px] tracking-[0.18em] text-[color:var(--mist)] mb-1.5">{title}</div>
      {takes.length ? (
        <div className="flex flex-col max-h-[300px] overflow-y-auto scroll-slim">
          {takes.map((t) => {
            const on = take === t.id;
            return (
              <div key={t.id} className={`flex items-center gap-2.5 py-1.5 px-1.5 border-b border-white/5 rounded-md ${on ? "bg-[rgba(245,92,47,0.10)]" : ""}`}>
                <button
                  onClick={() => toggle(t.id)}
                  aria-label={playing === t.id ? `Stop ${t.name}` : `Play ${t.name}`}
                  className={`w-8 h-8 shrink-0 rounded-full grid place-items-center border ${playing === t.id ? "border-[color:var(--hot-ember)] text-[color:var(--hot-ember)]" : "border-white/15 text-[color:var(--warm-ivory)] hover:border-white/40"}`}
                >
                  {playing === t.id ? <span className="w-2.5 h-2.5 bg-current rounded-[2px]" /> : <span className="ml-0.5 w-0 h-0 border-y-[6px] border-y-transparent border-l-[9px] border-l-current" />}
                </button>
                <button onClick={() => onPick(t.id)} className="flex-1 min-w-0 flex items-center gap-2 text-left">
                  <span className="flex-1 min-w-0 truncate text-[13.5px]">{t.name}</span>
                  <span className="font-mono text-[12px] text-[color:var(--mist)]">{fmt(t.secs || 0)}</span>
                  {on ? (
                    <span className="font-mono text-[9.5px] tracking-[0.1em] px-1.5 py-0.5 rounded-[3px] bg-[color:var(--hot-ember)] text-[#1a0a05]">USING</span>
                  ) : (
                    <span className="font-mono text-[9.5px] tracking-[0.1em] px-1.5 py-0.5 rounded-[3px] border border-white/15 text-[color:var(--mist)]">USE</span>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="p-3.5 border border-dashed border-white/15 rounded-lg text-[13px] text-[color:var(--mist)]">{empty}</div>
      )}
    </div>
  );
}

// ── One video ────────────────────────────────────────────────────────────────────────────────────────

const aspect = (r: Ratio) => (r === "16:9" ? "aspect-video" : r === "1:1" ? "aspect-square" : "aspect-[9/16]");

function VideoCard({ j, onChange, onPlace }: { j: Job; onChange: () => void; onPlace: () => void }) {
  const [playing, setPlaying] = useState(false);
  const [wantFull, setWantFull] = useState(false);
  const vref = useRef<HTMLVideoElement>(null);
  const [confirm, setConfirm] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(j.title);
  useEffect(() => setTitle(j.title), [j.title]);
  useEffect(() => {
    if (!confirm) return;
    const t = setTimeout(() => setConfirm(false), 3000);
    return () => clearTimeout(t);
  }, [confirm]);

  // "Full screen" mounts the player first, then asks for full screen on it.
  useEffect(() => {
    if (!wantFull || !playing || !vref.current) return;
    vref.current.requestFullscreen().catch(() => {});
    setWantFull(false);
  }, [wantFull, playing]);

  const done = j.status === "done" && j.video;
  const src = done ? `${API}?v=${encodeURIComponent(j.video!)}` : "";
  const look = j.look.kind === "heygen" ? `${API}?look=${j.look.lookId}` : `${API}?photo=${encodeURIComponent(j.look.photo)}`;
  const when = new Date(j.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" });

  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <div className={`relative rounded-md overflow-hidden bg-black border border-white/10 ${aspect(j.ratio)}`} style={j.background === "green" && !done ? { background: GREEN } : undefined}>
        {done && playing ? (
          <video
            ref={vref}
            src={src}
            controls
            autoPlay
            playsInline
            className="w-full h-full object-contain bg-black"
            onEnded={() => !document.fullscreenElement && setPlaying(false)}
            onDoubleClick={(e) => (document.fullscreenElement ? document.exitFullscreen() : e.currentTarget.requestFullscreen()).catch(() => {})}
          />
        ) : (
          <button className="w-full h-full block" onClick={() => done && setPlaying(true)} aria-label={done ? `Play ${j.title}` : j.title}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={done ? `${src}&thumb=1` : look} alt="" loading="lazy" className={`w-full h-full object-cover ${done ? "" : "opacity-40"}`} />
          </button>
        )}
        {done && !playing ? <span className="absolute right-1.5 bottom-1.5 font-mono text-[10.5px] bg-black/70 text-white px-1.5 rounded-[3px]">{fmt(j.secs || 0)}</span> : null}
        {!done ? (
          <div className="absolute inset-0 grid place-items-center text-center px-2 font-mono text-[11px] text-[color:var(--mist)]">
            {j.status === "failed" ? (
              <div className="text-[#fca5a5]">
                Didn&apos;t work
                <div className="text-[10.5px] mt-1 opacity-80 normal-case">{j.note}</div>
              </div>
            ) : (
              <div>
                <span className="inline-block w-2 h-2 rounded-full bg-[color:var(--hot-ember)] listening mr-1.5" />
                {j.status === "making" ? j.note || "HeyGen is making it" : j.mode === "api" ? "Sending to HeyGen" : "Waiting for Claude"}
              </div>
            )}
          </div>
        ) : null}
      </div>
      {renaming ? (
        <input
          autoFocus
          className="field px-2 py-1 text-[13px]"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={async () => {
            setRenaming(false);
            if (title.trim() && title !== j.title) await post({ action: "rename", id: j.id, title });
            onChange();
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
      ) : (
        <button className="text-[13px] leading-tight truncate text-left hover:text-[color:var(--hot-ember)]" title="Rename" onClick={() => setRenaming(true)}>
          {j.title}
        </button>
      )}
      <div className="font-mono text-[10.5px] text-[color:var(--mist)] opacity-80 flex gap-2 flex-wrap items-center">
        <span>{when}</span>
        <span>{j.ratio}</span>
        <span>{j.voice.kind === "script" ? j.voice.voiceName || "typed" : "your take"}</span>
        {j.background === "green" ? <span style={{ color: GREEN }}>GREEN</span> : null}
        {j.alpha ? <span>+ CUT OUT</span> : null}
      </div>
      <div className="flex gap-1 flex-wrap">
        {done ? (
          <>
            <button className={`${smallBtn} !text-[color:var(--warm-ivory)] !border-[rgba(245,92,47,0.6)]`} onClick={onPlace}>
              Place it
            </button>
            <button
              className={smallBtn}
              onClick={() => {
                if (playing && vref.current) vref.current.requestFullscreen().catch(() => {});
                else {
                  setPlaying(true);
                  setWantFull(true);
                }
              }}
            >
              Full screen
            </button>
            <a className={smallBtn} href={`${src}&download=1`}>
              Download
            </a>
            <button className={smallBtn} onClick={() => post({ action: "reveal", file: j.video })}>
              Folder
            </button>
          </>
        ) : null}
        {j.status === "failed" ? (
          <button
            className={smallBtn}
            onClick={async () => {
              await post({ action: "retry", id: j.id });
              onChange();
            }}
          >
            Try again
          </button>
        ) : null}
        <button
          className={`${smallBtn} ${confirm ? "!text-red-300 !border-red-400/50" : ""}`}
          title="Moves it into my-twin/.trash"
          onClick={async () => {
            if (!confirm) return setConfirm(true);
            await fetch(`${API}?id=${j.id}`, { method: "DELETE" });
            onChange();
          }}
        >
          {confirm ? "Delete video?" : "Delete"}
        </button>
      </div>
    </div>
  );
}

// ── Place it: you over a screen ──────────────────────────────────────────────────────────────────────

const PRESETS: { name: string; box: React.CSSProperties }[] = [
  { name: "Bubble · bottom right", box: { right: "3%", bottom: "5%", width: "20%", aspectRatio: "1", borderRadius: "50%" } },
  { name: "Box · bottom left", box: { left: "3%", bottom: "5%", width: "22%", height: "39%", borderRadius: 8 } },
  { name: "Side panel · right", box: { right: 0, top: 0, width: "32%", height: "100%" } },
  { name: "Standing · right", box: { right: "2%", bottom: 0, width: "30%", height: "85%" } },
  { name: "Full screen", box: { left: 0, top: 0, width: "100%", height: "100%" } },
];

/** A preview of your video sitting over a screen. Green-screen videos are keyed out live on a canvas, so
 *  what you see is how it'll sit on top of anything. */
function PlaceIt({ j, onClose }: { j: Job; onClose: () => void }) {
  const [preset, setPreset] = useState(j.background === "green" || j.alpha ? 3 : 0);
  const [under, setUnder] = useState<string | null>(null);
  const vid = useRef<HTMLVideoElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const keyed = j.background === "green" && !j.alpha;
  const file = j.alpha || j.video!;
  const src = `${API}?v=${encodeURIComponent(file)}`;

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  // Chroma key: drop pixels where green clearly beats red and blue, soften the edge a little.
  useEffect(() => {
    if (!keyed) return;
    let raf = 0;
    const draw = () => {
      const v = vid.current;
      const c = cv.current;
      if (v && c && v.videoWidth) {
        const w = 480;
        const h = Math.round((v.videoHeight / v.videoWidth) * w);
        if (c.width !== w || c.height !== h) Object.assign(c, { width: w, height: h });
        const ctx = c.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(v, 0, 0, w, h);
        const im = ctx.getImageData(0, 0, w, h);
        const d = im.data;
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i],
            g = d[i + 1],
            b = d[i + 2];
          const spill = g - Math.max(r, b);
          if (spill > 60) d[i + 3] = 0;
          else if (spill > 25) {
            d[i + 3] = Math.round(255 * (1 - (spill - 25) / 35));
            d[i + 1] = Math.max(r, b);
          }
        }
        ctx.putImageData(im, 0, 0);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [keyed]);

  const box = PRESETS[preset].box;
  return (
    <div className="fixed inset-0 z-50 bg-black/75 grid place-items-center p-4" onClick={onClose}>
      <div className="bg-[#1a1210] border border-white/10 rounded-xl shadow-2xl w-[min(980px,100%)] p-5 grid gap-5 md:grid-cols-[1fr_230px]" onClick={(e) => e.stopPropagation()}>
        <div
          className="relative aspect-video rounded-md overflow-hidden border border-white/10"
          style={under ? { background: `center/cover url(${under})` } : { background: "linear-gradient(135deg,#1f2a3a,#0f141d)" }}
        >
          {!under ? (
            <div className="absolute inset-[8%_6%] rounded-md bg-[#e9ecf1]/90 p-[4%] flex flex-col gap-[6%]">
              <i className="block h-[10%] w-[40%] bg-[#9aa3b3] rounded-sm" />
              {[0, 1, 2, 3].map((k) => (
                <i key={k} className="block h-[7%] bg-[#c9ced8] rounded-sm" />
              ))}
            </div>
          ) : null}
          <div className="absolute overflow-hidden transition-all duration-300" style={{ ...box, ...(keyed || j.alpha ? {} : { border: "2px solid var(--hot-ember)", background: "#000" }) }}>
            <video ref={vid} src={src} autoPlay loop muted playsInline crossOrigin="anonymous" className={keyed ? "hidden" : "w-full h-full object-cover"} />
            {keyed ? <canvas ref={cv} className="w-full h-full object-contain object-bottom" /> : null}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <h4 className="font-display text-[20px]">Place it</h4>
          <p className="text-[12px] text-[color:var(--mist)] mb-2">
            {keyed ? "Green keyed out live. " : ""}A preview of you over a screen. Pick a screenshot below to see it over yours.
          </p>
          {PRESETS.map((p, i) => (
            <button key={p.name} className={`text-left ${chip(preset === i)} !py-2 !text-[13px]`} onClick={() => setPreset(i)}>
              {p.name}
            </button>
          ))}
          <label className="mt-2 text-[12px] text-[color:var(--mist)] border border-dashed border-white/15 rounded-md p-2.5 text-center cursor-pointer hover:text-[color:var(--warm-ivory)]">
            Pick a screenshot to sit on
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setUnder(URL.createObjectURL(f));
              }}
            />
          </label>
          <button className="mt-auto text-[12px] text-[color:var(--mist)] hover:text-[color:var(--warm-ivory)] pt-3" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
