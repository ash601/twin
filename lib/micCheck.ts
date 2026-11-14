"use client";

// Mic check: is the mic actually sending sound, and how does one mic compare with another?
//
// Built after a voiceover came out as six seconds of nothing (2026-09-19). The mic's own mute was
// on, so Windows got pure digital zeros and the take saved as silence. A live mic in a quiet room
// never reads zero: its own hiss sits somewhere around -70 to -50 dBFS. So "under -70 for more
// than a moment" means the mic is off, not that the room is quiet. Measured on this PC: -91 dB
// with the fifine muted, -44 dB average with it live.
//
// Shared by Record Over's booth and the Screen Recorder: a level meter that raises the alarm on
// silence, and a five-second test you can play back and line up against the same test on another mic.

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

/** At or below this the mic is sending (near) digital silence: muted at the mic, or gain at zero. */
export const SILENT_DB = -70;
/** How long it has to stay that quiet before the meter calls it. Long enough to ignore a gap in the
 *  signal, short enough that you see it before you press Record. */
const SILENT_AFTER_MS = 1500;
export const TEST_S = 5;

/** Mics that remove noise (NVIDIA Broadcast and the like) send true silence between words, so for them
 *  "silent" can just mean you stopped talking. */
export const isGatedMic = (label: string) => /NVIDIA Broadcast|RTX Voice|Krisp|Broadcast/i.test(label || "");

export const toDb = (amp: number) => (amp > 0 ? 20 * Math.log10(amp) : -Infinity);
export const fmtDb = (db: number) => (Number.isFinite(db) ? `${Math.round(db)} dB` : "−∞ dB");

/** Every "call" feature off, same as the booth: they flatten a narrator's voice, and noise
 *  suppression would hide the very room noise the test is meant to show you. */
export const RAW_MIC = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };

function newContext(): AudioContext {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  return new Ctx();
}

export type MicLevel = {
  /** Peak of the last ~50 ms, 0–1. */
  level: number;
  db: number;
  /** Pure silence for longer than a moment: the mic is muted, not just quiet. */
  silent: boolean;
  /** The loudest peak in the last ~2.5 s: how loud your words hit while you talk (see liveVoice). */
  talkDb: number;
  /** The browser hasn't let the meter start yet (no click on the page so far). A meter that can't
   *  hear anything must not claim the mic is silent. */
  blocked: boolean;
};

const IDLE: MicLevel = { level: 0, db: -Infinity, talkDb: -Infinity, silent: false, blocked: false };

/** Where your loudest words should hit for a voice-over: -12 to -3 dBFS on the peaks. Loud enough to
 *  sit well above the mic's own hiss, with room before it clips at 0. The standard recording level
 *  for spoken voice; "Polish my voice" then levels the finished video to -16 LUFS. */
export const VOICE_PEAK = { low: -12, high: -3 };
/** Below this the loudest word in the last few seconds isn't talking, just the room. */
const TALK_FLOOR_DB = -45;

export type VoiceCheck = { tone: "good" | "warn" | "bad" | "idle"; text: string };

/** The live verdict under the meter: judged on your recent loudest words, not the flicker of each
 *  instant, so it holds still while you talk. */
export function liveVoice(talkDb: number, boosted = false): VoiceCheck {
  if (!Number.isFinite(talkDb) || talkDb < TALK_FLOOR_DB) return { tone: "idle", text: "Talk the way you will in the video, and this tells you if the level is right." };
  // Takes saved by the Sound booth are turned up to -16 LUFS (soundServer turnUp), so a quiet mic is
  // fine there. Pushing the gain to max is what hurts: hiss and distortion that can't be undone.
  if (boosted && talkDb < VOICE_PEAK.low)
    return { tone: "good", text: "✓ Heard you. It's turned up to normal loudness when you stop, so no need for max gain (keep it around the middle)." };
  if (talkDb >= -1) return { tone: "bad", text: "Too loud: it's clipping (distortion you can't fix later). Sit back a little or turn the mic gain down." };
  if (talkDb > VOICE_PEAK.high) return { tone: "warn", text: "A touch too hot. Back off the mic slightly." };
  if (talkDb >= VOICE_PEAK.low) return { tone: "good", text: "✓ That's the right level. Keep talking like this." };
  if (talkDb >= -20) return { tone: "warn", text: "A bit quiet. Lean in a little or turn the mic gain up." };
  return { tone: "bad", text: "Too quiet. Get closer to the mic (a hand's width away) or turn its gain up." };
}

/** A live meter on a stream. It flags silence only once it has actually been listening. */
export function useMicLevel(stream: MediaStream | null): MicLevel {
  const [s, setS] = useState<MicLevel>(IDLE);
  useEffect(() => {
    if (!stream || !stream.getAudioTracks().length) {
      setS(IDLE);
      return;
    }
    const ctx = newContext();
    const an = ctx.createAnalyser();
    an.fftSize = 2048;
    const src = ctx.createMediaStreamSource(stream);
    src.connect(an);
    const buf = new Float32Array(an.fftSize);
    // A context made before the page has had a click starts suspended and hears nothing. The first
    // click anywhere wakes it.
    const wake = () => void ctx.resume().catch(() => {});
    window.addEventListener("pointerdown", wake);
    window.addEventListener("keydown", wake);
    let raf = 0;
    let last = 0;
    let loudAt = performance.now();
    // The last ~2.5 s of peaks, for talkDb.
    const recent: number[] = [];
    const tick = (now: number) => {
      if (now - last > 66) {
        last = now;
        if (ctx.state !== "running") {
          loudAt = now;
          setS({ level: 0, db: -Infinity, talkDb: -Infinity, silent: false, blocked: true });
        } else {
          an.getFloatTimeDomainData(buf);
          let peak = 0;
          for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
          const db = toDb(peak);
          if (db > SILENT_DB) loudAt = now;
          recent.push(db);
          if (recent.length > 38) recent.shift(); // 38 × 66 ms ≈ 2.5 s
          setS({ level: peak, db, talkDb: Math.max(...recent), silent: now - loudAt > SILENT_AFTER_MS, blocked: false });
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
      src.disconnect();
      void ctx.close();
    };
  }, [stream]);
  return s;
}

/** The browser's device for a DirectShow mic name. ffmpeg says "Microphone (fifine Microphone)",
 *  and Chrome says the same with the USB id on the end: "Microphone (fifine Microphone) (3142:a601)". */
function matchDevice(all: MediaDeviceInfo[], name: string): MediaDeviceInfo | undefined {
  const mics = all.filter((d) => d.kind === "audioinput" && d.deviceId && d.deviceId !== "default" && d.deviceId !== "communications");
  return mics.find((d) => d.label === name) || mics.find((d) => d.label.startsWith(`${name} (`)) || mics.find((d) => d.label.startsWith(name));
}

/** Opens the mic ffmpeg will record from, in the browser, so the page can show its level. The
 *  browser and ffmpeg can both read one mic at once (Windows shares it), so this never gets in the
 *  recording's way. */
export function useMicByName(name: string | null): { stream: MediaStream | null; error: string } {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setStream(null);
    setError("");
    if (!name || !navigator.mediaDevices) return;
    let live = true;
    let s: MediaStream | null = null;
    (async () => {
      try {
        let all = await navigator.mediaDevices.enumerateDevices();
        // Before the page has mic permission the labels are blank. One open of the default mic asks for
        // permission, and after that the real names are there.
        if (!all.some((d) => d.kind === "audioinput" && d.label)) {
          const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
          probe.getTracks().forEach((t) => t.stop());
          all = await navigator.mediaDevices.enumerateDevices();
        }
        const dev = matchDevice(all, name);
        if (!dev) {
          if (live) setError("the browser can't see this mic, so there's no meter for it (it still records)");
          return;
        }
        s = await navigator.mediaDevices.getUserMedia({ audio: { ...RAW_MIC, deviceId: { exact: dev.deviceId } }, video: false });
        if (!live) return s.getTracks().forEach((t) => t.stop());
        setStream(s);
      } catch (e) {
        if (!live) return;
        const n = (e as { name?: string })?.name || "";
        setError(n === "NotAllowedError" ? "mic access is blocked for this page, so there's no meter. Allow it from the icon left of the address bar." : "couldn't open the mic for the meter");
      }
    })();
    return () => {
      live = false;
      s?.getTracks().forEach((t) => t.stop());
    };
  }, [name]);
  return { stream, error };
}

// ── The five-second test ───────────────────────────────────────────────────────────────────────────

export type Verdict = "silent" | "quiet" | "ok" | "good" | "clipping";

export interface MicTest {
  id: string;
  /** Which mic, as the picker names it. */
  label: string;
  url: string;
  at: number;
  /** The loudest single sample. */
  peakDb: number;
  /** How loud you were: the loudest 30% of the test, averaged. */
  voiceDb: number;
  /** The room with you not talking: the quietest 20%. The gap between the two is what makes one
   *  mic sound cleaner than another. */
  noiseDb: number;
  verdict: Verdict;
  advice: string;
}

/** Energy average of some RMS readings, in dB. */
function meanDb(rms: number[]): number {
  if (!rms.length) return -Infinity;
  return toDb(Math.sqrt(rms.reduce((a, r) => a + r * r, 0) / rms.length));
}

export function judge(peakDb: number, voiceDb: number, noiseDb: number): { verdict: Verdict; advice: string } {
  // Either test alone misses one case: a muted mic can still let one stray click through (peak over
  // -70 while the rest is -86, seen on the muted fifine), and the peak alone would call that "quiet".
  if (peakDb <= SILENT_DB || voiceDb <= SILENT_DB) return { verdict: "silent", advice: "Nothing at all. The mic is sending silence: its mute button is probably on (a red light usually means muted), or its gain is at zero." };
  if (peakDb >= -0.5) return { verdict: "clipping", advice: "Too loud: it's clipping, and that distortion can't be fixed later. Turn the mic's gain down or sit back a little." };
  if (voiceDb < -42 || voiceDb - noiseDb < 12) return { verdict: "quiet", advice: "It barely heard you over the room. Talk closer to the mic, or turn its gain up." };
  if (voiceDb < -34) return { verdict: "ok", advice: "A bit quiet, but usable (the export evens the level out). Closer is better." };
  return { verdict: "good", advice: "Good level." };
}

// The tests live for the session outside any component, so the booth and the Screen Recorder show the
// same list, and switching project or tab doesn't lose them.
let tests: MicTest[] = [];
const listeners = new Set<() => void>();
const MAX_TESTS = 6;
function setTests(next: MicTest[]) {
  const keep = new Set(next.map((t) => t.url));
  for (const t of tests) if (!keep.has(t.url)) URL.revokeObjectURL(t.url);
  tests = next;
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
export function useMicTests(): [MicTest[], (id: string) => void] {
  const list = useSyncExternalStore(subscribe, () => tests, () => tests);
  const remove = useCallback((id: string) => setTests(tests.filter((t) => t.id !== id)), []);
  return [list, remove];
}

/** Record TEST_S seconds from the stream, measuring as it goes. The recording is kept so you can
 *  hear what the mic heard. That's the real test; the numbers are there to compare mics by. */
export async function runMicTest(stream: MediaStream, label: string, onLeft: (s: number) => void): Promise<MicTest> {
  const ctx = newContext();
  await ctx.resume().catch(() => {});
  const an = ctx.createAnalyser();
  an.fftSize = 2048;
  const src = ctx.createMediaStreamSource(stream);
  src.connect(an);
  const buf = new Float32Array(an.fftSize);
  const mime = ["audio/webm;codecs=opus", "audio/webm"].find((m) => MediaRecorder.isTypeSupported(m)) || "";
  const rec = new MediaRecorder(new MediaStream(stream.getAudioTracks()), mime ? { mimeType: mime } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((r) => (rec.onstop = () => r()));

  let peak = 0;
  const rms: number[] = [];
  const t0 = performance.now();
  rec.start();
  await new Promise<void>((done) => {
    const timer = setInterval(() => {
      an.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = Math.abs(buf[i]);
        if (v > peak) peak = v;
        sum += buf[i] * buf[i];
      }
      rms.push(Math.sqrt(sum / buf.length));
      const left = TEST_S - (performance.now() - t0) / 1000;
      onLeft(Math.max(0, left));
      if (left <= 0) {
        clearInterval(timer);
        done();
      }
    }, 50);
  });
  rec.stop();
  await stopped;
  src.disconnect();
  void ctx.close();

  const sorted = [...rms].sort((a, b) => a - b);
  const voiceDb = meanDb(sorted.slice(Math.floor(sorted.length * 0.7)));
  const noiseDb = meanDb(sorted.slice(0, Math.max(1, Math.floor(sorted.length * 0.2))));
  const peakDb = toDb(peak);
  const test: MicTest = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    label,
    url: URL.createObjectURL(new Blob(chunks, { type: rec.mimeType || "audio/webm" })),
    at: Date.now(),
    peakDb,
    voiceDb,
    noiseDb,
    ...judge(peakDb, voiceDb, noiseDb),
  };
  setTests([test, ...tests].slice(0, MAX_TESTS));
  return test;
}
