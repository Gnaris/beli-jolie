/**
 * lib/ankorstore-persist.ts
 *
 * Helper pour persister une ligne `AnkorstoreOperation` de manière idempotente.
 *
 * Contexte : Ankorstore déduplique parfois les requêtes POST /catalog/integrations/operations
 * envoyées quasi-simultanément et renvoie le MÊME operationId, même quand notre body inclut
 * un nonce unique dans callbackUrl. Résultat : deux kickoffs concurrents pour le même produit
 * essaient d'insérer la même row en base → le second échoue avec `P2002` (Unique constraint
 * failed on PRIMARY). Comme la row a bien été créée par le premier appel et que le webhook
 * la finalisera, cette collision est bénigne — on la loggue en warning et on continue.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { AnkorstoreOpType } from "@prisma/client";

export interface PersistAnkorstoreOperationArgs {
  id: string;
  productId: string;
  type: AnkorstoreOpType;
  payload: Prisma.InputJsonValue;
  context: string; // ex. "Ankorstore Update" pour le log
}

/**
 * Crée une row AnkorstoreOperation en PENDING. Si l'id existe déjà (P2002 —
 * kickoff concurrent), on loggue un warning et on ne fait rien (idempotent).
 */
export async function persistAnkorstoreOperation(
  args: PersistAnkorstoreOperationArgs,
): Promise<void> {
  const { id, productId, type, payload, context } = args;
  try {
    await prisma.ankorstoreOperation.create({
      data: { id, productId, type, status: "PENDING", payload },
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      logger.warn(`[${context}] Opération déjà persistée (kickoff concurrent)`, {
        operationId: id,
        productId,
        type,
      });
      return;
    }
    throw err;
  }
}
