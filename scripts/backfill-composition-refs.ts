/**
 * Backfill Composition.pfsCompositionRef.
 *
 * Bug historique (corrigé 2026-07-24 dans lib/pfs-import.ts) : à l'import
 * PFS, Composition.pfsCompositionRef recevait le libellé FR (« Coton »,
 * « Élasthanne »…) au lieu de la vraie référence PFS (« COTTON »,
 * « ELASTHANNE »…). Résultat : la vérification PFS voyait un écart de
 * composition sur presque tous les produits, et le bouton « Envoyer PFS »
 * envoyait une valeur que PFS ne reconnaissait pas → PFS ignorait
 * silencieusement, l'écart persistait → modale qui « boucle ».
 *
 * Ce script :
 *   1. Boucle sur chaque tenant actif.
 *   2. Interroge pfsGetCompositions() pour récupérer la liste officielle
 *      (id, reference, labels.fr…).
 *   3. Pour chaque Composition locale, match par nom (case + accents
 *      insensibles) contre le libellé FR PFS.
 *   4. Si le pfsCompositionRef actuel diffère de la vraie reference PFS,
 *      remplace (sauf conflit d'unicité, alors log warning et skip).
 *
 * Usage :
 *   npx tsx scripts/backfill-composition-refs.ts            # dry-run
 *   npx tsx scripts/backfill-composition-refs.ts --apply    # écrit en BDD
 *   npx tsx scripts/backfill-composition-refs.ts --tenant=beliandjolie
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { tenantALS } from "@/lib/tenant-als";
import { pfsGetCompositions, type PfsAttributeComposition } from "@/lib/pfs-api-write";

const APPLY = process.argv.includes("--apply");
const TENANT_ARG = process.argv.find((a) => a.startsWith("--tenant="))?.split("=")[1];

function normalize(label: string): string {
  return label
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Table de correspondance normalized-label → reference PFS. */
export function buildLabelToRefMap(pfsList: PfsAttributeComposition[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of pfsList) {
    // On priorise labels.fr, puis on ajoute aussi la reference elle-même
    // (utile si un pfsCompositionRef local vaut déjà la vraie ref).
    const fr = c.labels?.fr?.trim();
    if (fr) map.set(normalize(fr), c.reference);
    map.set(normalize(c.reference), c.reference);
    // En fallback les autres langues, au cas où
    for (const k of ["en", "de", "es", "it"] as const) {
      const label = c.labels?.[k]?.trim();
      if (label && !map.has(normalize(label))) {
        map.set(normalize(label), c.reference);
      }
    }
  }
  return map;
}

/** Décide de la nouvelle référence pour une composition locale. */
export function resolveNewRef(
  local: { name: string; pfsCompositionRef: string | null },
  labelToRef: Map<string, string>,
): { newRef: string | null; reason: string } {
  const candidates = [local.pfsCompositionRef, local.name].filter(Boolean) as string[];
  for (const candidate of candidates) {
    const found = labelToRef.get(normalize(candidate));
    if (found) {
      if (found === local.pfsCompositionRef) return { newRef: null, reason: "déjà à jour" };
      return { newRef: found, reason: `matché sur « ${candidate} »` };
    }
  }
  return { newRef: null, reason: "aucun match PFS (à corriger manuellement)" };
}

async function processTenant(tenantId: string, tenantSlug: string): Promise<void> {
  console.log(`\n━━━ Tenant ${tenantSlug} (${tenantId}) ━━━`);

  await tenantALS.run(tenantId, async () => {
    let pfsList: PfsAttributeComposition[];
    try {
      pfsList = await pfsGetCompositions();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ⚠️  pfsGetCompositions échoué → skip (${msg})`);
      return;
    }
    console.log(`  📖 PFS retourne ${pfsList.length} compositions.`);
    const labelToRef = buildLabelToRefMap(pfsList);

    const compos = await prisma.composition.findMany({
      where: { tenantId },
      select: { id: true, name: true, pfsCompositionRef: true },
      orderBy: { name: "asc" },
    });
    console.log(`  🔎 ${compos.length} compositions locales à examiner.`);

    let updated = 0;
    let unchanged = 0;
    let skippedConflict = 0;
    let noMatch = 0;

    for (const c of compos) {
      const { newRef, reason } = resolveNewRef(c, labelToRef);
      if (!newRef) {
        if (reason === "déjà à jour") {
          unchanged++;
        } else {
          noMatch++;
          console.log(`  ❓ « ${c.name} » (ref actuelle: ${c.pfsCompositionRef ?? "null"}) — ${reason}`);
        }
        continue;
      }

      // Conflit d'unicité (composite tenantId+pfsCompositionRef) si une
      // autre composition du même tenant porte déjà cette ref.
      const collision = await prisma.composition.findFirst({
        where: { tenantId, pfsCompositionRef: newRef, NOT: { id: c.id } },
        select: { id: true, name: true },
      });
      if (collision) {
        skippedConflict++;
        console.log(
          `  ⚠️  « ${c.name} » → « ${newRef} » IMPOSSIBLE : déjà porté par « ${collision.name} » (${collision.id}). À fusionner manuellement.`,
        );
        continue;
      }

      if (APPLY) {
        await prisma.composition.update({
          where: { id: c.id },
          data: { pfsCompositionRef: newRef },
        });
      }
      updated++;
      console.log(
        `  ${APPLY ? "✅" : "📝"} « ${c.name} » : ${c.pfsCompositionRef ?? "null"} → ${newRef} (${reason})`,
      );
    }

    console.log(
      `  ➜ ${updated} ${APPLY ? "corrigée(s)" : "à corriger"}, ${unchanged} déjà OK, ${skippedConflict} conflit(s), ${noMatch} sans match.`,
    );
  });
}

async function main() {
  console.log(APPLY ? "🚀 Mode APPLY — écrit en BDD" : "🧪 Mode DRY-RUN — aucune modification");

  const tenants = await prisma.tenant.findMany({
    where: { isActive: true, ...(TENANT_ARG ? { slug: TENANT_ARG } : {}) },
    orderBy: { slug: "asc" },
  });
  if (tenants.length === 0) {
    console.log("Aucun tenant actif" + (TENANT_ARG ? ` avec slug=${TENANT_ARG}` : ""));
    process.exit(1);
  }
  console.log(`${tenants.length} tenant(s) : ${tenants.map((t) => t.slug).join(", ")}`);

  for (const t of tenants) {
    await processTenant(t.id, t.slug);
  }

  console.log("\n✨ Terminé." + (APPLY ? "" : " Relancer avec --apply pour écrire."));
  await prisma.$disconnect();
}

// Auto-run uniquement en CLI, pas quand le fichier est importé par des tests.
if (process.argv[1]?.endsWith("backfill-composition-refs.ts")) {
  main().catch(async (e) => {
    console.error("💥", e);
    await prisma.$disconnect();
    process.exit(1);
  });
}
