/**
 * Ankorstore webhook receiver — `POST /api/webhooks/ankorstore?secret=...`
 *
 * Ankorstore appelle cette route quand une catalog-integration operation
 * arrive à un statut terminal (succeeded / partially_failed / failed / skipped).
 *
 * Sécurité : nous vérifions le `secret` query-string (Ankorstore ne signe pas
 * ses callbacks, donc c'est notre seul vérificateur d'authenticité). Le secret
 * vient de `ANKORSTORE_WEBHOOK_SECRET` (env var, valeur aléatoire stockée
 * uniquement côté serveur).
 *
 * Idempotence : si l'opération est déjà en statut terminal côté BDD, on
 * répond 200 sans retraiter.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { ankorstoreFinalizePublish } from "@/lib/ankorstore-publish";
import { ankorstoreFinalizeUpdate } from "@/lib/ankorstore-update";
import {
  ankorstoreFinalizeRefreshDeleteOld,
  ankorstoreFinalizeRefreshCreateNew,
} from "@/lib/ankorstore-refresh";
import { ankorstoreFinalizeDelete } from "@/lib/ankorstore-delete";

interface AnkorstoreCallbackBody {
  event?: string;
  topic?: string;
  occurredAt?: string;
  data?: {
    id?: string;
    type?: string;
    attributes?: {
      status?: string;
      operationType?: string;
      failureReason?: string | null;
      [key: string]: unknown;
    };
  };
}

export async function POST(request: Request) {
  // ── Step 1: secret check ──
  const url = new URL(request.url);
  const providedSecret = url.searchParams.get("secret") ?? "";
  const expectedSecret = process.env.ANKORSTORE_WEBHOOK_SECRET ?? "";

  if (!expectedSecret) {
    logger.error("[Ankorstore Webhook] ANKORSTORE_WEBHOOK_SECRET not configured");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }
  if (providedSecret !== expectedSecret) {
    logger.warn("[Ankorstore Webhook] Invalid secret", {
      providedLength: providedSecret.length,
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Step 2: parse body ──
  let body: AnkorstoreCallbackBody;
  try {
    body = (await request.json()) as AnkorstoreCallbackBody;
  } catch {
    logger.warn("[Ankorstore Webhook] Invalid JSON body");
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const operationId = body.data?.id;
  if (!operationId || typeof operationId !== "string") {
    logger.warn("[Ankorstore Webhook] Missing operationId in body", { body });
    return NextResponse.json({ error: "Missing operationId" }, { status: 400 });
  }

  logger.info("[Ankorstore Webhook] Received", {
    operationId,
    event: body.event,
    status: body.data?.attributes?.status,
    operationType: body.data?.attributes?.operationType,
  });

  // ── Step 3: lookup operation in DB ──
  // Ankorstore peut appeler ce webhook AVANT que le persist local se termine
  // (surtout sur les operations en un seul appel réseau — delete/refresh).
  // On retry 2× avec pause pour rattraper la race, sinon on ACK 200 pour
  // qu'Ankorstore n'insiste pas indéfiniment.
  let op = await prisma.ankorstoreOperation.findUnique({ where: { id: operationId } });
  if (!op) {
    for (let attempt = 1; attempt <= 2 && !op; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
      op = await prisma.ankorstoreOperation.findUnique({ where: { id: operationId } });
      if (op) {
        logger.info("[Ankorstore Webhook] Operation resolved after retry", {
          operationId,
          attempt,
        });
      }
    }
  }
  if (!op) {
    // Op toujours introuvable après retry — soit callback d'un ancien déploiement,
    // soit persist définitivement raté (à investiguer si ça se répète).
    logger.error("[Ankorstore Webhook] Unknown operationId after retry — ACK to stop retries", {
      operationId,
      event: body.event,
      status: body.data?.attributes?.status,
    });
    return NextResponse.json({ ok: true, reason: "unknown_operation" }, { status: 200 });
  }

  // ── Step 4: idempotency / recovery check ──
  // SUCCEEDED / FAILED / PARTIALLY_FAILED → already finalized, ACK and stop.
  if (
    op.status === "SUCCEEDED" ||
    op.status === "FAILED" ||
    op.status === "PARTIALLY_FAILED"
  ) {
    logger.info("[Ankorstore Webhook] Already finalized — idempotent ACK", {
      operationId,
      currentStatus: op.status,
    });
    return NextResponse.json({ ok: true, reason: "already_finalized" }, { status: 200 });
  }

  // CANCELLED → for refresh ops, attempt recovery rather than silently dropping
  // the chain. Skip recovery only when a newer op exists (the newer one will
  // handle its own refresh chain).
  if (op.status === "CANCELLED") {
    const isRefreshChain =
      op.type === "REFRESH_DELETE_OLD" || op.type === "REFRESH_CREATE_NEW";

    if (!isRefreshChain) {
      logger.info("[Ankorstore Webhook] Cancelled non-refresh op — idempotent ACK", {
        operationId,
        type: op.type,
      });
      return NextResponse.json({ ok: true, reason: "cancelled_non_refresh" }, { status: 200 });
    }

    const supersedingOp = await prisma.ankorstoreOperation.findFirst({
      where: {
        productId: op.productId,
        type: {
          in: ["PUBLISH", "UPDATE", "REFRESH_DELETE_OLD", "REFRESH_CREATE_NEW", "DELETE"],
        },
        createdAt: { gt: op.createdAt },
      },
      orderBy: { createdAt: "desc" },
    });

    if (supersedingOp) {
      logger.info("[Ankorstore Webhook] Cancelled refresh superseded — idempotent ACK", {
        operationId,
        supersedingOpId: supersedingOp.id,
        supersedingType: supersedingOp.type,
        supersedingStatus: supersedingOp.status,
      });
      return NextResponse.json({ ok: true, reason: "superseded" }, { status: 200 });
    }

    logger.warn("[Ankorstore Webhook] Recovering orphaned refresh op", {
      operationId,
      type: op.type,
      productId: op.productId,
      cancelledAt: op.completedAt,
    });
  }

  // ── Step 5: dispatch to finalize handler ──
  try {
    switch (op.type) {
      case "PUBLISH":
        await ankorstoreFinalizePublish(op, body);
        break;
      case "UPDATE":
        await ankorstoreFinalizeUpdate(op, body);
        break;
      case "REFRESH_DELETE_OLD":
        await ankorstoreFinalizeRefreshDeleteOld(op, body);
        break;
      case "REFRESH_CREATE_NEW":
        await ankorstoreFinalizeRefreshCreateNew(op, body);
        break;
      case "DELETE":
        await ankorstoreFinalizeDelete(op, body);
        break;
      default:
        logger.error("[Ankorstore Webhook] Unknown operation type", {
          operationId,
          type: op.type,
        });
        return NextResponse.json({ error: "Unknown operation type" }, { status: 500 });
    }
  } catch (err) {
    logger.error("[Ankorstore Webhook] Finalize threw — operation may be stuck", {
      operationId,
      type: op.type,
      error: err,
    });
    // Return 200 anyway so Ankorstore doesn't retry endlessly. The operation
    // status in DB will reflect the failure (finalize handlers catch their
    // own errors and mark the row FAILED).
    return NextResponse.json({ ok: false, reason: "finalize_error" }, { status: 200 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
