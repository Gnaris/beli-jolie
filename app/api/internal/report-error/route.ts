import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { reportCriticalError } from "@/lib/health";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { isTransientBrowserError } from "@/lib/transient-browser-errors";

/**
 * Appelé par les error boundaries pour tracer les plantages côté navigateur.
 * Rate-limit : 10 par IP / 15 min (relevé depuis 3 pour couvrir les rafales de
 * crashes Safari iOS sur une même page sans faire sauter le circuit breaker).
 */
export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for") || "unknown";
    const { success } = rateLimit(`report-error:${ip}`, 10, 15 * 60 * 1000);
    if (!success) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

    const body = await request.json().catch(() => ({}));
    const source = typeof body?.source === "string" ? body.source : "unknown";
    const message = typeof body?.message === "string" ? body.message : "";
    const digest = typeof body?.digest === "string" ? body.digest : undefined;
    const url = typeof body?.url === "string" ? body.url : undefined;
    const userAgent = typeof body?.userAgent === "string" ? body.userAgent : undefined;
    const visibilityState = typeof body?.visibilityState === "string" ? body.visibilityState : undefined;
    const wasHidden = typeof body?.wasHidden === "boolean" ? body.wasHidden : undefined;

    const session = await getServerSession(authOptions).catch(() => null);
    const userEmail = session?.user?.email ?? undefined;
    const userId = (session?.user as { id?: string } | undefined)?.id;

    const transient = isTransientBrowserError(message);

    logger.warn("[Browser Error]", {
      source,
      message,
      transient,
      digest,
      url,
      userAgent,
      visibilityState,
      wasHidden,
      userEmail,
      userId,
      ip,
    });

    // Circuit breaker : seulement pour les sources qui remontent de vrais
    // crashes serveur (route-error-boundary = plantage SSR). On exclut les
    // boundaries purement client (auth/client/admin/global) qui attrapent
    // majoritairement des hoquets Safari sans impact serveur, et on exclut
    // tous les messages identifiés "transients" (reload résout).
    const triggered =
      source === "route-error-boundary" && !transient
        ? reportCriticalError(source)
        : false;

    return NextResponse.json({
      received: true,
      transient,
      maintenanceTriggered: triggered,
    });
  } catch {
    return NextResponse.json({ received: true });
  }
}
