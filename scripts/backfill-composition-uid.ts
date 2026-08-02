/**
 * Backfill Composition.pfsCompositionUid (Salesforce Uid PFS).
 *
 * Nouveau champ ajouté 2026-08-02 pour matcher les compositions PFS par
 * identifiant stable Salesforce plutôt que par Code texte — immunise l'audit
 * PFS aux fautes d'orthographe / renommages PFS (cf. incident Elastane vs
 * Élasthanne vs P.U. vs PU).
 *
 * Match : on interroge pfsGetCompositions() (endpoint wholesaler qui expose
 * TOUTES les compositions du dictionnaire PFS avec id=Uid, reference=Code,
 * labels), puis on lookup local par pfsCompositionRef, puis par name (FR
 * ou libellé PFS). Match trouvé → on pose l'Uid PFS.
 *
 * Idempotent : ne touche pas les Composition qui ont déjà un pfsCompositionUid.
 *
 * Usage :
 *   npx tsx scripts/backfill-composition-uid.ts            # dry-run
 *   npx tsx scripts/backfill-composition-uid.ts --apply    # écrit en BDD
 *   npx tsx scripts/backfill-composition-uid.ts --tenant=issyma --apply
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { tenantALS } from "@/lib/tenant-als";
import { pfsGetCompositions, type PfsAttributeComposition } from "@/lib/pfs-api-write";

const APPLY = process.argv.includes("--apply");
const TENANT_ARG = process.argv.find((a) => a.startsWith("--tenant="))?.split("=")[1];

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[.\s_-]+/g, "")
    .toLowerCase();
}

/**
 * Table multi-clés normalisée → Uid PFS. Chaque compo PFS y apparaît sous
 * son reference (Code), son labels.fr, labels.en, labels.de/es/it — comme
 * ça un local "Élasthanne" ou "Elastane" ou "ELASTHANNE" retombe toujours
 * sur le même Uid.
 */
function buildLookupToUid(pfsList: PfsAttributeComposition[]): Map<string, string> {
  const map = new Map<string, string>();
  const setIfEmpty = (k: string, uid: string) => {
    if (!map.has(k)) map.set(k, uid);
  };
  // Priorité 1 : reference (Code canonique).
  for (const c of pfsList) if (c.reference) setIfEmpty(normalize(c.reference), c.id);
  // Priorité 2 : labels FR + EN.
  for (const c of pfsList) {
    for (const k of ["fr", "en", "de", "es", "it"] as const) {
      const lbl = c.labels?.[k]?.trim();
      if (lbl) setIfEmpty(normalize(lbl), c.id);
    }
  }
  return map;
}

async function processTenant(tenantId: string, tenantSlug: string): Promise<void> {
  console.log(`\n━━━ Tenant ${tenantSlug} (${tenantId}) ━━━`);

  await tenantALS.run(tenantId, async () => {
    let pfsList: PfsAttributeComposition[];
    try {
      pfsList = await pfsGetCompositions();
    } catch (err) {
      console.log(`  ⚠️  pfsGetCompositions échoué → skip (${err instanceof Error ? err.message : String(err)})`);
      return;
    }
    console.log(`  📖 PFS retourne ${pfsList.length} compositions au dictionnaire.`);
    const lookup = buildLookupToUid(pfsList);

    const compos = await prisma.composition.findMany({
      where: { tenantId, pfsCompositionUid: null },
      select: { id: true, name: true, pfsCompositionRef: true },
      orderBy: { name: "asc" },
    });
    if (compos.length === 0) {
      console.log("  ✓ Aucune composition à backfiller (toutes déjà avec Uid).");
      return;
    }
    console.log(`  🔎 ${compos.length} compositions sans Uid.`);

    let updated = 0;
    let skippedConflict = 0;
    let noMatch = 0;

    for (const c of compos) {
      // Essai par pfsCompositionRef d'abord (Code officiel), puis par name (FR).
      const candidates = [c.pfsCompositionRef, c.name].filter(Boolean) as string[];
      let foundUid: string | null = null;
      let matchedOn: string | null = null;
      for (const cand of candidates) {
        const uid = lookup.get(normalize(cand));
        if (uid) {
          foundUid = uid;
          matchedOn = cand;
          break;
        }
      }
      if (!foundUid) {
        noMatch++;
        console.log(`  ❓ « ${c.name} » (ref: ${c.pfsCompositionRef ?? "null"}) — aucun match PFS`);
        continue;
      }

      // Anti-collision : contrainte unique (tenantId, pfsCompositionUid).
      const collision = await prisma.composition.findFirst({
        where: { tenantId, pfsCompositionUid: foundUid, NOT: { id: c.id } },
        select: { id: true, name: true },
      });
      if (collision) {
        skippedConflict++;
        console.log(
          `  ⚠️  « ${c.name} » → Uid ${foundUid} IMPOSSIBLE : déjà porté par « ${collision.name} » (${collision.id}). À fusionner d'abord.`,
        );
        continue;
      }

      if (APPLY) {
        await prisma.composition.update({
          where: { id: c.id },
          data: { pfsCompositionUid: foundUid },
        });
      }
      updated++;
      console.log(`  ${APPLY ? "✅" : "📝"} « ${c.name} » → Uid ${foundUid} (matché sur « ${matchedOn} »)`);
    }

    console.log(`  ➜ ${updated} ${APPLY ? "backfillée(s)" : "à backfiller"}, ${skippedConflict} conflit(s), ${noMatch} sans match.`);
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

if (process.argv[1]?.endsWith("backfill-composition-uid.ts")) {
  main().catch(async (e) => {
    console.error("💥", e);
    await prisma.$disconnect();
    process.exit(1);
  });
}
