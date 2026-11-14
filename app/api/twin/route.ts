import { NextResponse } from "next/server";
import { connected, readConfig } from "../../../lib/config";
import { refreshFromApi, resumeApiJobs, startApiJob } from "../../../lib/heygenApi";
import { sendFile } from "../../../lib/sendFile";
import {
  addPhoto,
  deleteJob,
  launchLookRefresh,
  launchMaker,
  listJobs,
  listLooks,
  listPhotos,
  listVoices,
  lookThumbPath,
  makeJob,
  photoPath,
  renameJob,
  retryJob,
  reveal,
  thumbOf,
  videoPath,
  type MakeInput,
} from "../../../lib/twinServer";

// Twin (see lib/twinServer.ts).
//   GET  (nothing)                         → { looks, voices, sources, jobs }
//   GET  ?look=<id> | ?photo=<photos/file> → a picture
//   GET  ?v=<file>[&thumb=1|&download=1]   → a finished video (byte ranges) or its first frame
//   POST { action: "make", ...MakeInput }  → writes the job, then opens Claude (account) or calls HeyGen (api)
//   POST { action: "launch" | "refresh-looks" | "retry" | "rename" | "reveal", id?, title?, file?, folder? }
//   POST ?photo=<file name>  (image body)  → adds a photo to my-twin/photos
//   DELETE ?id=<job>                       → moves it into my-twin/.trash
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMG_TYPE = (p: string) => (/\.png$/i.test(p) ? "image/png" : /\.webp$/i.test(p) ? "image/webp" : "image/jpeg");
const notFound = () => NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  if (q.get("look")) {
    const p = lookThumbPath(q.get("look")!);
    return p ? sendFile(req, p, "image/jpeg") : notFound();
  }
  if (q.get("photo")) {
    const p = photoPath(q.get("photo")!);
    if (!p) return notFound();
    const t = await thumbOf(p, false);
    return t ? sendFile(req, t, "image/jpeg") : sendFile(req, p, IMG_TYPE(p));
  }
  if (q.get("v")) {
    const p = videoPath(q.get("v")!);
    if (!p) return notFound();
    if (q.get("thumb")) {
      const t = await thumbOf(p, true);
      return t ? sendFile(req, t, "image/jpeg") : notFound();
    }
    return sendFile(req, p, p.toLowerCase().endsWith(".webm") ? "video/webm" : "video/mp4", q.get("download") ? q.get("v")! : undefined);
  }
  resumeApiJobs();
  return NextResponse.json({ ok: true, looks: listLooks(), voices: listVoices(), sources: listPhotos(), jobs: listJobs() });
}

export async function POST(req: Request) {
  const q = new URL(req.url).searchParams;
  try {
    if (q.get("photo")) return NextResponse.json({ ok: true, id: addPhoto(q.get("photo")!, Buffer.from(await req.arrayBuffer())) });
    const b = (await req.json().catch(() => ({}))) as MakeInput & { action?: string; id?: string; title?: string; file?: string; folder?: "photos" | "voice" | "videos" | "root" };
    const c = readConfig();
    if (b.action === "make") {
      if (!c.mode || !connected(c)) throw new Error("Connect HeyGen first (the strip at the top).");
      const job = makeJob(b, c.mode);
      if (c.mode === "api") startApiJob(job.id);
      else launchMaker();
      return NextResponse.json({ ok: true, job });
    }
    if (b.action === "launch") {
      launchMaker();
      return NextResponse.json({ ok: true });
    }
    if (b.action === "refresh-looks") {
      if (c.mode === "api") return NextResponse.json({ ok: true, ...(await refreshFromApi()) });
      launchLookRefresh();
      return NextResponse.json({ ok: true, launched: true });
    }
    if (b.action === "retry") {
      const job = retryJob(b.id || "");
      if (job.mode === "api") startApiJob(job.id);
      else launchMaker();
      return NextResponse.json({ ok: true });
    }
    if (b.action === "rename") {
      renameJob(b.id || "", b.title || "");
      return NextResponse.json({ ok: true });
    }
    if (b.action === "reveal") {
      reveal({ file: b.file, folder: b.folder });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  try {
    deleteJob(new URL(req.url).searchParams.get("id") || "");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 404 });
  }
}
