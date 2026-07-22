/**
 * GET  /api/admin/ankorstore-catalog       → SSE stream (progress + complete)
 * POST /api/admin/ankorstore-catalog       → invalide le cache et relance un chargement
 *                                            (renvoie un SSE comme GET)
 *
 * Auth : ADMIN.
 * SSE events :
 *   data: {"type":"status","entries":N,"loadedAt":"..."}             — état initial
 *   data: {"type":"progress","loaded":50,"pageIndex":0,"total":null} — chaque page
 *   data: {"type":"complete","entries":[...],"loadedAt":"..."}       — fin
 *   data: {"type":"error","message":"..."}                            — erreur
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  getCachedCatalog,
  getCatalogStatus,
  loadFullCatalog,
  invalidateCatalogCache,
} from "@/lib/ankorstore-catalog-cache";
import { requireCurrentTenant } from "@/lib/tenant";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function requireAdminOr401() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }
  return null;
}

function buildStream(tenantId: string): Response {
  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const safeEnqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const send = (data: unknown) =>
        safeEnqueue(`data: ${JSON.stringify(data)}\n\n`);

      heartbeat = setInterval(() => safeEnqueue(": heartbeat\n\n"), 15_000);

      // Si le cache est déjà frais, on l'envoie tel quel et on ferme.
      const cached = getCachedCatalog(tenantId);
      if (cached) {
        const status = getCatalogStatus(tenantId);
        send({
          type: "complete",
          entries: cached,
          loadedAt: status.loadedAt,
          fromCache: true,
        });
        cleanup();
        return;
      }

      // Sinon on démarre un chargement complet et on streame la progression.
      try {
        const entries = await loadFullCatalog(tenantId, (p) => {
          send({
            type: "progress",
            loaded: p.loaded,
            pageIndex: p.pageIndex,
          });
        });
        const status = getCatalogStatus(tenantId);
        send({
          type: "complete",
          entries,
          loadedAt: status.loadedAt,
          fromCache: false,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send({ type: "error", message });
      } finally {
        cleanup();
      }
    },
    cancel() {
      cleanup();
    },
  });

  function cleanup() {
    if (closed) return;
    closed = true;
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  }

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function GET() {
  const unauthorized = await requireAdminOr401();
  if (unauthorized) return unauthorized;
  const tenant = await requireCurrentTenant();
  return buildStream(tenant.id);
}

export async function POST(_req: NextRequest) {
  const unauthorized = await requireAdminOr401();
  if (unauthorized) return unauthorized;
  const tenant = await requireCurrentTenant();
  invalidateCatalogCache(tenant.id);
  logger.info("[Ankorstore Catalog] Rechargement manuel demandé", { tenantId: tenant.id });
  return buildStream(tenant.id);
}
