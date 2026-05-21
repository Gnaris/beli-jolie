/**
 * eFashion Paris — Mutations GraphQL (écriture).
 *
 * Pour les opérations qui passent par REST /shootings/* (création, modification
 * complète, suppression), voir `lib/efashion-shootings.ts` (Lot 4-5).
 *
 * Documentation : docs/efashion-api.md
 */

import { ensureEfashionSession } from "@/lib/efashion-auth";
import { efashionGraphql } from "@/lib/efashion-client";

interface UpdateProduitInput {
  id_produit: number;
  visible?: boolean;
  prix?: number | string;
  prixReduit?: number | string | null;
  poids?: number | string;
  vendu_par?: "couleurs" | "tailles";
  id_collection?: number;
  id_categorie?: number;
  id_pack?: number | null;
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
 * Met à jour le stock pour 1 couple (couleur, taille). Utilise UpsertProduitStock
 * (création si pas encore renseigné, mise à jour sinon).
 */
export async function efashionUpsertProduitStock(args: {
  id_produit: number;
  id_couleur: number;
  value: number;
  taille?: string | null;
}): Promise<number | string> {
  await ensureEfashionSession();
  const data = await efashionGraphql<{ upsertProduitStock: number | string }>(
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
  return data.upsertProduitStock;
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
