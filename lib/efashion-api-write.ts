/**
 * eFashion Paris — Mutations GraphQL (écriture).
 *
 * Pour les opérations qui passent par REST /shootings/* (création, modification
 * complète, suppression), voir `lib/efashion-shootings.ts` (Lot 4-5).
 *
 * Documentation : docs/efashion-api.md
 */

import { ensureEfashionSession } from "@/lib/efashion-auth";
import { efashionFetch, efashionGraphql } from "@/lib/efashion-client";
import { logger } from "@/lib/logger";

interface UpdateProduitInput {
  id_produit: number;
  // ⚠️ Pour que `prix` ne soit pas propagé à toutes les couleurs, il faut
  // envoyer le payload **complet** comme le fait l'UI eFashion (cf. HAR de
  // mai 2026). Avec seulement `{ id_produit, prix }`, eFashion considère
  // que c'est une modif au niveau « groupe » et propage à toutes les couleurs.
  reference?: string;
  reference_base?: string;
  visible?: boolean;
  prix?: number | string;
  prixReduit?: number | string | null;
  poids?: number | string;
  vendu_par?: "couleurs" | "tailles";
  id_vendeur_marque?: number;
  id_provenance?: number;
  id_collection?: number;
  id_declinaison?: number;
  id_categorie?: number;
  id_pack?: number | null;
  /**
   * Bascule de la couleur principale du groupe. `main: true` promeut cette
   * variante comme couleur principale ; `main: false` la rétrograde.
   * eFashion attend les 2 appels successifs (cf. HAR de mai 2026),
   * pas une seule mutation.
   */
  main?: boolean;
  /**
   * Identifiant eFashion de la couleur de liaison (groupe). En pratique =
   * efashionProductId du **nouveau main**. Requis dans le payload des appels
   * de bascule de couleur principale, sinon eFashion ignore le `main`.
   */
  id_couleur_liee?: number;
}

interface UpdateProduitResult {
  id_produit: string;
  reference: string;
  id_collection: number | null;
  id_categorie: number | null;
  prix: string;
  poids: number;
  vendu_par: string;
  visible: boolean;
  id_pack: number | null;
}

/**
 * Met à jour les champs basiques d'un produit-couleur eFashion existant.
 * Utilisé pour ONLINE/OFFLINE (`visible`), prix, poids.
 *
 * ⚠️ Pour modifier les couleurs, compositions, descriptions multilingues, etc.
 * il faut passer par `PUT /shootings/product/{id}` (cf. lib/efashion-shootings.ts).
 */
export async function efashionUpdateProduit(
  input: UpdateProduitInput,
): Promise<UpdateProduitResult> {
  await ensureEfashionSession();
  const data = await efashionGraphql<{ updateProduit: UpdateProduitResult }>(
    `mutation UpdateProduit($input: UpdateProduitInput!) {
      updateProduit(input: $input) {
        id_produit reference id_collection id_categorie
        prix poids vendu_par visible id_pack
      }
    }`,
    { input },
  );
  if (!data.updateProduit) {
    throw new Error("eFashion: updateProduit a renvoyé un résultat vide");
  }
  return data.updateProduit;
}

/**
 * Bascule la couleur principale (`main = true`) du groupe vers `idProduit`.
 * eFashion garantit qu'il n'y a qu'une seule main par groupe : appeler ça
 * sur une variante non-main la promeut et démote l'ancienne automatiquement.
 *
 * Retourne `true` quand la bascule a réussi côté eFashion (no-op idempotent
 * si la cible est déjà main).
 */
export async function efashionToggleMainProduct(idProduit: number): Promise<boolean> {
  await ensureEfashionSession();
  const data = await efashionGraphql<{ toggleMainProduct: boolean }>(
    `mutation ToggleMainProduct($idProduit: Int!) {
      toggleMainProduct(idProduit: $idProduit)
    }`,
    { idProduit },
  );
  return data.toggleMainProduct ?? true;
}

/**
 * Met à jour le stock pour 1 couple (couleur, taille). Utilise UpsertProduitStock
 * (création si pas encore renseigné, mise à jour sinon).
 *
 * ⚠️ La mutation retourne en réalité un **boolean** (true = succès), pas la
 * nouvelle valeur de stock. Confirmé par test (mai 2026). Pour lire le stock
 * effectif après, passer par `productsPage.items[].stock_value`.
 */
export async function efashionUpsertProduitStock(args: {
  id_produit: number;
  id_couleur: number;
  value: number;
  taille?: string | null;
}): Promise<boolean> {
  await ensureEfashionSession();
  const data = await efashionGraphql<{ upsertProduitStock: boolean }>(
    `mutation UpsertProduitStock(
      $id_produit: Int!, $id_couleur: Int!, $value: Int!, $taille: String
    ) {
      upsertProduitStock(
        id_produit: $id_produit,
        id_couleur: $id_couleur,
        value: $value,
        taille: $taille
      )
    }`,
    {
      id_produit: args.id_produit,
      id_couleur: args.id_couleur,
      value: args.value,
      taille: args.taille ?? null,
    },
  );
  return data.upsertProduitStock ?? true;
}

/**
 * Met à jour plusieurs stocks en un seul appel (batch).
 * Items = [{ id_couleur, value, taille? }, ...].
 */
export async function efashionSaveProduitStocks(args: {
  id_produit: number;
  items: Array<{ id_couleur: number; value: number; taille?: string | null }>;
}): Promise<boolean> {
  await ensureEfashionSession();
  const data = await efashionGraphql<{ saveProduitStocks: boolean }>(
    `mutation SaveProduitStocks($input: SaveProduitStocksInput!) {
      saveProduitStocks(input: $input)
    }`,
    {
      input: {
        id_produit: args.id_produit,
        items: args.items.map((it) => ({
          id_couleur: it.id_couleur,
          value: it.value,
          taille: it.taille ?? null,
        })),
      },
    },
  );
  return data.saveProduitStocks ?? true;
}

/**
 * Liste les `id_couleur` déjà utilisés sur le groupe-produit d'une `mainId`
 * (la main eFashion représente le groupe : ses couleurs liées ont le même
 * `id_couleur_liee`). Sert d'anti-doublon avant `duplicateWithNewColor`.
 *
 * Endpoint observé dans le HAR de leur UI (mai 2026) : query
 * `allUsedColorIdsByMainProduct(mainId: Int!) -> [Int!]`.
 */
export async function efashionGetAllUsedColorIdsByMainProduct(
  mainId: number,
): Promise<number[]> {
  await ensureEfashionSession();
  const data = await efashionGraphql<{ allUsedColorIdsByMainProduct: number[] }>(
    `query GetAllUsedColorIdsByMainProduct($mainId: Int!) {
      allUsedColorIdsByMainProduct(mainId: $mainId)
    }`,
    { mainId },
  );
  return data.allUsedColorIdsByMainProduct ?? [];
}

/**
 * Duplique la couleur main d'un produit et crée une nouvelle couleur liée
 * du même groupe. C'est exactement le bouton « + Ajouter une couleur » de
 * leur UI (vu dans le HAR de mai 2026). La nouvelle couleur hérite des
 * attributs (prix, poids, catégorie, descriptions, compositions, …) de la
 * source — il faut donc ensuite la pousser via `updateProduit` pour
 * appliquer ses valeurs spécifiques.
 *
 * Le produit créé est initialement en mode brouillon : il faut appeler
 * `publishBrouillon` après avoir uploadé au moins une photo, sinon il ne
 * sort jamais en ligne côté catalogue acheteurs.
 *
 * Retourne le nouvel `id_produit` (string dans la réponse GraphQL, mais
 * c'est un entier — on cast à number pour l'usage en BDD locale).
 */
export async function efashionDuplicateWithNewColor(args: {
  idProduit: number;
  couleurId: number;
  couleurName: string;
}): Promise<{ id_produit: number; reference: string; main: boolean }> {
  await ensureEfashionSession();
  const data = await efashionGraphql<{
    duplicateWithNewColor: { id_produit: string | number; reference: string; main: boolean };
  }>(
    `mutation DuplicateWithNewColor($idProduit: Int!, $couleurId: Int!, $couleurName: String!) {
      duplicateWithNewColor(idProduit: $idProduit, couleurId: $couleurId, couleurName: $couleurName) {
        id_produit
        reference
        main
      }
    }`,
    {
      idProduit: args.idProduit,
      couleurId: args.couleurId,
      couleurName: args.couleurName,
    },
  );
  if (!data.duplicateWithNewColor) {
    throw new Error("eFashion: duplicateWithNewColor a renvoyé un résultat vide");
  }
  return {
    id_produit: typeof data.duplicateWithNewColor.id_produit === "string"
      ? parseInt(data.duplicateWithNewColor.id_produit, 10)
      : data.duplicateWithNewColor.id_produit,
    reference: data.duplicateWithNewColor.reference,
    main: data.duplicateWithNewColor.main,
  };
}

/**
 * Publie un brouillon eFashion (passe la fiche en mode acheteur visible).
 * Appelé juste après `duplicateWithNewColor` + upload des photos pour que
 * la nouvelle couleur apparaisse côté catalogue.
 */
export async function efashionPublishBrouillon(args: {
  idProduit: number;
  idVendeur: number;
}): Promise<boolean> {
  await ensureEfashionSession();
  const data = await efashionGraphql<{ publishBrouillon: boolean }>(
    `mutation PublishBrouillon($id_produit: Int!, $id_vendeur: Int!) {
      publishBrouillon(id_produit: $id_produit, id_vendeur: $id_vendeur)
    }`,
    { id_produit: args.idProduit, id_vendeur: args.idVendeur },
  );
  return data.publishBrouillon ?? true;
}

/**
 * Publie en lot plusieurs brouillons (mutation utilisée par le bouton "Mettre
 * en ligne" de l'UI eFashion vendeur, vérifié dans le HAR du 2026-05-28).
 *
 * Retourne le nombre de produits effectivement publiés (peut être inférieur
 * au nombre envoyé si certains étaient déjà en ligne ou inéligibles).
 *
 * On préfère cette mutation à `publishBrouillon` (singulier) après un
 * `saveMelDraft` parce que c'est exactement ce que fait l'UI eFashion dans ce
 * contexte — la version singulière marche pour les variantes ajoutées via
 * `duplicateWithNewColor` mais n'a pas été vérifiée sur les fiches saveMelDraft.
 */
export async function efashionPublishBrouillonBulk(args: {
  idProduits: number[];
  idVendeur: number;
}): Promise<number> {
  if (args.idProduits.length === 0) return 0;
  await ensureEfashionSession();
  const data = await efashionGraphql<{ publishBrouillonBulk: number }>(
    `mutation PublishBrouillonBulk($id_produits: [Int!]!, $id_vendeur: Int!) {
      publishBrouillonBulk(id_produits: $id_produits, id_vendeur: $id_vendeur)
    }`,
    { id_produits: args.idProduits, id_vendeur: args.idVendeur },
  );
  return data.publishBrouillonBulk ?? 0;
}

/**
 * Marque un ou plusieurs produits comme supprimés (soft-delete : ils
 * disparaissent du catalogue mais restent en BDD eFashion avec `supprimer=1`).
 * Endpoint utilisé par le bouton « Corbeille » de leur UI (vu dans le HAR
 * de mai 2026) — préférable à `POST /shootings/product/{id}/delete` qui est
 * pensé pour le workflow shooting et ne marche pas toujours sur les produits
 * déjà publiés.
 */
export async function efashionSoftDeleteProduits(ids: number[]): Promise<boolean> {
  if (ids.length === 0) return true;
  await ensureEfashionSession();
  const data = await efashionGraphql<{ softDeleteProduits: boolean }>(
    `mutation SoftDeleteProduits($ids: [Int!]!) {
      softDeleteProduits(ids: $ids)
    }`,
    { ids },
  );
  return data.softDeleteProduits ?? true;
}

/**
 * Ajoute une couleur de la bibliothèque officielle eFashion au catalogue du vendeur.
 * Préalable à pouvoir l'utiliser dans une création de produit.
 */
export async function efashionAddCouleurToVendeur(args: {
  id_vendeur: number;
  id_couleur: number;
}): Promise<{ id_couleur_vendeur: number; id_vendeur: number; id_couleur: number }> {
  await ensureEfashionSession();
  const data = await efashionGraphql<{
    addCouleurToVendeur: { id_couleur_vendeur: number; id_vendeur: number; id_couleur: number };
  }>(
    `mutation AddCouleurToVendeur($id_vendeur: Int!, $id_couleur: Int!) {
      addCouleurToVendeur(input: { id_vendeur: $id_vendeur, id_couleur: $id_couleur }) {
        id_couleur_vendeur id_vendeur id_couleur
      }
    }`,
    { id_vendeur: args.id_vendeur, id_couleur: args.id_couleur },
  );
  return data.addCouleurToVendeur;
}

// ─── Traduction de texte via le moteur d'eFashion ────────────────────────
//
// Le back-office d'eFashion utilise deux endpoints REST sous wapi pour
// traduire à la volée (cf. HAR de mai 2026, capturé sur leur UI) :
//   - POST /translate/detect  → détecte la langue source
//   - POST /translate         → traduit vers une liste de langues cibles
//
// Les codes de langue sont **en français** : "francais", "anglais", "italien",
// "espagnol", "chinois". Pas de codes ISO. La réponse est un objet plat
// indexé par ces mêmes libellés ({ "anglais": "...", "italien": "...", ... }).

const EFASHION_LANG_CODES = {
  fr: "francais",
  en: "anglais",
  it: "italien",
  es: "espagnol",
  zh: "chinois",
} as const;

type EfashionTargetLocale = Exclude<keyof typeof EFASHION_LANG_CODES, "fr">;

/**
 * Traduit un texte FR vers les langues cibles via le moteur d'eFashion
 * (utilise leur back-office REST, pas DeepL local). Retourne les
 * traductions dans un dico locale → texte. Les locales absentes de la
 * réponse retombent sur le texte FR d'origine (graceful fallback).
 *
 * Lance une erreur si l'appel HTTP échoue ou si la session n'est pas valide.
 */
async function callTranslateOnce(text: string, targets: EfashionTargetLocale[]) {
  const targetLangs = targets.map((loc) => EFASHION_LANG_CODES[loc]);

  logger.info("[eFashion translate] Appel /translate", {
    targetLangs,
    textLength: text.length,
  });

  const res = await efashionFetch("/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      sourceLang: EFASHION_LANG_CODES.fr,
      targetLangs,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`eFashion /translate HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as Record<string, string>;
}

export async function efashionTranslateText(args: {
  text: string;
  targetLocales?: EfashionTargetLocale[];
}): Promise<Record<EfashionTargetLocale, string>> {
  await ensureEfashionSession();

  const targets: EfashionTargetLocale[] =
    args.targetLocales && args.targetLocales.length > 0
      ? args.targetLocales
      : ["en", "it", "es", "zh"];

  // 1ʳᵉ tentative : toutes les langues demandées (en/it/es/zh par défaut).
  // Si ça plante (souvent parce que `chinois` n'est pas supporté côté eFashion),
  // on retombe sur le sous-ensemble certain (en/it/es) — observé dans le HAR
  // de leur back-office.
  let json: Record<string, string>;
  try {
    json = await callTranslateOnce(args.text, targets);
  } catch (err) {
    const wantsZh = targets.includes("zh");
    if (!wantsZh) throw err;
    const fallback = targets.filter((t) => t !== "zh");
    logger.warn(
      "[eFashion translate] Premier appel échoué, retry sans chinois",
      { error: err instanceof Error ? err.message : String(err) },
    );
    json = await callTranslateOnce(args.text, fallback);
  }

  const out = {} as Record<EfashionTargetLocale, string>;
  for (const loc of targets) {
    const langKey = EFASHION_LANG_CODES[loc];
    const value = json[langKey];
    if (typeof value === "string" && value.length > 0) {
      out[loc] = value;
    } else {
      // L'endpoint a répondu mais sans la langue demandée — fallback sur le FR
      // d'origine (préférable à une chaîne vide qui « casse » la fiche eFashion).
      logger.warn("[eFashion translate] Langue manquante dans la réponse", {
        missing: langKey,
        responseKeys: Object.keys(json),
      });
      out[loc] = args.text;
    }
  }
  logger.info("[eFashion translate] Traductions obtenues", {
    locales: Object.keys(out),
    sampleEn: out.en?.slice(0, 60),
  });
  return out;
}

// ─── Description multilingue (live edit) ─────────────────────────────────
//
// ⚠️ Convention eFashion : le champ « anglais » s'appelle `texte_uk` (UK, pas EN).
// Les autres : texte_fr, texte_it, texte_es, texte_zh. Pas de DE/AR/PT exposés.

export interface EfashionProductDescription {
  id_produit: number;
  texte_fr: string | null;
  texte_uk: string | null;
  texte_it: string | null;
  texte_es: string | null;
  texte_zh: string | null;
  instructions: string | null;
  commentaires: string | null;
}

export async function efashionGetProduitDescription(idProduit: number): Promise<EfashionProductDescription | null> {
  await ensureEfashionSession();
  const data = await efashionGraphql<{ produitDescription: EfashionProductDescription | null }>(
    `query ProduitDescription($id_produit: Int!) {
      produitDescription(id_produit: $id_produit) {
        id_produit texte_fr texte_uk texte_it texte_es texte_zh instructions commentaires
      }
    }`,
    { id_produit: idProduit },
  );
  return data.produitDescription;
}

export async function efashionSaveProduitDescription(args: {
  id_produit: number;
  texte_fr: string;
  texte_uk?: string;
  texte_it?: string;
  texte_es?: string;
  texte_zh?: string;
}): Promise<boolean> {
  await ensureEfashionSession();
  const data = await efashionGraphql<{ saveProduitDescription: boolean }>(
    `mutation SaveProduitDescription($input: SaveProduitDescriptionInput!) {
      saveProduitDescription(input: $input)
    }`,
    {
      input: {
        id_produit: args.id_produit,
        texte_fr: args.texte_fr,
        texte_uk: args.texte_uk ?? "",
        texte_it: args.texte_it ?? "",
        texte_es: args.texte_es ?? "",
        texte_zh: args.texte_zh ?? "",
      },
    },
  );
  return data.saveProduitDescription ?? true;
}

// ─── Compositions (live edit) ─────────────────────────────────────────────

export interface EfashionProductComposition {
  id_composition: number;
  id_composition_localisation: number;  // 4 = Produit (observé)
  value: number;                        // pourcentage
  famille?: string;
  libelle?: string;
}

export async function efashionGetProduitCompositions(idProduit: number, lang = "fr"): Promise<EfashionProductComposition[]> {
  await ensureEfashionSession();
  const data = await efashionGraphql<{ produitCompositions: EfashionProductComposition[] }>(
    `query ProduitCompositions($id_produit: Int!, $lang: String) {
      produitCompositions(id_produit: $id_produit, lang: $lang) {
        id_composition id_composition_localisation value famille libelle
      }
    }`,
    { id_produit: idProduit, lang },
  );
  return data.produitCompositions ?? [];
}

export async function efashionSaveProduitCompositions(args: {
  id_produit: number;
  items: Array<{ id_composition: number; id_composition_localisation: number; value: number }>;
}): Promise<boolean> {
  await ensureEfashionSession();
  const data = await efashionGraphql<{ saveProduitCompositions: boolean }>(
    `mutation SaveProduitCompositions($input: SaveProduitCompositionsInput!) {
      saveProduitCompositions(input: $input)
    }`,
    { input: args },
  );
  return data.saveProduitCompositions ?? true;
}

// ─── Caractéristiques (live edit) ─────────────────────────────────────────

export async function efashionGetProduitCaracteristiqueIds(idProduit: number): Promise<number[]> {
  await ensureEfashionSession();
  const data = await efashionGraphql<{ produitCaracteristiqueIds: number[] }>(
    `query GetProduitCaracteristiqueIds($id_produit: Int!) {
      produitCaracteristiqueIds(id_produit: $id_produit)
    }`,
    { id_produit: idProduit },
  );
  return data.produitCaracteristiqueIds ?? [];
}

export async function efashionUpdateProduitCaracteristiques(args: {
  id_produit: number;
  id_categorie: number;
  ids_caracteristiques: number[];
}): Promise<boolean> {
  await ensureEfashionSession();
  const data = await efashionGraphql<{ updateProduitCaracteristiques: boolean }>(
    `mutation UpdateProduitCaracteristiques($input: UpdateProduitCaracteristiquesInput!) {
      updateProduitCaracteristiques(input: $input)
    }`,
    { input: args },
  );
  return data.updateProduitCaracteristiques ?? true;
}

// ─── Création de déclinaison (pack de tailles) ───────────────────────────
//
// Capacité max = **12 tailles** par déclinaison (champs d1_FR..d12_FR).
// Si on dépasse, on doit splitter — mais en pratique aucun produit BJ ne
// dépasse 12 tailles, donc on lève une erreur claire.

export interface EfashionCreatedDeclinaison {
  id_declinaison: string;
  titre: string;
  d1_FR: string | null;
  d2_FR: string | null;
  d3_FR: string | null;
  d4_FR: string | null;
  d5_FR: string | null;
  d6_FR: string | null;
  d7_FR: string | null;
  d8_FR: string | null;
  d9_FR: string | null;
  d10_FR: string | null;
  d11_FR: string | null;
  d12_FR: string | null;
}

/**
 * Crée une nouvelle déclinaison côté eFashion à partir d'une liste de tailles.
 * Retourne l'objet créé avec son `id_declinaison`.
 *
 * @param args.id_vendeur ID vendeur eFashion (ex: 2017)
 * @param args.titre Titre humain (ex: "Bague", "Vêtements XS-XL"). Visible dans leur back-office.
 * @param args.sizes Tableau ordonné des valeurs de tailles (max 12). Le 1er va dans d1_FR, etc.
 */
export async function efashionCreateDeclinaison(args: {
  id_vendeur: number;
  titre: string;
  sizes: string[];
}): Promise<EfashionCreatedDeclinaison> {
  await ensureEfashionSession();
  if (args.sizes.length === 0) throw new Error("Au moins 1 taille requise pour créer une déclinaison.");
  if (args.sizes.length > 12) {
    throw new Error(
      `eFashion accepte au maximum 12 tailles par déclinaison (${args.sizes.length} fournies).`,
    );
  }

  const input: Record<string, string | number | null> = {
    id_vendeur: args.id_vendeur,
    titre: args.titre,
  };
  for (let i = 1; i <= 12; i++) {
    input[`d${i}_FR`] = args.sizes[i - 1] ?? null;
  }

  const data = await efashionGraphql<{ createDeclinaison: EfashionCreatedDeclinaison }>(
    `mutation CreateDeclinaison($createDeclinaisonInput: CreateDeclinaisonInput!) {
      createDeclinaison(createDeclinaisonInput: $createDeclinaisonInput) {
        id_declinaison titre
        d1_FR d2_FR d3_FR d4_FR d5_FR d6_FR
        d7_FR d8_FR d9_FR d10_FR d11_FR d12_FR
      }
    }`,
    { createDeclinaisonInput: input },
  );
  if (!data.createDeclinaison) throw new Error("eFashion: createDeclinaison a renvoyé un résultat vide.");
  return data.createDeclinaison;
}
