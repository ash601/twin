import path from "node:path";
import { NextResponse } from "next/server";
import { sendFile } from "../../../lib/sendFile";
import { listTakes, saveTake, takePath } from "../../../lib/soundServer";

// Your voice takes in my-twin/voice.
//   GET  (nothing)              → { items }
//   GET  ?f=<file>[&download=1] → the take itself (byte ranges)
//   POST ?take=1[&name=]  (audio body) → saved as WAV → { item, warning? }
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".webm": "audio/webm",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".opus": "audio/ogg",
  ".flac": "audio/flac",
  ".aif": "audio/aiff",
  ".aiff": "audio/aiff",
};

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const f = q.get("f");
  if (!f) return NextResponse.json({ ok: true, items: listTakes() });
  const p = takePath(f);
  if (!p) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  return sendFile(req, p, TYPES[path.extname(p).toLowerCase()] || "application/octet-stream", q.get("download") ? path.basename(p) : undefined);
}

export async function POST(req: Request) {
  const q = new URL(req.url).searchParams;
  try {
    if (!q.get("take")) return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
    return NextResponse.json({ ok: true, ...(await saveTake(Buffer.from(await req.arrayBuffer()), q.get("name") || undefined)) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
