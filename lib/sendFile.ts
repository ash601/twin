import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";

/** A file as a response, with byte ranges so <video> / <audio> can seek. */
export function sendFile(req: Request, p: string, type: string, download?: string) {
  const size = statSync(p).size;
  const dl: Record<string, string> = download ? { "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(download)}` } : {};
  const m = (req.headers.get("range") || "").match(/^bytes=(\d*)-(\d*)$/);
  if (m && (m[1] || m[2])) {
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(size - 1, Number(m[2])) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    return new Response(Readable.toWeb(createReadStream(p, { start, end })) as ReadableStream, {
      status: 206,
      headers: { "content-type": type, "content-length": String(end - start + 1), "content-range": `bytes ${start}-${end}/${size}`, "accept-ranges": "bytes", ...dl },
    });
  }
  return new Response(Readable.toWeb(createReadStream(p)) as ReadableStream, {
    headers: { "content-type": type, "content-length": String(size), "accept-ranges": "bytes", "cache-control": "no-store", ...dl },
  });
}
