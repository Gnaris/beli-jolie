/**
 * Script — grosse mise à jour du produit test :
 *   • change la saison (autre que la courante)
 *   • crée une déclinaison aléatoire et l'applique
 *   • change le prix au hasard
 *   • change le pays d'origine
 *   • passe Silicone à 50% + ajoute Cuivre 50%
 *   • ajoute la couleur Blanc/Doré + uploade 5 photos dessus
 *   • met "Description test modifié" en FR/EN/IT/ES/ZH
 *
 * Usage : npx tsx scripts/efashion-test-mega-update.ts
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { ensureEfashionSession } from "@/lib/efashion-auth";
import { efashionFetch } from "@/lib/efashion-client";
import {
  efashionPutShootingProduct,
} from "@/lib/efashion-shootings";
import {
  efashionCreateDeclinaison,
} from "@/lib/efashion-api-write";
import { efashionListProducts } from "@/lib/efashion-api";
import { getEfashionAnnexes } from "@/lib/efashion-annexes";

const REFERENCE = "TEST-EF-8WXZHW";
const SHOOTING_ID = 194774;
const ID_VENDEUR = 2017;
const ID_COULEUR_TURQUOISE = 185;
const ID_COULEUR_MOUTARDE = 61;
const ID_COULEUR_BLANCDORE = 1412;
const ID_COMPOSITION_SILICONE = 162;

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomFloat(min: number, max: number, decimals = 2): number {
  const v = Math.random() * (max - min) + min;
  return Number(v.toFixed(decimals));
}

async function main() {
  await ensureEfashionSession();
  console.log("→ Session OK\n");

  // ─── 1) Référentiels ────────────────────────────────────────────────────
  console.log("→ Chargement des annexes (saisons, provenances, compositions)...");
  const annexes = await getEfashionAnnexes();
  console.log(
    `  ✓ ${annexes.collections.length} saisons, ${annexes.provenances.length} provenances, ${annexes.compositions.length} compositions`,
  );

  // ─── 2) Composition Cuivre ──────────────────────────────────────────────
  const cuivre = annexes.compositions.find((c) => /\bcuivre\b/i.test(c.label));
  if (!cuivre) throw new Error("Composition « Cuivre » introuvable chez eFashion");
  console.log(`  ✓ Cuivre trouvé : id ${cuivre.id} (${cuivre.label})`);

  // ─── 3) État actuel du shooting ─────────────────────────────────────────
  console.log(`\n→ Lecture du shooting ${SHOOTING_ID}...`);
  const sh = (await (await efashionFetch(`/shootings/shooting/${SHOOTING_ID}`, { method: "GET" })).json()) as {
    produits: Array<{
      id_produit: number;
      id_vendeur_marque: number;
      id_categorie: number;
      id_declinaison: number;
      id_pack: number;
      id_collection: number;
      id_provenance: number;
      vendu_par: "couleurs" | "tailles";
      prix: string | number;
      prixReduit: string | number | null;
      poids: number;
      main: number;
    }>;
  };
  const principal = sh.produits.find((p) => p.main === 1) ?? sh.produits[0];
  console.log(`  ✓ id_produit principal=${principal.id_produit}`);
  console.log(`     saison actuelle      : ${principal.id_collection}`);
  console.log(`     provenance actuelle  : ${principal.id_provenance}`);
  console.log(`     prix actuel          : ${principal.prix} €`);
  console.log(`     déclinaison actuelle : ${principal.id_declinaison}`);

  // ─── 4) Choix au hasard ─────────────────────────────────────────────────
  const otherSeasons = annexes.collections.filter((c) => c.id !== principal.id_collection);
  const newSeason = pickRandom(otherSeasons);
  const otherProvenances = annexes.provenances.filter((p) => p.id !== principal.id_provenance);
  const newProvenance = pickRandom(otherProvenances);
  const newPrice = randomFloat(5, 25);

  console.log(`\n→ Choix aléatoires :`);
  console.log(`   saison    : ${newSeason.label} (id ${newSeason.id})`);
  console.log(`   pays      : ${newProvenance.libelle} (id ${newProvenance.id})`);
  console.log(`   prix      : ${newPrice} €`);

  // ─── 5) Nouvelle déclinaison (au hasard) ────────────────────────────────
  const sizePools = [
    ["XS", "S", "M", "L", "XL"],
    ["38", "40", "42", "44", "46"],
    ["48", "50", "52", "54"],
    ["S", "M", "L"],
    ["TU"],
    ["6", "7", "8", "9", "10"],
  ];
  const sizes = pickRandom(sizePools);
  const declinaisonTitle = `Test ${Math.floor(Math.random() * 9999)}`;
  console.log(`\n→ Création d'une déclinaison aléatoire : "${declinaisonTitle}" avec [${sizes.join(", ")}]`);
  const newDecl = await efashionCreateDeclinaison({
    id_vendeur: ID_VENDEUR,
    titre: declinaisonTitle,
    sizes,
  });
  const newDeclId = Number(newDecl.id_declinaison);
  console.log(`  ✓ Déclinaison créée : id ${newDeclId} ("${newDecl.titre}")`);

  // ─── 6) PUT — toutes les modifs en un coup ──────────────────────────────
  const descriptionTexte = "Description test modifié";
  const couleurs = [
    { id: ID_COULEUR_TURQUOISE },
    { id: ID_COULEUR_MOUTARDE },
    { id: ID_COULEUR_BLANCDORE }, // ← nouvelle
  ];
  const compositions = [
    { id: ID_COMPOSITION_SILICONE, localisationId: 4, percentage: 50 },
    { id: cuivre.id, localisationId: 4, percentage: 50 },
  ];

  const body = {
    reference: REFERENCE,
    idVendeurMarque: principal.id_vendeur_marque,
    poids: String(principal.poids),
    idCategorie: principal.id_categorie,
    venduPar: principal.vendu_par,
    idCollection: newSeason.id,
    idProvenance: newProvenance.id,
    idDeclinaison: newDeclId,
    idPack: principal.id_pack,
    prix: String(newPrice),
    prixReduit: null,
    couleurs,
    couleurPrincipaleId: ID_COULEUR_MOUTARDE,
    compositions,
    caracteristiques: [],
    descriptionFr: descriptionTexte,
    descriptionEn: descriptionTexte,
    descriptionIt: descriptionTexte,
    descriptionEs: descriptionTexte,
    descriptionZh: descriptionTexte,
    stock: null,
    dateRemise: "2027-12-31",
    pourcentageRemise: 0,
  };

  console.log(`\n→ PUT /shootings/product/${principal.id_produit} (toutes les modifs en bloc)...`);
  const putResult = await efashionPutShootingProduct(principal.id_produit, body);
  console.log(`  ✓ Réponse : success=${putResult.success}  message=${putResult.message ?? "—"}`);

  // ─── 7) On récupère l'id_produit de la nouvelle couleur Blanc/Doré ─────
  console.log(`\n→ Recherche de l'id_produit pour Blanc/Doré...`);
  const list = await efashionListProducts({
    idVendeur: ID_VENDEUR,
    reference: REFERENCE,
    premelFilter: "tous",
    take: 20,
  });
  console.log(`  Variantes trouvées :`);
  for (const it of list.items) {
    console.log(`    - id=${it.id_produit} couleur=${it.couleur}(${it.id_couleur}) main=${it.main} nb_photos=${it.nb_photos} prix=${it.prix}€`);
  }
  const blancDore = list.items.find((it) => it.id_couleur === ID_COULEUR_BLANCDORE);
  if (!blancDore) {
    console.log(`\n  ⚠ La couleur Blanc/Doré n'apparaît pas dans la liste — eFashion n'a pas créé de productId pour elle via PUT.`);
    console.log(`     Pas d'upload de photos possible sur cette couleur (à investiguer).`);
    return;
  }
  console.log(`  ✓ Blanc/Doré → id_produit=${blancDore.id_produit}`);

  // ─── 8) Upload de 5 photos sur Blanc/Doré ───────────────────────────────
  const sources = [
    "public/uploads/produits/a459e/a459e-argent-1.webp",
    "public/uploads/produits/f137/f137-doré-1.webp",
    "public/uploads/produits/a219/a219-doré-1.webp",
    "public/uploads/produits/a217/a217-doré-1.webp",
    "public/uploads/produits/e110/e110-doré-1.webp",
  ];

  console.log(`\n→ Préparation et upload de 5 photos sur Blanc/Doré...`);
  const form = new FormData();
  for (let i = 0; i < sources.length; i++) {
    const rel = sources[i];
    const full = path.resolve(process.cwd(), rel);
    console.log(`   • ${rel} → JPEG`);
    const webp = await readFile(full);
    const jpeg = await sharp(webp).jpeg({ quality: 90 }).toBuffer();
    const blob = new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" });
    form.append("photos", blob, `test-ef-${blancDore.id_produit}-${i + 1}.jpg`);
  }
  form.append("productId", String(blancDore.id_produit));

  await ensureEfashionSession();
  const upRes = await efashionFetch("/api/upload-product-photo", { method: "POST", body: form });
  if (!upRes.ok) {
    const txt = await upRes.text().catch(() => "");
    throw new Error(`Upload Blanc/Doré HTTP ${upRes.status} : ${txt.slice(0, 300)}`);
  }
  const upJson = (await upRes.json()) as { success: boolean; nbPhotos: number; photos: string[]; message?: string };
  console.log(`  ✓ Upload OK : nbPhotos=${upJson.nbPhotos}`);
  upJson.photos.forEach((p) => console.log(`     ${p}`));

  // ─── 9) Vérification finale ─────────────────────────────────────────────
  console.log(`\n→ Vérification finale du produit...`);
  const finalList = await efashionListProducts({
    idVendeur: ID_VENDEUR,
    reference: REFERENCE,
    premelFilter: "tous",
    take: 20,
  });
  for (const it of finalList.items) {
    console.log(
      `  - id=${it.id_produit}  couleur=${it.couleur}(${it.id_couleur})  main=${it.main}  nb_photos=${it.nb_photos}  prix=${it.prix}€  saison=${it.id_collection}  pays=${it.id_provenance}  decl=${it.id_declinaison}`,
    );
  }

  console.log(`\n════════════════════════════════════════════════════════════`);
  console.log(`✅ Modifications appliquées :`);
  console.log(`   saison        → ${newSeason.label}`);
  console.log(`   pays origine  → ${newProvenance.libelle}`);
  console.log(`   prix          → ${newPrice} €`);
  console.log(`   déclinaison   → "${newDecl.titre}" (id ${newDeclId}, ${sizes.length} tailles)`);
  console.log(`   compositions  → Silicone 50% + Cuivre 50%`);
  console.log(`   nouvelle couleur Blanc/Doré → 5 photos`);
  console.log(`   description   → "Description test modifié" (FR/EN/IT/ES/ZH)`);
  console.log(`════════════════════════════════════════════════════════════`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌", err instanceof Error ? err.message : String(err));
    if (err instanceof Error && err.stack) console.error(err.stack);
    process.exit(1);
  });
