/**
 * In-memory store for pending Ankorstore catalog operations.
 * Uses globalThis singleton to survive HMR in dev.
 *
 * Dual strategy: callback + fallback polling
 * - In production: Ankorstore calls our webhook → instant result
 * - Fallback: if no callback arrives within FALLBACK_DELAY, we poll once to check
 *
 * This ensures the system works everywhere (local dev without ngrok, prod, etc.)
 */

import { logger } from "@/lib/logger";
import { getAnkorstoreHeaders, ANKORSTORE_BASE_URL } from "@/lib/ankorstore-auth";
import { prisma } from "@/lib/prisma";
import { emitProductEvent, type MarketplaceSyncProgress } from "@/lib/product-events";

export interface PendingOperation {
  opId: string;
  productId: string;
  type: "import" | "update" | "delete";
  /** Whether we optimistically set ankorsProductId before the operation completed */
  hadOptimisticLink: boolean;
  /** Product reference (external_id on Ankorstore) */
  reference: string;
  createdAt: number;
  /** Whether this operation has already been resolved (by callback or fallback) */
  resolved?: boolean;
}

const GLOBAL_KEY = "__bj_ankorstore_pending_ops__" as const;
const MAX_AGE_MS = 15 * 60 * 1000; // 15 minutes
const FALLBACK_DELAY_MS = 10_000; // 10s — if callback hasn't arrived, poll once

function getStore(): Map<string, PendingOperation> {
  const g = globalThis as unknown as Record<string, Map<string, PendingOperation>>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new Map();
  }
  return g[GLOBAL_KEY];
}

export function registerOperation(op: PendingOperation): void {
  const store = getStore();
  store.set(op.opId, op);
  logger.info("[Ankorstore Ops] Registered", { opId: op.opId, type: op.type, productId: op.productId });

  // Auto-cleanup stale operations
  for (const [id, existing] of store) {
    if (Date.now() - existing.createdAt > MAX_AGE_MS) {
      store.delete(id);
      logger.warn("[Ankorstore Ops] Cleaned up stale operation", { opId: id, type: existing.type, productId: existing.productId });
    }
  }

  // Schedule fallback polling — if callback hasn't arrived by then, check ourselves
  scheduleFallbackCheck(op.opId);
}

export function getOperation(opId: string): PendingOperation | undefined {
  return getStore().get(opId);
}

export function removeOperation(opId: string): void {
  const store = getStore();
  const op = store.get(opId);
  if (op) op.resolved = true;
  store.delete(opId);
}

/**
 * Build the callback URL for an Ankorstore operation.
 * Uses ANKORSTORE_CALLBACK_URL (explicit) or NEXTAUTH_URL as fallback.
 */
export function buildCallbackUrl(opId: string): string {
  const base = (
    process.env.ANKORSTORE_CALLBACK_URL
    || process.env.NEXTAUTH_URL
    || "https://example.com"
  ).replace(/\/$/, "");
  return `${base}/api/ankorstore/callback?opId=${opId}`;
}

// ─── Fallback polling ─────────────────────────────────────────────────────

function emitAnkors(productId: string, p: Omit<MarketplaceSyncProgress, "marketplace">) {
  emitProductEvent({ type: "MARKETPLACE_SYNC", productId, marketplaceSync: { marketplace: "ankorstore", ...p } });
}

interface OperationResult {
  externalProductId?: string;
  status: "success" | "failure";
  failureReason?: string;
  issues?: { field: string; reason: string; message: string }[];
}

/**
 * Schedule a single fallback check after FALLBACK_DELAY_MS.
 * If the callback already resolved the operation, this is a no-op.
 * If not, we poll Ankorstore once and process the result.
 * If still processing, we schedule another check with exponential backoff.
 */
function scheduleFallbackCheck(opId: string, attempt = 0): void {
  const delay = attempt === 0 ? FALLBACK_DELAY_MS : Math.min(FALLBACK_DELAY_MS * Math.pow(1.5, attempt), 45_000);

  setTimeout(async () => {
    const op = getStore().get(opId);
    if (!op || op.resolved) return; // Already resolved by callback

    try {
      const headers = await getAnkorstoreHeaders();
      const checkRes = await fetch(`${ANKORSTORE_BASE_URL}/catalog/integrations/operations/${opId}`, { headers });
      if (!checkRes.ok) {
        logger.warn("[Ankorstore Fallback] Failed to check operation", { opId, status: checkRes.status });
        if (attempt < 5) scheduleFallbackCheck(opId, attempt + 1);
        return;
      }

      const checkData = await checkRes.json();
      const status = checkData.data?.attributes?.status as string;

      logger.info("[Ankorstore Fallback] Poll result", { opId, status, attempt });

      if (!["succeeded", "completed", "failed", "partially_failed", "skipped"].includes(status)) {
        // Still processing — schedule another check (max 5 retries)
        if (attempt < 5) {
          scheduleFallbackCheck(opId, attempt + 1);
        } else {
          logger.warn("[Ankorstore Fallback] Gave up after max retries", { opId });
          emitAnkors(op.productId, { step: "Timeout — vérifiez manuellement", progress: 100, status: "error", error: "Pas de réponse d'Ankorstore" });
          removeOperation(opId);
        }
        return;
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

      // Process result
      if (op.type === "delete") {
        await processDeleteResult(op.productId, status, results);
      } else {
        await processPushResult(op.productId, status, results, op.hadOptimisticLink);
      }

      removeOperation(opId);
    } catch (err) {
      logger.error("[Ankorstore Fallback] Error", { opId, error: err instanceof Error ? err.message : String(err) });
      if (attempt < 5) scheduleFallbackCheck(opId, attempt + 1);
    }
  }, delay);
}

// ─── Shared result processing (used by both callback and fallback) ────────

export async function processPushResult(
  productId: string,
  opStatus: string,
  results: OperationResult[],
  hadOptimisticLink: boolean,
) {
  const success = opStatus === "succeeded" || opStatus === "completed";
  const productResult = results[0];

  if (!success || productResult?.status === "failure") {
    if (hadOptimisticLink) {
      await prisma.product.update({
        where: { id: productId },
        data: { ankorsProductId: null, ankorsMatchedAt: null },
      });
      logger.warn("[Ankorstore Result] Rolled back optimistic link", { productId });
    }

    const errorMsg = productResult?.issues?.map((i) => `${i.field}: ${i.message}`).join("; ")
      || productResult?.failureReason
      || results.map((r) => r.failureReason).filter(Boolean).join(" | ")
      || `Operation ${opStatus}`;

    await prisma.product.update({
      where: { id: productId },
      data: { ankorsSyncStatus: "failed", ankorsSyncError: errorMsg.slice(0, 5000) },
    }).catch(() => {});

    emitAnkors(productId, { step: "Erreur de synchronisation", progress: 100, status: "error", error: errorMsg });
    logger.error("[Ankorstore Result] Push failed", { productId, opStatus, error: errorMsg });
    return;
  }

  await prisma.product.update({
    where: { id: productId },
    data: { ankorsSyncStatus: "synced", ankorsSyncError: null, ankorsSyncedAt: new Date() },
  });

  try {
    const { revalidateTag } = await import("next/cache");
    revalidateTag("products", "default");
  } catch { /* fire-and-forget context */ }

  emitAnkors(productId, { step: "Synchronisé avec succès", progress: 100, status: "success" });
  logger.info("[Ankorstore Result] Push succeeded", { productId });
}

export async function processDeleteResult(
  productId: string,
  opStatus: string,
  results: OperationResult[],
) {
  const success = opStatus === "succeeded" || opStatus === "completed";

  if (!success) {
    const failures = results
      .filter((r) => r.status === "failure")
      .map((r) => {
        const issues = r.issues?.map((i) => `${i.field}: ${i.message}`).join("; ");
        return issues || r.failureReason || "Unknown";
      });
    const errorMsg = failures.length > 0 ? failures.join(" | ") : `Operation ${opStatus}`;

    emitAnkors(productId, { step: "Erreur de suppression", progress: 100, status: "error", error: errorMsg });
    logger.error("[Ankorstore Result] Delete failed", { productId, opStatus, error: errorMsg });
    return;
  }

  await prisma.product.updateMany({
    where: { id: productId },
    data: { ankorsProductId: null, ankorsMatchedAt: null, ankorsSyncStatus: null, ankorsSyncError: null },
  }).catch(() => { /* product may already be deleted locally */ });

  emitAnkors(productId, { step: "Supprimé d'Ankorstore", progress: 100, status: "success" });
  logger.info("[Ankorstore Result] Delete succeeded", { productId });
}
