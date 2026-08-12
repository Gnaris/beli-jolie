/**
 * scripts/repair-stuck-ankor-refresh-jobs.ts
 *
 * Répare les MarketplaceRefreshJob Ankorstore restés en AWAITING_CALLBACK à
 * cause du bug d'opId partagé (Ankor déduplique POST /operations quand une
 * op précédente est encore en `pending`).
 *
 * Contexte incident 2026-08-12 : le rafraîchissement d'un lot de 12 produits
 * a laissé 7 jobs bloqués parce que Ankor a fusionné plusieurs kickoffs sous
 * le même opId. Les produits sont bien créés côté Ankor (vérifié via
 * /operations/{opId}/results) mais notre BDD n'en sait rien.
 *
 * Ce script :
 *   1. Liste tous les jobs AWAITING_CALLBACK Ankor plus vieux que 10 min
 *   2. Pour chacun : query Ankor /operations/{opId}/results pour trouver le
 *      externalId du produit dans les résultats
 *   3. Si trouvé + status=success : lookup ankorsProductId par SKU, MàJ
 *      Product + ProductColor + finalize job SUCCEEDED
 *   4. Sinon : marque job FAILED, unlink product, laisse la cliente relancer
 *
 * Usage (sur VPS) :
 *   set -a && source .env && set +a
 *   MULTI_TENANT_SCOPE=off npx tsx scripts/repair-stuck-ankor-refresh-jobs.ts
 *
 * Flag --dry pour simuler sans écrire.
 */

import { PrismaClient, Prisma } from "@prisma/client";
import { tenantALS } from "@/lib/tenant-als";
import {
  ankorstoreFetchOperationResults,
  ankorstoreLookupProductIdBySku,
} from "@/lib/ankorstore-api-write";
import { ankorstoreGetVariants } from "@/lib/ankorstore-api";
import type {
  AnkorstoreBatchRefreshDeleteOldPayload,
  AnkorstoreBatchRefreshMember,
} from "@/lib/ankorstore-refresh-batch";
import type { AnkorstorePublishPayload } from "@/lib/ankorstore-publish";

const DRY = process.argv.includes("--dry");
const STUCK_MIN_AGE_MIN = 10;

// prisma non-scopé : on veut voir tous les tenants (le script agit ensuite
// dans le contexte tenant de chaque produit).
const rawPrisma = new PrismaClient();

interface StuckJob {
  jobId: string;
  productId: string;
  tenantId: string;
  ankorsOperationId: string;
  reference: string;
  currentAnkorsProductId: string | null;
}

async function main() {
  console.log(`\n${DRY ? "DRY RUN — " : ""}Récupération jobs Ankor stuck…\n`);

  const cutoff = new Date(Date.now() - STUCK_MIN_AGE_MIN * 60 * 1000);
  const stuck = await rawPrisma.marketplaceRefreshJob.findMany({
    where: {
      status: "AWAITING_CALLBACK",
      marketplace: "ANKORSTORE",
      createdAt: { lt: cutoff },
      ankorsOperationId: { not: null },
    },
    orderBy: { createdAt: "asc" },
  });

  if (stuck.length === 0) {
    console.log("Aucun job stuck.");
    await rawPrisma.$disconnect();
    return;
  }

  console.log(`${stuck.length} jobs stuck détectés.\n`);

  // Regroupe par tenant pour opérer chaque groupe sous ALS approprié.
  const byTenant = new Map<string, typeof stuck>();
  for (const j of stuck) {
    if (!j.tenantId) continue;
    const arr = byTenant.get(j.tenantId) ?? [];
    arr.push(j);
    byTenant.set(j.tenantId, arr);
  }

  let repaired = 0;
  let failed = 0;
  let untouched = 0;

  for (const [tenantId, jobs] of byTenant) {
    console.log(`── tenant ${tenantId} (${jobs.length} jobs) ──`);

    await tenantALS.run(tenantId, async () => {
      // Enrichissement : produit + reference
      const products = await rawPrisma.product.findMany({
        where: { id: { in: jobs.map((j) => j.productId) } },
        select: { id: true, reference: true, ankorsProductId: true },
      });
      const productById = new Map(products.map((p) => [p.id, p]));

      const enriched: StuckJob[] = jobs.map((j) => {
        const p = productById.get(j.productId);
        return {
          jobId: j.id,
          productId: j.productId,
          tenantId,
          ankorsOperationId: j.ankorsOperationId!,
          reference: p?.reference ?? "?",
          currentAnkorsProductId: p?.ankorsProductId ?? null,
        };
      });

      // Construit un index productId → memberPayload à partir de TOUS les
      // batch DELETE_OLD ops récents. C'est la seule source fiable du
      // publish payload pour un produit donné : l'op partagée (CREATE_NEW)
      // ne contient que le payload du PREMIER produit persisté et
      // l'utiliser corromprait les 3 autres membres du groupe.
      const memberByProductId = await buildMemberIndex(rawPrisma);

      // Groupe par opId partagé (juste pour l'affichage + le fetch results
      // en une fois)
      const byOpId = new Map<string, StuckJob[]>();
      for (const j of enriched) {
        const arr = byOpId.get(j.ankorsOperationId) ?? [];
        arr.push(j);
        byOpId.set(j.ankorsOperationId, arr);
      }

      for (const [opId, group] of byOpId) {
        console.log(`\n  opId ${opId} (${group.length} jobs)`);

        // Fetch Ankor results
        let results: Awaited<ReturnType<typeof ankorstoreFetchOperationResults>>;
        try {
          results = await ankorstoreFetchOperationResults(opId);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.log(`  ✗ Fetch results échoué (${msg}) — skip groupe`);
          untouched += group.length;
          continue;
        }

        const resultByExternalId = new Map(
          results.map((r) => [r.externalProductId, r]),
        );
        console.log(
          `    Ankor a ${results.length} résultats: ${results
            .map((r) => `${r.externalProductId}=${r.status}`)
            .join(", ")}`,
        );

        // Charge la row AnkorstoreOperation pour connaître son type
        const op = await rawPrisma.ankorstoreOperation.findUnique({
          where: { id: opId },
        });
        if (!op) {
          console.log(`  ✗ AnkorstoreOperation ${opId} introuvable — skip groupe`);
          untouched += group.length;
          continue;
        }

        // Résout par job
        for (const job of group) {
          const result = resultByExternalId.get(job.reference);
          // IMPORTANT : payload PROPRE à ce produit, pas celui de l'op
          // partagée qui appartient à un autre membre.
          const memberPayload = memberByProductId.get(job.productId) ?? null;

          if (!result) {
            console.log(
              `    ${job.reference} : absent des résultats Ankor — fail explicite`,
            );
            await failJob(
              job,
              `Ankorstore a fusionné cette demande avec une autre — le produit n'a pas été traité. Cliquez « Rafraîchir » pour relancer.`,
            );
            failed++;
            continue;
          }

          if (result.status !== "success") {
            const reason = result.failureReason ?? "Suppression Ankorstore refusée";
            console.log(`    ${job.reference} : status=${result.status} — fail`);
            await failJob(job, `Ankorstore a refusé : ${reason}`);
            failed++;
            continue;
          }

          // Success. Type d'op ?
          if (op.type === "REFRESH_DELETE_OLD" && !memberPayload) {
            // Cas A1948 : delete op réutilisé, notre delete n'est jamais parti,
            // Phase 2 non déclenchée. Le produit est intouché côté Ankor.
            console.log(
              `    ${job.reference} : delete op réutilisé, aucun refresh effectif — fail`,
            );
            await failJob(
              job,
              `Ankorstore a fusionné cette demande — le produit n'a pas été rafraîchi. Cliquez « Rafraîchir » pour relancer.`,
            );
            failed++;
            continue;
          }

          if (!memberPayload) {
            console.log(
              `    ${job.reference} : payload publish introuvable dans les batch DELETE_OLD récents — fail`,
            );
            await failJob(
              job,
              `Impossible de retrouver les infos de synchronisation — cliquez « Publier » pour reconstituer la fiche.`,
            );
            failed++;
            continue;
          }

          // Repair : lookup ankorsProductId + variants, MàJ BDD
          try {
            console.log(
              `    ${job.reference} : repair — lookup SKU ${memberPayload.firstSku}…`,
            );
            const newAnkorsProductId = await ankorstoreLookupProductIdBySku(
              memberPayload.firstSku,
              { maxAttempts: 4, initialDelayMs: 1000, pollDelayMs: 2000 },
            );
            if (!newAnkorsProductId) {
              console.log(
                `    ${job.reference} : SKU introuvable chez Ankor — fail`,
              );
              await failJob(
                job,
                `Produit introuvable chez Ankorstore via SKU ${memberPayload.firstSku}. Cliquez « Publier » pour recréer.`,
              );
              failed++;
              continue;
            }

            const variants = await ankorstoreGetVariants(newAnkorsProductId);
            const variantBySku = new Map(
              variants
                .filter((v) => v.sku != null)
                .map((v) => [v.sku as string, v.id]),
            );

            const variantIdUpdates: {
              localVariantId: string;
              ankorsVariantId: string;
            }[] = [];
            for (const [sku, bjVariantId] of Object.entries(
              memberPayload.skuToBjVariantId,
            )) {
              const ankorsVariantId = variantBySku.get(sku);
              if (ankorsVariantId) {
                variantIdUpdates.push({ localVariantId: bjVariantId, ankorsVariantId });
              }
            }

            console.log(
              `    ${job.reference} : nouveau ankorsProductId=${newAnkorsProductId}, ${variantIdUpdates.length} variantes mappées`,
            );

            if (!DRY) {
              await rawPrisma.$transaction([
                rawPrisma.product.update({
                  where: { id: job.productId },
                  data: {
                    ankorsProductId: newAnkorsProductId,
                    ankorsLastSyncSnapshot: Prisma.DbNull,
                    ankorsSyncRequired: false,
                    lastRefreshedAt: new Date(),
                  },
                }),
                ...variantIdUpdates.map((u) =>
                  rawPrisma.productColor.update({
                    where: { id: u.localVariantId },
                    data: { ankorsVariantId: u.ankorsVariantId },
                  }),
                ),
                rawPrisma.marketplaceRefreshJob.update({
                  where: { id: job.jobId },
                  data: {
                    status: "SUCCEEDED",
                    ankorsOutcome: {
                      ok: true,
                      archived: false,
                      warning:
                        "Récupéré manuellement — Ankorstore avait fusionné plusieurs demandes.",
                    } as unknown as Prisma.InputJsonValue,
                    completedAt: new Date(),
                  },
                }),
              ]);
            }
            console.log(`    ${job.reference} : ✓ repair OK`);
            repaired++;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.log(`    ${job.reference} : ✗ repair échoué (${msg})`);
            await failJob(
              job,
              `Récupération automatique échouée : ${msg}. Cliquez « Publier » pour recréer la fiche.`,
            );
            failed++;
          }
        }
      }
    });
  }

  console.log(
    `\n${DRY ? "DRY RUN — " : ""}Résultat : ${repaired} récupérés, ${failed} marqués en échec, ${untouched} intouchés.`,
  );
  await rawPrisma.$disconnect();
}

/**
 * Scanne les REFRESH_DELETE_OLD batch récents (24h) et construit un index
 * productId → nextPublishPayload. C'est la seule source fiable des données
 * de synchronisation d'un produit donné : quand Ankor a fusionné plusieurs
 * kickoffs sous le même opId CREATE_NEW, la row AnkorstoreOperation ne
 * contient que le payload du PREMIER produit persisté — les autres membres
 * ont perdu leur payload.
 */
async function buildMemberIndex(
  prisma: PrismaClient,
): Promise<Map<string, AnkorstorePublishPayload>> {
  const index = new Map<string, AnkorstorePublishPayload>();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const ops = await prisma.ankorstoreOperation.findMany({
    where: {
      type: "REFRESH_DELETE_OLD",
      createdAt: { gt: since },
    },
    select: { id: true, payload: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  for (const op of ops) {
    const payload = op.payload as unknown;
    if (typeof payload !== "object" || payload === null) continue;
    const p = payload as Record<string, unknown>;
    if (p.batch !== true || !Array.isArray(p.members)) continue;

    const members = p.members as AnkorstoreBatchRefreshMember[];
    for (const m of members) {
      if (!m.productId || !m.nextPublishPayload) continue;
      // Le premier batch (le plus récent — ordre desc) gagne, mais on ne
      // réécrit pas si déjà présent (privilégie la donnée la plus fraîche).
      if (!index.has(m.productId)) {
        index.set(m.productId, m.nextPublishPayload);
      }
    }
  }

  console.log(
    `  Index member payload construit depuis ${ops.length} batch ops (${index.size} produits)`,
  );
  return index;
}

async function failJob(job: StuckJob, message: string) {
  if (DRY) return;
  await rawPrisma.marketplaceRefreshJob.update({
    where: { id: job.jobId },
    data: {
      status: "FAILED",
      ankorsOutcome: {
        ok: false,
        kind: "error",
        message,
      } as unknown as Prisma.InputJsonValue,
      errorMessage: message,
      completedAt: new Date(),
    },
  });
}

main().catch((err) => {
  console.error("Erreur fatale :", err);
  process.exit(1);
});
