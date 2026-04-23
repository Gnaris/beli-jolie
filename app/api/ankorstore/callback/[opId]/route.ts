import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";

/**
 * Minimal Ankorstore callback receiver.
 *
 * Ankorstore requires a `callbackUrl` field when creating catalog operations.
 * We provide this endpoint to satisfy the contract, but we operate fire-and-forget:
 * Ankorstore calls us once the operation is processed, and we just log the result.
 *
 * The admin is expected to verify the final state on the Ankorstore dashboard.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ opId: string }> },
): Promise<NextResponse> {
  const { opId } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = await req.text().catch(() => "<unreadable>");
  }

  logger.info("[Ankorstore Callback] Received result", {
    opId,
    body: typeof body === "string" ? body.slice(0, 500) : JSON.stringify(body).slice(0, 1000),
  });

  return NextResponse.json({ ok: true });
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ opId: string }> },
): Promise<NextResponse> {
  const { opId } = await ctx.params;
  return NextResponse.json({ ok: true, opId });
}
