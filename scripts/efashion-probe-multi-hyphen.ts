/**
 * Probe diagnostique : pour quelques références BJ multi-tirets, demande à
 * eFashion ce qu'il a comme reference_base, sans rien écrire.
 *
 * Usage : npx tsx scripts/efashion-probe-multi-hyphen.ts
 */

import { efashionGetMe, efashionListProducts } from "@/lib/efashion-api";

const SAMPLES = [
  "PR-COLLIER22",
  "PR-BAGUE77",
  "PR-CHEVILLE19",
  "C-BRACELET100",
  "BOITE-BAGUE-24-01",
  "BOITE-PARURE-01",
  "COUSSIN-BAGUE12-01",
  "COUSSIN-BAGUE8-01",
  "PORTE-CLÉ-01",
  "PRESENTOIR-BAGUE24-02",
  "PRESENTOIR-CHEVILLE10-11",
  "PRESENTOIR-OREILLE16-87",
  "A1244-DO",
  "A1376-DO",
];

async function probe(reference: string, vendorId: number) {
  console.log(`\n──────── ${reference} ────────`);
  // Stratégie 1 : la référence complète
  try {
    const full = await efashionListProducts({
      idVendeur: vendorId,
      take: 50,
      reference,
      premelFilter: "tous",
    });
    console.log(`  full "${reference}" → ${full.items.length} items (total ${full.total})`);
    for (const it of full.items.slice(0, 5)) {
      console.log(
        `    • id=${it.id_produit} ref="${it.reference}" base="${it.reference_base}" couleur="${it.couleur}"`,
      );
    }
  } catch (err) {
    console.log(`  full erreur : ${err instanceof Error ? err.message : err}`);
  }

  // Stratégie 2 : la partie avant le premier tiret (comportement actuel)
  const partial = reference.split(/[-_]/)[0];
  if (partial !== reference) {
    try {
      const p = await efashionListProducts({
        idVendeur: vendorId,
        take: 50,
        reference: partial,
        premelFilter: "tous",
      });
      console.log(`  partiel "${partial}" → ${p.items.length} items (total ${p.total})`);
      const exact = p.items.filter(
        (it) => (it.reference_base ?? "").toLowerCase() === reference.toLowerCase(),
      );
      if (exact.length > 0) {
        console.log(`    └─ ${exact.length} match strict sur reference_base="${reference}"`);
      }
    } catch (err) {
      console.log(`  partiel erreur : ${err instanceof Error ? err.message : err}`);
    }
  }
}

async function main() {
  const vendor = await efashionGetMe();
  console.log(`Connecté en tant que ${vendor.nomBoutique} (id=${vendor.id_vendeur})`);
  for (const ref of SAMPLES) {
    await probe(ref, vendor.id_vendeur);
    await new Promise((r) => setTimeout(r, 200));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
