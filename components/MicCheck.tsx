"use client";

// The mic meter and the five-second mic test, shared by Record Over's booth and the Screen Recorder.
// The measuring lives in lib/micCheck.ts. This is only how it looks.

import { useEffect, useRef, useState } from "react";
import { TEST_S, VOICE_PEAK, fmtDb, isGatedMic, liveVoice, runMicTest, useMicTests, type MicLevel, type Verdict, type VoiceCheck } from "../lib/micCheck";
import { MicIcon } from "./icons";

/** The bar reads in dB, not raw amplitude: on a linear bar normal speech barely moves it, and the
 *  difference between a quiet mic and a dead one is invisible. */
const FLOOR_DB = -60;
const barOf = (db: number) => (Number.isFinite(db) ? Math.max(0, Math.min(1, (db - FLOOR_DB) / -FLOOR_DB)) : 0);

/** `voice` false: a level meter only (the PC sound), no voice-over target or verdict. */
/** `boosted`: the take is turned up after recording (Sound booth), so a quiet level is fine. */
export function MicMeter({ m, label, voice = true, boosted = false }: { m: MicLevel; label: string; voice?: boolean; boosted?: boolean }) {
  const w = barOf(m.db);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden" title="mic level: your loudest words should land in the lit band">
          {/* Where your loudest words should land (VOICE_PEAK). */}
          {voice ? (
          <div
            className="absolute inset-y-0 bg-emerald-400/25"
            style={{ left: `${barOf(VOICE_PEAK.low) * 100}%`, width: `${(barOf(VOICE_PEAK.high) - barOf(VOICE_PEAK.low)) * 100}%` }}
          />
          ) : null}
          <div
            className="relative h-full transition-[width] duration-75"
            style={{ width: `${w * 100}%`, background: m.db > -1 ? "#ef4444" : m.db > VOICE_PEAK.high ? "#f59e0b" : "#22c55e" }}
          />
        </div>
        <span className="w-12 text-right font-mono text-[10.5px] tabular-nums text-[color:var(--mist)]">{m.blocked ? "" : fmtDb(Math.max(m.db, -99))}</span>
      </div>
      {m.silent && isGatedMic(label) ? (
        <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-2.5 py-2 text-[11.5px] leading-snug text-amber-100">
          <b className="text-amber-200">Silent.</b> This mic removes background noise, so it goes quiet when you stop talking. Say something: if the bar still
          doesn&apos;t move, check the mute button on your real mic.
        </div>
      ) : m.silent ? (
        <div className="rounded-lg border border-red-500/60 bg-red-500/10 px-2.5 py-2 text-[11.5px] leading-snug text-[#fca5a5]">
          <b className="text-red-300">Your mic is sending pure silence.</b> Check its mute button (a red light usually means muted), or turn its gain up.
          Anything recorded now will have no voice.
        </div>
      ) : m.blocked ? (
        <div className="text-[11px] text-[color:var(--mist)]">Click anywhere on the page to start the meter.</div>
      ) : voice ? (
        <VoiceLine v={liveVoice(m.talkDb, boosted)} />
      ) : null}
    </div>
  );
}

const TONE: Record<VoiceCheck["tone"], string> = {
  good: "text-emerald-300",
  warn: "text-amber-200",
  bad: "text-[#fca5a5]",
  idle: "text-[color:var(--mist)]",
};

/** The live verdict under the meter: is your voice at a good voice-over level right now? */
function VoiceLine({ v }: { v: VoiceCheck }) {
  return (
    <div className={`text-[11.5px] leading-snug ${TONE[v.tone]}`}>
      {v.text}
      {v.tone === "idle" ? <span className="text-[color:var(--mist)]"> Aim: your loudest words in the green band ({VOICE_PEAK.low} to {VOICE_PEAK.high} dB).</span> : null}
    </div>
  );
}

const VERDICT: Record<Verdict, { label: string; tone: string }> = {
  silent: { label: "Silent", tone: "border-red-500/60 bg-red-500/15 text-red-300" },
  clipping: { label: "Clipping", tone: "border-red-500/60 bg-red-500/15 text-red-300" },
  quiet: { label: "Too quiet", tone: "border-amber-500/60 bg-amber-500/15 text-amber-300" },
  ok: { label: "A bit quiet", tone: "border-amber-500/40 bg-amber-500/10 text-amber-200" },
  good: { label: "Good", tone: "border-emerald-500/60 bg-emerald-500/15 text-emerald-300" },
};

/** Record five seconds, hear it back, and line it up against the same test on another mic. */
export function MicTest({ stream, label, disabled }: { stream: MediaStream | null; label: string; disabled?: boolean }) {
  const [tests, remove] = useMicTests();
  const [left, setLeft] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const [playing, setPlaying] = useState<string | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => player.current?.pause(), []);

  const run = async () => {
    if (!stream || left !== null) return;
    setErr("");
    player.current?.pause();
    setPlaying(null);
    setLeft(TEST_S);
    try {
      const t = await runMicTest(stream, label, setLeft);
      play(t.id, t.url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "the test couldn't record");
    }
    setLeft(null);
  };
  const play = (id: string, url: string) => {
    const a = (player.current ||= new Audio());
    if (playing === id && !a.paused) {
      a.pause();
      setPlaying(null);
      return;
    }
    a.src = url;
    a.onended = () => setPlaying(null);
    void a.play().then(
      () => setPlaying(id),
      () => setPlaying(null),
    );
  };

  const newest = tests[0];
  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={() => void run()}
        disabled={!stream || disabled || left !== null}
        className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-[12.5px] transition ${
          left !== null ? "border-red-500/70 bg-red-500/10 text-[color:var(--warm-ivory)]" : "border-[var(--glass-edge)] hover:border-[color:var(--hot-ember)] disabled:opacity-50"
        }`}
        title="records five seconds from this mic, then plays it back so you hear exactly what it hears"
      >
        {left !== null ? (
          <>
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" /> Talk now, like you would in a take… {Math.ceil(left)}
          </>
        ) : (
          <>
            <MicIcon size={13} /> Test this mic · {TEST_S} s
          </>
        )}
      </button>
      {err ? <div className="text-[11.5px] text-[color:var(--hot-ember)]">{err}</div> : null}
      {tests.length ? (
        <div className="flex flex-col gap-1">
          {tests.map((t) => {
            const v = VERDICT[t.verdict];
            return (
              <div key={t.id} className="group flex items-center gap-2 rounded-lg bg-white/[0.03] px-2 py-1.5 text-[11.5px]">
                <button
                  onClick={() => play(t.id, t.url)}
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-[var(--glass-edge)] hover:border-[color:var(--hot-ember)]"
                  title={playing === t.id ? "stop" : "hear it"}
                >
                  {playing === t.id ? <span className="h-2 w-2 rounded-[1px] bg-[color:var(--warm-ivory)]" /> : <span className="ml-0.5 border-y-[4px] border-l-[7px] border-y-transparent border-l-[color:var(--warm-ivory)]" />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[color:var(--warm-ivory)]" title={t.label}>
                    {shortMic(t.label)}
                  </div>
                  <div className="font-mono text-[10.5px] tabular-nums text-[color:var(--mist)]" title="how loud you were · how loud the room was with you quiet">
                    {t.verdict === "silent" ? `loudest ${fmtDb(Math.max(t.voiceDb, -99))}: nothing` : `you ${fmtDb(t.voiceDb)} · room ${fmtDb(t.noiseDb)}`}
                  </div>
                </div>
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10.5px] ${v.tone}`}>{v.label}</span>
                <button onClick={() => remove(t.id)} className="shrink-0 text-[color:var(--mist)] opacity-0 hover:text-[color:var(--hot-ember)] group-hover:opacity-100" title="forget this test">
                  ×
                </button>
              </div>
            );
          })}
          {newest ? <div className="px-0.5 text-[11px] leading-snug text-[color:var(--mist)]">{newest.advice}</div> : null}
          {tests.length === 1 ? (
            <div className="px-0.5 text-[11px] leading-snug text-[color:var(--mist)] opacity-80">
              Pick another mic and test it too, to compare. The one with the bigger gap between you and the room sounds cleaner.
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** "Microphone (fifine Microphone) (3142:a601)" → "fifine Microphone". */
export const shortMic = (label: string) => {
  const m = /^(?:Default - )?(?:Microphone|Headset|Line In|Mic)\s*\(([^)]+)\)/i.exec(label);
  return m ? m[1] : label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)$/i, "");
};
