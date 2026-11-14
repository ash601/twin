"use client";

// The voice booth from Content Research's Sound screen, as it is: pick a mic, hit record (or Space), talk,
// stop. The browser records the raw mic and the server writes the take into my-twin/voice as a WAV. Leaving
// the screen mid-take still saves it: the upload fires from the recorder's own stop handler.

import { useEffect, useRef, useState } from "react";
import { RAW_MIC, useMicLevel } from "../lib/micCheck";
import { MicMeter, MicTest } from "./MicCheck";

const MIC_KEY = "twin.mic";
const API = "/api/sound";
const fmtTime = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const ss = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};

/** Opus at 256k is transparent for a voice; the WAV the server writes is what you edit with. */
function pickMime(): string {
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]) if (MediaRecorder.isTypeSupported(m)) return m;
  return "";
}

export type Phase = "idle" | "recording" | "paused" | "saving";
type Note = { tone: "good" | "warn" | "bad"; text: string };
const NOTE_CLS: Record<Note["tone"], string> = {
  good: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
  warn: "border-amber-500/50 bg-amber-500/10 text-amber-100",
  bad: "border-red-500/60 bg-red-500/10 text-[#fca5a5]",
};
const NoteBox = ({ n }: { n: Note }) => <div className={`rounded-lg px-3 py-2 text-[12px] border ${NOTE_CLS[n.tone]}`}>{n.text}</div>;

// ── Recording your voice ─────────────────────────────────────────────────────────────────────────────

/** onPhase: told when a take starts, pauses and ends (Lip Sync plays the video along with it).
 *  compact: just the meter and the record button (no mic list, name or mic test). */
export function Booth({ active, onSaved, onPhase, compact }: { active: boolean; onSaved: (id: string) => void; onPhase?: (p: Phase) => void; compact?: boolean }) {
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState<string>("");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [micError, setMicError] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [name, setName] = useState("");
  const [note, setNote] = useState<Note | null>(null);

  const rec = useRef<(MediaRecorder & { discard?: () => void }) | null>(null);
  // Time already banked before the last pause, plus when the current stretch started.
  const clock = useRef({ banked: 0, since: 0 });
  const level = useMicLevel(stream);
  const micLabel = mics.find((d) => d.deviceId === micId)?.label || "";
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const onPhaseRef = useRef(onPhase);
  onPhaseRef.current = onPhase;
  useEffect(() => onPhaseRef.current?.(phase), [phase]);

  // The mics. Labels are blank until the page has mic permission, so one open of the default mic asks.
  useEffect(() => {
    if (!navigator.mediaDevices) return setMicError("this browser can't record audio");
    let live = true;
    const load = async () => {
      try {
        let all = await navigator.mediaDevices.enumerateDevices();
        if (!all.some((d) => d.kind === "audioinput" && d.label)) {
          const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
          probe.getTracks().forEach((t) => t.stop());
          all = await navigator.mediaDevices.enumerateDevices();
        }
        if (!live) return;
        // "default" and "communications" are aliases of real mics, listed twice; keep the real ones.
        const list = all.filter((d) => d.kind === "audioinput" && d.deviceId !== "default" && d.deviceId !== "communications");
        setMics(list);
        let saved = "";
        try {
          saved = localStorage.getItem(MIC_KEY) || "";
        } catch {
          /* no memory, pick the first */
        }
        setMicId((cur) => (cur && list.some((d) => d.deviceId === cur) ? cur : list.find((d) => d.deviceId === saved)?.deviceId || list[0]?.deviceId || ""));
      } catch (e) {
        if (live)
          setMicError(
            (e as { name?: string })?.name === "NotAllowedError" ? "Mic access is blocked for this page. Allow it from the icon left of the address bar, then reload." : "Couldn't list the mics.",
          );
      }
    };
    load();
    navigator.mediaDevices.addEventListener("devicechange", load);
    return () => {
      live = false;
      navigator.mediaDevices.removeEventListener("devicechange", load);
    };
  }, []);

  // Open the chosen mic. It stays open while you're on the page, so the meter is live before you record.
  useEffect(() => {
    if (!micId) return;
    let live = true;
    let s: MediaStream | null = null;
    setMicError("");
    navigator.mediaDevices
      .getUserMedia({ audio: { ...RAW_MIC, deviceId: { exact: micId }, channelCount: 1, sampleRate: 48000 }, video: false })
      .then((got) => {
        if (!live) return got.getTracks().forEach((t) => t.stop());
        s = got;
        setStream(got);
      })
      .catch(() => live && setMicError("Couldn't open that mic. Is another app holding it exclusively?"));
    return () => {
      live = false;
      s?.getTracks().forEach((t) => t.stop());
      setStream(null);
    };
  }, [micId]);

  const chooseMic = (id: string) => {
    setMicId(id);
    try {
      localStorage.setItem(MIC_KEY, id);
    } catch {
      /* not remembered */
    }
  };

  // The running clock.
  useEffect(() => {
    if (phase !== "recording") return;
    const t = setInterval(() => setElapsed(clock.current.banked + (performance.now() - clock.current.since) / 1000), 200);
    return () => clearInterval(t);
  }, [phase]);

  const start = () => {
    if (!stream || phase !== "idle") return;
    const mime = pickMime();
    const r: MediaRecorder & { discard?: () => void } = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 256_000 });
    const chunks: Blob[] = [];
    const wanted = name.trim();
    let thrown = false;
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = async () => {
      rec.current = null;
      if (thrown) {
        setPhase("idle");
        setElapsed(0);
        return;
      }
      setPhase("saving");
      try {
        const blob = new Blob(chunks, { type: r.mimeType || "audio/webm" });
        const j = await fetch(`${API}?take=1${wanted ? `&name=${encodeURIComponent(wanted)}` : ""}`, {
          method: "POST",
          headers: { "Content-Type": blob.type || "audio/webm" },
          body: blob,
        }).then((res) => res.json());
        if (!j.ok) throw new Error(j.error || "save failed");
        setNote(j.warning ? { tone: "warn", text: j.warning } : { tone: "good", text: `Saved ${j.item.name}` });
        setName("");
        onSavedRef.current(j.item.id);
      } catch (e) {
        setNote({ tone: "bad", text: `Couldn't save the take: ${(e as Error).message}` });
      }
      setPhase("idle");
      setElapsed(0);
    };
    r.discard = () => {
      thrown = true;
      r.stop();
    };
    // A chunk a second, so a crash of the tab loses at most a second of what's in memory.
    r.start(1000);
    rec.current = r;
    clock.current = { banked: 0, since: performance.now() };
    setElapsed(0);
    setNote(null);
    setPhase("recording");
  };

  const stop = () => {
    const r = rec.current;
    if (r && r.state !== "inactive") r.stop();
  };
  const pause = () => {
    const r = rec.current;
    if (!r) return;
    if (r.state === "recording") {
      r.pause();
      clock.current.banked += (performance.now() - clock.current.since) / 1000;
      setElapsed(clock.current.banked);
      setPhase("paused");
    } else if (r.state === "paused") {
      r.resume();
      clock.current.since = performance.now();
      setPhase("recording");
    }
  };

  // Leaving this screen mid-take stops and SAVES it (the stop handler uploads on its own).
  useEffect(() => () => stop(), []);
  // Closing the browser tab mid-take can't save it, so ask first.
  useEffect(() => {
    if (phase === "idle") return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [phase]);

  // Space = start / stop, unless you're typing somewhere or on a player.
  const keyRef = useRef({ start, stop, phase, active });
  keyRef.current = { start, stop, phase, active };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON|AUDIO)$/.test(el.tagName))) return;
      const k = keyRef.current;
      if (!k.active) return;
      e.preventDefault();
      if (k.phase === "idle") k.start();
      else if (k.phase === "recording" || k.phase === "paused") k.stop();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const live = phase === "recording" || phase === "paused";

  return (
    <div className={compact ? "flex flex-col gap-4" : "glass rounded-2xl p-5 flex flex-col gap-5"}>
      <label className={compact ? "hidden" : "flex flex-col gap-1.5"}>
        <span className="eyebrow">Mic</span>
        <select className="field px-3 py-2.5 text-[14px]" value={micId} disabled={live || phase === "saving"} onChange={(e) => chooseMic(e.target.value)}>
          {mics.length ? null : <option value="">No mics found</option>}
          {mics.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || "Mic"}
            </option>
          ))}
        </select>
      </label>
      {micError ? <div className="text-[12px] text-[#fca5a5]">{micError}</div> : <MicMeter m={level} label={micLabel} boosted />}

      <div className="flex flex-col items-center gap-3 py-1">
        <button
          onClick={live ? stop : start}
          disabled={!stream || phase === "saving"}
          aria-label={live ? "Stop and save" : "Record"}
          className={`relative h-24 w-24 rounded-full border-2 transition flex items-center justify-center disabled:opacity-40 ${
            live ? "border-red-400 bg-red-500/15" : "border-[color:var(--hot-ember)] bg-white/5 hover:bg-white/10"
          }`}
        >
          {phase === "recording" ? <span className="absolute inset-0 rounded-full border-2 border-red-400/60 animate-ping" /> : null}
          {live ? <span className="h-8 w-8 rounded-md bg-red-500" /> : <span className="h-10 w-10 rounded-full bg-red-500" />}
        </button>
        <div className={`font-mono text-[28px] tabular-nums ${live ? "text-[color:var(--warm-ivory)]" : "text-[color:var(--mist)]"}`}>{fmtTime(elapsed)}</div>
        <div className="text-[12px] text-[color:var(--mist)] h-4">
          {phase === "recording" ? "Recording… Space or the button stops and saves" : phase === "paused" ? "Paused" : phase === "saving" ? "Saving…" : stream ? "Space to record" : ""}
        </div>
        {live ? (
          <div className="flex gap-2">
            <button className="px-3 py-1.5 rounded-lg text-[12.5px] border border-white/10 text-[color:var(--mist)] hover:text-[color:var(--warm-ivory)]" onClick={pause}>
              {phase === "paused" ? "Resume" : "Pause"}
            </button>
            <button className="px-3 py-1.5 rounded-lg text-[12.5px] border border-white/10 text-[color:var(--mist)] hover:text-red-300" onClick={() => rec.current?.discard?.()}>
              Throw away
            </button>
          </div>
        ) : null}
      </div>

      <label className={compact ? "hidden" : "flex flex-col gap-1.5"}>
        <span className="eyebrow">Name (optional)</span>
        <input className="field px-3 py-2 text-[14px]" value={name} onChange={(e) => setName(e.target.value)} placeholder="Voice + date and time" disabled={phase === "saving"} />
        <span className="text-[11.5px] text-[color:var(--mist)]">Used for the next take you save. Leave it blank and it&apos;s named by the time.</span>
      </label>

      {note ? <NoteBox n={note} /> : null}

      <details className={compact ? "hidden" : "text-[12px] text-[color:var(--mist)]"}>
        <summary className="cursor-pointer hover:text-[color:var(--warm-ivory)]">Test the mic first</summary>
        <div className="pt-3">
          <MicTest stream={stream} label={micLabel} disabled={live || phase === "saving"} />
        </div>
      </details>
    </div>
  );
}
