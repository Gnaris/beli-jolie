/**
 * Test ponctuel : on essaie d'ajouter la couleur Noir au produit eFashion
 * 3577336 (celui qui a renvoyé "Ce shooting est déjà confirmé" sur le PUT).
 *
 * On teste DEUX voies, pour comparer :
 *   1) PUT /shootings/product/{id}  ← méthode actuelle (devrait planter)
 *   2) GraphQL duplicateWithNewColor ← bouton "+ Ajouter une couleur" de
 *      leur UI vendeur (devrait peut-être passer même si shooting confirmé)
 *
 * Lecture seule au début : on liste l'état live du groupe avant d'écrire.
 * Si la voie 2 passe, ça crée vraiment une nouvelle ligne côté eFashion
 * (à supprimer manuellement après si on ne veut pas la garder).
 *
 * Usage : npx tsx scripts/efashion-test-add-noir.ts
 */

import { prisma } from "@/lib/prisma";
import {
  efashionGetMe,
  efashionListByReferenceBaseExact,
} from "@/lib/efashion-api";
import { efashionPutShootingProduct } from "@/lib/efashion-shootings";
import {
  efashionDuplicateWithNewColor,
  efashionGetProduitCaracteristiqueIds,
} from "@/lib/efashion-api-write";

const EF_PRODUCT_ID = 3577336;
const COLOR_NAME = "Noir";

async function main() {
  console.log(`\n=== Test ajout couleur "${COLOR_NAME}" sur eFashion id=${EF_PRODUCT_ID} ===\n`);

  const vendor = await efashionGetMe();
  console.log(`🔌 Vendeur : ${vendor.nomBoutique} (id_vendeur=${vendor.id_vendeur})\n`);

  // ── 1. Lecture de l'état local + remontée du efashionColorId pour Noir
  const noir = await prisma.color.findFirst({
    where: {
      OR: [
        { name: { equals: COLOR_NAME } },
        { name: { contains: COLOR_NAME } },
      ],
    },
    select: { id: true, name: true, efashionColorId: true },
  });
  console.log(`Couleur locale "${COLOR_NAME}":`, noir);
  if (!noir?.efashionColorId) {
    console.log("❌ Pas d'efashionColorId mappé pour Noir, abandon.");
    process.exit(1);
  }

  const localProduct = await prisma.product.findFirst({
    where: { colors: { some: { efashionProductId: EF_PRODUCT_ID } } },
    select: {
      id: true,
      reference: true,
      efashionReferenceBase: true,
    },
  });
  console.log(`Produit local :`, localProduct);
  if (!localProduct?.efashionReferenceBase) {
    console.log("❌ Pas de reference_base eFashion sur ce produit, abandon.");
    process.exit(1);
  }

  // ── 2. État live chez eFashion
  const live = await efashionListByReferenceBaseExact({
    idVendeur: vendor.id_vendeur,
    referenceBase: localProduct.efashionReferenceBase,
    premelFilter: "tous",
  });
  console.log(`\n--- État live eFashion (${live.length} variantes) ---`);
  for (const v of live) {
    console.log(
      `  id=${v.id_produit}  couleur="${v.couleur}" (id_couleur=${v.id_couleur})  main=${v.main}  id_shooting=${v.id_shooting}  ref=${v.reference}  visible=${v.visible}`,
    );
  }

  const src = live.find((v) => v.id_produit === EF_PRODUCT_ID) ?? live.find((v) => v.main);
  if (!src) {
    console.log("❌ Pas de variante source trouvée chez eFashion, abandon.");
    process.exit(1);
  }
  console.log(`\nSource retenue : id=${src.id_produit} couleur="${src.couleur}" id_shooting=${src.id_shooting}\n`);

  // Anti-doublon : Noir déjà présent ?
  const alreadyHasNoir = live.some((v) => v.id_couleur === noir.efashionColorId);
  if (alreadyHasNoir) {
    console.log(`⚠️ La couleur Noir (id=${noir.efashionColorId}) est déjà présente sur le groupe — abandon test (pour ne pas créer de doublon).`);
    process.exit(0);
  }

  // ── 3. TEST 1 : PUT /shootings/product/{id} (méthode actuelle du code)
  console.log("\n━━━ TEST 1 : PUT /shootings/product/" + src.id_produit + " ━━━");
  try {
    let caracteristiqueIds: number[] = [];
    try {
      caracteristiqueIds = await efashionGetProduitCaracteristiqueIds(src.id_produit);
    } catch {
      // ignore
    }
    const colorIdSet = new Set<number>(
      live.map((v) => v.id_couleur).filter((x): x is number => x != null),
    );
    colorIdSet.add(noir.efashionColorId);
    const mainIdCouleur = live.find((v) => v.main)?.id_couleur ?? src.id_couleur;
    if (!mainIdCouleur) throw new Error("Pas de mainIdCouleur identifiable");

    const r1 = await efashionPutShootingProduct(src.id_produit, {
      reference: src.reference,
      idVendeurMarque: src.id_vendeur_marque ?? 3228,
      poids: src.poids,
      idCategorie: src.id_categorie!,
      venduPar: src.vendu_par === "tailles" ? "tailles" : "couleurs",
      idCollection: src.id_collection!,
      idProvenance: src.id_provenance!,
      idDeclinaison: src.id_declinaison!,
      idPack: src.id_pack,
      prix: src.prix,
      prixReduit: null,
      couleurs: [...colorIdSet].map((id) => ({ id })),
      couleurPrincipaleId: mainIdCouleur,
      compositions: [],
      caracteristiques: caracteristiqueIds.map((id) => ({ id })),
      descriptionFr: "",
      descriptionEn: "",
      descriptionIt: "",
      descriptionEs: "",
      descriptionZh: null,
      stock: null,
      dateRemise: "2037-12-31",
      pourcentageRemise: 0,
    });
    console.log("✅ TEST 1 (PUT) RÉUSSI :", r1);
  } catch (err) {
    console.log("❌ TEST 1 (PUT) ÉCHEC :", err instanceof Error ? err.message : err);
  }

  // ── 4. TEST 2 : duplicateWithNewColor (bouton + Ajouter une couleur)
  console.log("\n━━━ TEST 2 : GraphQL duplicateWithNewColor ━━━");
  try {
    const r2 = await efashionDuplicateWithNewColor({
      idProduit: src.id_produit,
      couleurId: noir.efashionColorId,
      couleurName: COLOR_NAME,
    });
    console.log("✅ TEST 2 (duplicate) RÉUSSI :", r2);
    console.log("⚠️ Une vraie ligne a été créée côté eFashion — à supprimer si non souhaitée.");
  } catch (err) {
    console.log("❌ TEST 2 (duplicate) ÉCHEC :", err instanceof Error ? err.message : err);
  }

  console.log("\n=== Fin test ===\n");
}

main()
  .catch((err) => {
    console.error("Erreur fatale :", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
