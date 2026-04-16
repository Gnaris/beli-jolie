/**
 * Ankorstore Operation Callback Webhook
 *
 * Called by Ankorstore when a catalog operation (push/delete) completes.
 * If this callback arrives before the fallback polling, it processes the result immediately.
 * If the fallback already resolved it, this is a no-op.
 */

import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import {
  getOperation,
  removeOperation,
  processPushResult,
  processDeleteResult,
} from "@/lib/ankorstore-operations";
import { getAnkorstoreHeaders, ANKORSTORE_BASE_URL } from "@/lib/ankorstore-auth";

interface OperationResult {
  externalProductId?: string;
  status: "success" | "failure";
  failureReason?: string;
  issues?: { field: string; reason: string; message: string }[];
}

export async function POST(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const opId = searchParams.get("opId");

    if (!opId) {
      logger.warn("[Ankorstore Callback] Missing opId");
      return NextResponse.json({ error: "Missing opId" }, { status: 400 });
    }

    const pendingOp = getOperation(opId);
    if (!pendingOp) {
      // Already resolved by fallback, or unknown
      logger.info("[Ankorstore Callback] Operation already resolved or unknown", { opId });
      return NextResponse.json({ ok: true, status: "already_resolved" });
    }

    if (pendingOp.resolved) {
      return NextResponse.json({ ok: true, status: "already_resolved" });
    }

    logger.info("[Ankorstore Callback] Received", { opId, type: pendingOp.type, productId: pendingOp.productId });

    // Fetch actual status from Ankorstore API (don't trust the callback body blindly)
    const headers = await getAnkorstoreHeaders();
    const checkRes = await fetch(`${ANKORSTORE_BASE_URL}/catalog/integrations/operations/${opId}`, { headers });
    if (!checkRes.ok) {
      logger.warn("[Ankorstore Callback] Failed to verify operation status", { opId, status: checkRes.status });
      return NextResponse.json({ error: "Failed to verify" }, { status: 502 });
    }

    const checkData = await checkRes.json();
    const status = checkData.data?.attributes?.status as string;

    // If still processing, ignore — intermediate callback
    if (!["succeeded", "completed", "failed", "partially_failed", "skipped"].includes(status)) {
      logger.info("[Ankorstore Callback] Operation still processing", { opId, status });
      return NextResponse.json({ ok: true, status: "processing" });
    }

    // Fetch detailed results
    let results: OperationResult[] = [];
    if (["succeeded", "completed", "failed", "partially_failed"].includes(status)) {
      const resultsRes = await fetch(
        `${ANKORSTORE_BASE_URL}/catalog/integrations/operations/${opId}/results`,
        { headers }
      );
      if (resultsRes.ok) {
        const resultsData = await resultsRes.json();
        results = (resultsData.data ?? []).map(
          (r: { attributes: OperationResult }) => r.attributes
        );
      }
    }

    // Process based on operation type
    if (pendingOp.type === "delete") {
      await processDeleteResult(pendingOp.productId, status, results);
    } else {
      await processPushResult(pendingOp.productId, status, results, pendingOp.hadOptimisticLink);
    }

    removeOperation(opId);
    logger.info("[Ankorstore Callback] Processed", { opId, status });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[Ankorstore Callback] Error", { error: message });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
