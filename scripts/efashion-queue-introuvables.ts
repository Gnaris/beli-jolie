/**
 * Cas A : produits BJ introuvables chez eFashion → ajout à la file
 * d'attente shooting (`EfashionShootingBatchItem` mode PUBLISH), pour que
 * la cliente valide ensuite manuellement le shooting dans l'admin.
 *
 * Logique :
 *  1. Liste les produits non-liés (efashionReferenceBase NULL, status non ARCHIVED).
 *  2. Pour chacun, vérifie qu'eFashion ne le connaît pas :
 *     - 0 candidat avec reference_base = full ref
 *     - 0 candidat avec reference_base = partie avant premier tiret
 *  3. Pour les introuvables, lance `validateEfashionPublishable` pour vérifier
 *     qu'ils ont tous les attributs/mappings requis.
 *  4. Mode --apply : insert dans `EfashionShootingBatchItem` (mode PUBLISH),
 *     idempotent via le @@unique sur productId.
 *
 * Usage :
 *   npx tsx scripts/efashion-queue-introuvables.ts             # SIMULATION
 *   npx tsx scripts/efashion-queue-introuvables.ts --apply     # ajoute à la file
 */

import { prisma } from "@/lib/prisma";
import { efashionGetMe, efashionListByReferenceBaseExact } from "@/lib/efashion-api";
import { validateEfashionPublishable } from "@/lib/efashion-validate";

const APPLY = process.argv.includes("--apply");
const PAUSE_MS = 200;

interface Row {
  id: string;
  ref: string;
  status: "PUBLISHABLE" | "MISSING_ATTRS" | "NO_UNIT" | "FOUND_AT_EFASHION" | "ERROR";
  missing?: string[];
  error?: string;
}

async function main() {
  console.log(APPLY ? "🛠️  MODE APPLY — insertion dans la file shooting.\n" : "🧪 MODE SIMULATION.\n");
  const vendor = await efashionGetMe();
  console.log(`🔌 ${vendor.nomBoutique}\n`);

  const products = await prisma.product.findMany({
    where: { efashionReferenceBase: null, status: { not: "ARCHIVED" } },
    select: { id: true, reference: true },
    orderBy: { reference: "asc" },
  });
  console.log(`📦 ${products.length} produit(s) non-liés à examiner.\n`);

  const rows: Row[] = [];

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    process.stdout.write(`[${i + 1}/${products.length}] ${p.reference} … `);

    // 1) Cherche-t-on chez eFashion ?
    let foundFull = false;
    let foundPartial = false;
    try {
      const full = await efashionListByReferenceBaseExact({
        idVendeur: vendor.id_vendeur,
        referenceBase: p.reference,
        premelFilter: "tous",
      });
      foundFull = full.length > 0;
      if (!foundFull) {
        const partial = (p.reference.split(/[-_]/)[0] ?? p.reference).trim();
        if (partial !== p.reference) {
          const pcs = await efashionListByReferenceBaseExact({
            idVendeur: vendor.id_vendeur,
            referenceBase: partial,
            premelFilter: "tous",
          });
          foundPartial = pcs.length > 0;
        }
      }
    } catch (err) {
      const e = err instanceof Error ? err.message : String(err);
      console.log(`❌ erreur recherche : ${e}`);
      rows.push({ id: p.id, ref: p.reference, status: "ERROR", error: e });
      if (i < products.length - 1) await new Promise((r) => setTimeout(r, PAUSE_MS));
      continue;
    }

    if (foundFull || foundPartial) {
      console.log(`⏭️  déjà chez eFashion (full=${foundFull}, partial=${foundPartial})`);
      rows.push({ id: p.id, ref: p.reference, status: "FOUND_AT_EFASHION" });
      if (i < products.length - 1) await new Promise((r) => setTimeout(r, PAUSE_MS));
      continue;
    }

    // 2) Publishable ?
    const v = await validateEfashionPublishable(p.id);
    if (v.noEligibleVariants) {
      console.log("⏭️  100% paquet, ignoré");
      rows.push({ id: p.id, ref: p.reference, status: "NO_UNIT" });
    } else if (!v.ok) {
      console.log(`⛔ manque : ${v.missing[0]}`);
      rows.push({ id: p.id, ref: p.reference, status: "MISSING_ATTRS", missing: v.missing });
    } else {
      if (APPLY) {
        await prisma.efashionShootingBatchItem.upsert({
          where: { productId: p.id },
          create: { productId: p.id, mode: "PUBLISH" },
          update: { mode: "PUBLISH", addedAt: new Date() },
        });
        console.log("✅ ajouté à la file shooting");
      } else {
        console.log("✅ prêt à publier");
      }
      rows.push({ id: p.id, ref: p.reference, status: "PUBLISHABLE" });
    }
    if (i < products.length - 1) await new Promise((r) => setTimeout(r, PAUSE_MS));
  }

  const pub = rows.filter((r) => r.status === "PUBLISHABLE");
  const found = rows.filter((r) => r.status === "FOUND_AT_EFASHION");
  const miss = rows.filter((r) => r.status === "MISSING_ATTRS");
  const noUnit = rows.filter((r) => r.status === "NO_UNIT");
  const err = rows.filter((r) => r.status === "ERROR");

  console.log("\n═════════════════════════════════════");
  console.log("  RÉCAP CAS A");
  console.log("═════════════════════════════════════");
  console.log(`  ✅ Prêts à publier (ajoutables) : ${pub.length}`);
  console.log(`  ⏭️  Déjà chez eFashion           : ${found.length}`);
  console.log(`  ⏭️  100% paquet (ignorés)        : ${noUnit.length}`);
  console.log(`  ⛔ Attributs/images manquants    : ${miss.length}`);
  console.log(`  ❌ Erreurs                       : ${err.length}`);
  console.log("═════════════════════════════════════\n");

  if (miss.length > 0) {
    console.log("⛔ Manques (échantillon) :");
    // Compter les types de manques
    const counts = new Map<string, number>();
    for (const r of miss) {
      for (const m of r.missing ?? []) {
        const key = m.split(" «")[0]; // « catégorie », « pays », etc.
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    for (const [k, v] of sorted.slice(0, 10)) console.log(`  • ${k} ×${v}`);
    console.log("");
    console.log("  Détail (20 premiers) :");
    for (const r of miss.slice(0, 20)) {
      console.log(`    • ${r.ref} — ${r.missing?.[0]}`);
    }
    if (miss.length > 20) console.log(`    … et ${miss.length - 20} de plus`);
    console.log("");
  }

  if (APPLY && pub.length > 0) {
    const total = await prisma.efashionShootingBatchItem.count();
    console.log(`📋 File shooting contient maintenant : ${total} produit(s) au total.`);
    console.log(`👉 Clique « Valider le shooting » dans l'admin pour tout envoyer chez eFashion.`);
  } else if (!APPLY) {
    console.log("👉 Pour appliquer : npx tsx scripts/efashion-queue-introuvables.ts --apply");
  }
}

main()
  .catch((err) => {
    console.error("\n❌ Erreur fatale :", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
