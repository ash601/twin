import { NextResponse } from "next/server";

// The Turn off button: answers, then stops the server so the port is free again.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  setTimeout(() => process.exit(0), 300);
  return NextResponse.json({ ok: true });
}
