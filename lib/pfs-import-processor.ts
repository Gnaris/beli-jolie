/**
 * PFS Import Background Processor
 *
 * Runs as a fire-and-forget async function: creates products one by one
 * from PFS, updates ImportJob progress in DB, and emits SSE events for
 * real-time UI updates. Survives client disconnection.
 *
 * Supports cancellation: checks job status before each product —
 * if CANCELLED, stops immediately.
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { approveAndImportPfsProduct } from "@/lib/pfs-import";
import { emitProductEvent } from "@/lib/product-events";

export interface PfsImportItem {
  pfsId: string;
  reference: string;
  name: string;
}

/**
 * Process a PFS import job: import products one by one, update progress,
 * emit SSE events. Callable as fire-and-forget.
 */
export async function processPfsImport(jobId: string): Promise<void> {
  const job = await prisma.importJob.findUnique({ where: { id: jobId } });
  if (!job) {
    logger.error("[PFS Import Processor] Job not found", { jobId });
    return;
  }

  const items: PfsImportItem[] = (job.resultDetails as { items?: PfsImportItem[] })?.items ?? [];
  if (items.length === 0) {
    await prisma.importJob.update({
      where: { id: jobId },
      data: { status: "COMPLETED", errorMessage: "Aucun produit à importer" },
    });
    return;
  }

  // Mark as processing
  await prisma.importJob.update({
    where: { id: jobId },
    data: { status: "PROCESSING", totalItems: items.length },
  });

  emitProgress(jobId, 0, items.length, 0, 0, "PROCESSING");

  const results: { pfsId: string; reference: string; name: string; status: "ok" | "error"; productId?: string; error?: string }[] = [];
  let success = 0;
  let errors = 0;

  for (let i = 0; i < items.length; i++) {
    // Check if cancelled
    const current = await prisma.importJob.findUnique({
      where: { id: jobId },
      select: { status: true },
    });
    if (current?.status === "CANCELLED") {
      logger.info("[PFS Import Processor] Job cancelled", { jobId, processed: i });
      // Keep the counts as-is, status already CANCELLED
      await prisma.importJob.update({
        where: { id: jobId },
        data: {
          processedItems: i,
          successItems: success,
          errorItems: errors,
          resultDetails: { items, results },
        },
      });
      emitProgress(jobId, i, items.length, success, errors, "FAILED");
      return;
    }

    const item = items[i];
    try {
      const result = await approveAndImportPfsProduct(item.pfsId);
      success++;
      results.push({
        pfsId: item.pfsId,
        reference: item.reference,
        name: item.name,
        status: "ok",
        productId: result.productId,
      });
    } catch (err) {
      errors++;
      const errMsg = err instanceof Error ? err.message : String(err);
      results.push({
        pfsId: item.pfsId,
        reference: item.reference,
        name: item.name,
        status: "error",
        error: errMsg,
      });
      logger.warn("[PFS Import Processor] Product import failed", {
        jobId,
        pfsId: item.pfsId,
        reference: item.reference,
        error: errMsg,
      });
    }

    // Update progress in DB
    const processed = i + 1;
    await prisma.importJob.update({
      where: { id: jobId },
      data: {
        processedItems: processed,
        successItems: success,
        errorItems: errors,
        resultDetails: { items, results },
      },
    });

    emitProgress(jobId, processed, items.length, success, errors, "PROCESSING");
  }

  // Done — build summary with references
  const successRefs = results.filter((r) => r.status === "ok").map((r) => r.reference);
  const errorRefs = results.filter((r) => r.status === "error").map((r) => `${r.reference} (${r.error})`);

  const summaryParts: string[] = [];
  if (success > 0) summaryParts.push(`${success} produit(s) créé(s) : ${successRefs.join(", ")}`);
  if (errors > 0) summaryParts.push(`${errors} produit(s) en échec : ${errorRefs.join(", ")}`);
  const summary = summaryParts.join(" — ");

  const finalStatus = errors === items.length ? "FAILED" : "COMPLETED";
  await prisma.importJob.update({
    where: { id: jobId },
    data: {
      status: finalStatus,
      resultDetails: { items, results, summary, successRefs, errorRefs },
      errorMessage: errors > 0 ? summary : null,
    },
  });

  emitProgress(jobId, items.length, items.length, success, errors, finalStatus);
  logger.info("[PFS Import Processor] Job completed", { jobId, success, errors, summary });
}

function emitProgress(
  jobId: string,
  processed: number,
  total: number,
  success: number,
  errors: number,
  status: "PROCESSING" | "COMPLETED" | "FAILED",
) {
  emitProductEvent({
    type: "IMPORT_PROGRESS",
    productId: jobId,
    importProgress: { jobId, processed, total, success, errors, status },
  });
}
