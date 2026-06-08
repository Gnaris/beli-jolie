/**
 * Diagnostic : pour chaque produit BJ non-lié dont les couleurs ne matchent
 * pas avec eFashion, affiche le couple (couleur BJ ↔ couleurs eFashion
 * disponibles). Aucune écriture.
 *
 * Usage : npx tsx scripts/efashion-diag-color-mismatch.ts
 *
 * Sortie : tableau « couleur BJ → couleur(s) eFashion » triée par
 * fréquence, pour repérer les synonymes courants (Brun ↔ Marron, etc.).
 */

import { prisma } from "@/lib/prisma";
import { efashionGetMe, efashionListByReferenceBaseExact } from "@/lib/efashion-api";
import { normalizeEfashionColorName } from "@/lib/efashion-link-match";

const PAUSE_MS = 150;

interface MismatchRow {
  ref: string;
  bjColors: string[];
  efColors: string[];
}

async function main() {
  const vendor = await efashionGetMe();
  console.log(`🔌 ${vendor.nomBoutique} (id_vendeur=${vendor.id_vendeur})`);

  const products = await prisma.product.findMany({
    where: { efashionReferenceBase: null, status: { not: "ARCHIVED" } },
    select: {
      id: true,
      reference: true,
      colors: {
        select: {
          saleType: true,
          color: { select: { id: true, name: true, efashionColorId: true } },
        },
      },
    },
    orderBy: { reference: "asc" },
  });

  const mismatches: MismatchRow[] = [];

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    const bjColorNames = new Set<string>();
    let allMapped = true;
    for (const pc of p.colors) {
      if (pc.saleType !== "UNIT" || !pc.color) continue;
      bjColorNames.add(pc.color.name);
      if (!pc.color.efashionColorId) allMapped = false;
    }
    if (bjColorNames.size === 0) continue;
    if (!allMapped) continue; // mapping couleur côté BJ pas fini → autre cas

    // tente d'abord full ref
    let cands = await efashionListByReferenceBaseExact({
      idVendeur: vendor.id_vendeur,
      referenceBase: p.reference,
      premelFilter: "tous",
    });
    if (cands.length === 0) {
      const partial = (p.reference.split(/[-_]/)[0] ?? p.reference).trim();
      if (partial !== p.reference) {
        cands = await efashionListByReferenceBaseExact({
          idVendeur: vendor.id_vendeur,
          referenceBase: partial,
          premelFilter: "tous",
        });
      }
    }
    if (cands.length === 0) continue; // introuvable, autre cas

    const efColors = Array.from(
      new Set(cands.map((c) => c.couleur).filter((c): c is string => !!c && c.trim() !== "")),
    );
    const bjArr = Array.from(bjColorNames);
    const bjNorm = new Set(bjArr.map(normalizeEfashionColorName));
    const efNorm = new Set(efColors.map(normalizeEfashionColorName));
    const bjUnmatched = bjArr.filter((c) => !efNorm.has(normalizeEfashionColorName(c)));
    const efUnmatched = efColors.filter((c) => !bjNorm.has(normalizeEfashionColorName(c)));

    if (bjUnmatched.length === 0 && efUnmatched.length === 0) continue;

    mismatches.push({
      ref: p.reference,
      bjColors: bjUnmatched,
      efColors: efUnmatched,
    });
    if ((i + 1) % 50 === 0) process.stdout.write(`  …${i + 1}/${products.length}\n`);
    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }

  console.log(`\n📦 ${mismatches.length} produits avec couleurs non-matchées\n`);

  // Agrégation : couleur BJ → fréquence + couleurs eFashion vues sur le MÊME produit
  const bjFreq = new Map<string, Map<string, number>>(); // bj → ef → count
  for (const m of mismatches) {
    for (const bj of m.bjColors) {
      let inner = bjFreq.get(bj);
      if (!inner) {
        inner = new Map();
        bjFreq.set(bj, inner);
      }
      for (const ef of m.efColors) {
        inner.set(ef, (inner.get(ef) ?? 0) + 1);
      }
    }
  }

  console.log("─── Couleurs BJ non-matchées, et couleurs eFashion vues sur les mêmes fiches ───\n");
  const sortedBj = Array.from(bjFreq.entries()).sort(
    (a, b) =>
      Array.from(b[1].values()).reduce((s, v) => s + v, 0) -
      Array.from(a[1].values()).reduce((s, v) => s + v, 0),
  );
  for (const [bj, inner] of sortedBj) {
    const total = Array.from(inner.values()).reduce((s, v) => s + v, 0);
    console.log(`• « ${bj} » (${total} fois) →`);
    const sortedEf = Array.from(inner.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6);
    for (const [ef, count] of sortedEf) {
      console.log(`    ↳ « ${ef} » ×${count}`);
    }
  }

  // Aussi le côté inverse : couleurs eFashion non-matchées
  console.log("\n─── Couleurs eFashion non-matchées (couleur BJ qui pourrait y correspondre) ───\n");
  const efFreq = new Map<string, Map<string, number>>();
  for (const m of mismatches) {
    for (const ef of m.efColors) {
      let inner = efFreq.get(ef);
      if (!inner) {
        inner = new Map();
        efFreq.set(ef, inner);
      }
      for (const bj of m.bjColors) {
        inner.set(bj, (inner.get(bj) ?? 0) + 1);
      }
    }
  }
  const sortedEf2 = Array.from(efFreq.entries()).sort(
    (a, b) =>
      Array.from(b[1].values()).reduce((s, v) => s + v, 0) -
      Array.from(a[1].values()).reduce((s, v) => s + v, 0),
  );
  for (const [ef, inner] of sortedEf2.slice(0, 20)) {
    const total = Array.from(inner.values()).reduce((s, v) => s + v, 0);
    console.log(`• eF « ${ef} » (${total} fois) →`);
    const sortedBjInner = Array.from(inner.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
    for (const [bj, count] of sortedBjInner) {
      console.log(`    ↳ BJ « ${bj} » ×${count}`);
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
