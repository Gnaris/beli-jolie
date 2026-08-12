/**
 * lib/ankorstore-persist.ts
 *
 * Helper pour persister une ligne `AnkorstoreOperation` de manière idempotente.
 *
 * Contexte : Ankorstore déduplique parfois les requêtes POST /catalog/integrations/operations
 * envoyées quasi-simultanément et renvoie le MÊME operationId, même quand notre body inclut
 * un nonce unique dans callbackUrl. Résultat : deux kickoffs concurrents pour le même produit
 * essaient d'insérer la même row en base → le second échoue avec `P2002` (Unique constraint
 * failed on PRIMARY).
 *
 * On distingue 2 cas au retour :
 *   - `{ inserted: true }` : la row a bien été créée, ce kickoff est le
 *     propriétaire de l'opId.
 *   - `{ inserted: false, existingProductId }` : la row existait déjà. Si
 *     `existingProductId === productId`, c'est un double-kickoff sur le même
 *     produit (bénin — le webhook finalisera correctement). Sinon, l'opId est
 *     PARTAGÉ avec un autre produit — le caller DOIT refuser de rattacher son
 *     job local à cet opId sous peine de créer un job orphelin (le webhook ne
 *     finalisera que le propriétaire).
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

export type PersistAnkorstoreOperationResult =
  | { inserted: true }
  | {
      inserted: false;
      /** productId déjà persisté sur cet opId (peut être identique à args.productId → bénin). */
      existingProductId: string;
      /** true si le conflit est le même produit (double kickoff bénin), false si opId partagé (dangereux). */
      sameProduct: boolean;
    };

/**
 * Crée une row AnkorstoreOperation en PENDING. En cas de P2002, relit la row
 * existante pour distinguer double-kickoff bénin (même productId) d'opId
 * partagé (productId différent).
 */
export async function persistAnkorstoreOperation(
  args: PersistAnkorstoreOperationArgs,
): Promise<PersistAnkorstoreOperationResult> {
  const { id, productId, type, payload, context } = args;
  try {
    await prisma.ankorstoreOperation.create({
      data: { id, productId, type, status: "PENDING", payload },
    });
    return { inserted: true };
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const existing = await prisma.ankorstoreOperation.findUnique({
        where: { id },
        select: { productId: true },
      });
      const existingProductId = existing?.productId ?? "";
      const sameProduct = existingProductId === productId;
      if (sameProduct) {
        logger.warn(
          `[${context}] Opération déjà persistée (double kickoff même produit)`,
          { operationId: id, productId, type },
        );
      } else {
        logger.error(
          `[${context}] OpId Ankorstore PARTAGÉ avec un autre produit — refuser d'associer ce job`,
          { operationId: id, requestedProductId: productId, existingProductId, type },
        );
      }
      return { inserted: false, existingProductId, sameProduct };
    }
    throw err;
  }
}
