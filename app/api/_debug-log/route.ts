import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    // eslint-disable-next-line no-console
    console.log("[CLIENT DEBUG]", JSON.stringify(body, null, 2));
  } catch {
    // ignore
  }
  return NextResponse.json({ ok: true });
}
