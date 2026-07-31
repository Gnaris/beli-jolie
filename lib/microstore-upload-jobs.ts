/**
 * Helpers de suivi des envois de photos vers Microstore.
 *
 * L'upload de photos vers Microstore (Station de Transfert) est un flux long
 * et synchrone : par produit, on lit N photos locales, on les uploade sur le
 * CDN OSS Microstore, puis on fait un PATCH `/api/goods/{id}`. Sans un
 * enregistrement en base, la cliente n'a aucun feedback pendant que ça
 * tourne. Ces helpers créent / mettent à jour des `MicrostoreUploadJob` que
 * le widget flottant « Microstore » affiche en X/N.
 *
 * Les jobs ne sont PAS traités par un worker : ce sont les server actions
 * `sendProductPhotosToMicrostore` / `bulkSendPhotosToMicrostore` qui font le
 * travail et actualisent les compteurs au fil de l'upload.
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { MicrostoreUploadJobStatus, Prisma } from "@prisma/client";

/** Fenêtre pendant laquelle un job terminé reste affiché dans le widget. */
export const RECENT_DONE_WINDOW_MS = 8 * 60_000;

export interface CreateUploadJobInput {
  productId: string | null;
  reference: string;
  productName?: string | null;
}

/** Crée un job PENDING et retourne son id — pas d'exception, log si échec. */
export async function createMicrostoreUploadJob(
  input: CreateUploadJobInput,
): Promise<string | null> {
  try {
    const created = await prisma.microstoreUploadJob.create({
      data: {
        productId: input.productId,
        reference: input.reference,
        productName: input.productName ?? null,
        status: "PENDING",
      },
      select: { id: true },
    });
    return created.id;
  } catch (err) {
    logger.warn("[MicrostoreUploadJob] create failed", {
      error: err,
      reference: input.reference,
    });
    return null;
  }
}

/** Met à jour un job existant — no-op si `id` est null. */
export async function updateMicrostoreUploadJob(
  id: string | null,
  data: Prisma.MicrostoreUploadJobUpdateInput,
): Promise<void> {
  if (!id) return;
  try {
    await prisma.microstoreUploadJob.update({ where: { id }, data });
  } catch (err) {
    logger.warn("[MicrostoreUploadJob] update failed", { error: err, id });
  }
}

/**
 * Passe le job en UPLOADING avec le total prévu, et pose `startedAt`.
 * `startedAt` peut déjà être posé par un précédent appel — c'est idempotent
 * côté SQL, on ne l'écrase que si null.
 */
export async function markMicrostoreUploadJobStarted(
  id: string | null,
  totalImages: number,
): Promise<void> {
  await updateMicrostoreUploadJob(id, {
    status: "UPLOADING",
    totalImages,
    startedAt: new Date(),
  });
}

/** Incrémente `uploadedImages` ou `failedImages` de façon atomique. */
export async function bumpMicrostoreUploadJobCounters(
  id: string | null,
  bump: { uploaded?: number; failed?: number },
): Promise<void> {
  if (!id) return;
  const uploaded = bump.uploaded ?? 0;
  const failed = bump.failed ?? 0;
  if (uploaded === 0 && failed === 0) return;
  try {
    await prisma.microstoreUploadJob.update({
      where: { id },
      data: {
        uploadedImages: uploaded > 0 ? { increment: uploaded } : undefined,
        failedImages: failed > 0 ? { increment: failed } : undefined,
      },
    });
  } catch (err) {
    logger.warn("[MicrostoreUploadJob] bump failed", { error: err, id });
  }
}

export async function markMicrostoreUploadJobStatus(
  id: string | null,
  status: MicrostoreUploadJobStatus,
  extra?: { errorMessage?: string | null; completed?: boolean },
): Promise<void> {
  const data: Prisma.MicrostoreUploadJobUpdateInput = { status };
  if (extra?.errorMessage !== undefined) {
    // On tronque pour éviter d'exploser TEXT MySQL avec des stacks XXL.
    data.errorMessage = extra.errorMessage
      ? extra.errorMessage.slice(0, 4000)
      : null;
  }
  if (extra?.completed) {
    data.completedAt = new Date();
  }
  await updateMicrostoreUploadJob(id, data);
}
