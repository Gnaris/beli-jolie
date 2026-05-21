/**
 * eFashion Paris — Workflow REST `/shootings/*` (création & modification produits).
 *
 * Cf. docs/efashion-api.md §3-5 pour le détail des endpoints.
 * Toutes les requêtes nécessitent une session active (cookie) garantie par
 * `ensureEfashionSession()`.
 */

import { ensureEfashionSession } from "@/lib/efashion-auth";
import { efashionFetch } from "@/lib/efashion-client";

async function postJson<T>(path: string, body: unknown): Promise<T> {
  await ensureEfashionSession();
  const res = await efashionFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`eFashion POST ${path} HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

async function putJson<T>(path: string, body: unknown): Promise<T> {
  await ensureEfashionSession();
  const res = await efashionFetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`eFashion PUT ${path} HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

async function getJson<T>(path: string): Promise<T> {
  await ensureEfashionSession();
  const res = await efashionFetch(path, { method: "GET" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`eFashion GET ${path} HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

// ─── Référentiels (chargement formulaire création) ────────────────────────

export interface EfashionReferenceData {
  marques: Array<{ id: number; label: string; value: number; defaut?: boolean }>;
  categories: Array<{ id: number; label: string }>;
  sousCategories: Array<{ id: number; label: string; parentId: string }>;
  collections?: unknown[];
  packs?: unknown[];
  declinaisons?: unknown[];
  couleurs?: unknown[];
  provenances?: unknown[];
}

export async function efashionGetReferenceData(): Promise<EfashionReferenceData> {
  return postJson<EfashionReferenceData>("/shootings/get-reference-data", {});
}

export async function efashionGetCaracteristiques(
  idCategorie: number | string,
): Promise<{ caracteristiques: Array<{ id_caracteristique: number; libelle: string }> }> {
  return postJson("/shootings/get-caracteristiques", { idCategorie: String(idCategorie) });
}

export async function efashionGetCompositionAutocomplete(
  term: string,
  idString = "",
): Promise<Array<{ id: number; label: string }>> {
  return postJson("/shootings/get-composition-autocomplete", { term, idString });
}

export async function efashionCheckReferencesExist(
  references: Array<{ reference: string; venduPar: "couleurs" | "tailles" }>,
): Promise<{ results: Array<{ reference: string; exists: boolean }> }> {
  return postJson("/shootings/check-references-exists-batch", { references });
}

// ─── Brouillon « MEL » (Mise En Ligne) ─────────────────────────────────────

export interface EfashionMelDraftReference {
  id: string;                   // ID client temporaire (timestamp ou cuid)
  reference: string;
  marque: string;               // id_vendeur_marque (BJ = "3228")
  poids: string;
  categorie: string;            // id_categorie feuille
  categorieLibelle?: string;
  sousCategorieLibelle?: string;
  sousSousCategorieLibelle?: string;
  venduPar: "couleurs" | "tailles";
  collection: string;           // id_collection
  paysOrigine: string;          // id_provenance
  taillePaquet: string;         // id_declinaison
  quantitePaquet: string;       // id_pack
  stock: string;
  prix: string;
  prixReduit: string;
  dateRemise: string;
  pourcentageRemise: string;
  dimensions: string;
  minimumCommande: string;
  descriptionFr: string;
  descriptionEn: string;
  descriptionIt: string;
  descriptionEs: string;
  descriptionZh: string | null;
  couleurs: Array<{ id: number; nom: string; isMain: boolean }>;
  compositions: Array<{ id: number; localisationId: number; percentage: number }>;
  caracteristiques: Array<{ id: number }>;
}

/**
 * Étape 1 : sauve un brouillon multi-couleurs. Retourne un `productId` par couleur.
 */
export async function efashionSaveMelDraft(input: {
  references: EfashionMelDraftReference[];
}): Promise<{
  success: boolean;
  message?: string;
  productIds: number[];
  totalProducts: number;
}> {
  return postJson("/shootings/save-mel-draft", {
    dataSource: "form",
    references: input.references,
  });
}

/**
 * Étape 2 : valide le choix « j'uploade mes propres photos ».
 * Doit être appelé avec `melOption: "upload"` (cf. confirmation cliente — pas de studio).
 */
export async function efashionSaveMelChoice(input: {
  references: Array<EfashionMelDraftReference & { id: string }>;
}): Promise<{
  success: boolean;
  message?: string;
  shootings: Array<{ id: number; category: string; totalPieces: number }>;
  totalShootings: number;
}> {
  return postJson("/shootings/save-mel-choice", {
    melOption: "upload",
    dataSource: "form",
    shootAllColors: false,
    references: input.references,
  });
}

// ─── Modification complète d'un produit existant (PUT) ─────────────────────

export interface EfashionPutProductInput {
  reference: string;
  idVendeurMarque: number;
  poids: string | number;
  idCategorie: string | number;
  venduPar: "couleurs" | "tailles";
  idCollection: string | number;
  idProvenance: string | number;
  idDeclinaison: number;
  idPack: number | null;
  prix: string | number;
  prixReduit: string | number | null;
  couleurs: Array<{ id: number }>;
  couleurPrincipaleId: number;
  compositions: Array<{ id: number; localisationId: number; percentage: number }>;
  caracteristiques: Array<{ id: number }>;
  descriptionFr: string;
  descriptionEn: string;
  descriptionIt: string;
  descriptionEs: string;
  descriptionZh: string | null;
  stock: number | null;
  dateRemise: string;
  pourcentageRemise: number;
}

export async function efashionPutShootingProduct(
  idProduit: number,
  input: EfashionPutProductInput,
): Promise<{ success: boolean; message?: string }> {
  return putJson(`/shootings/product/${idProduit}`, input);
}

// ─── Suppression d'un produit (Lot 5) ───────────────────────────────────────

export async function efashionDeleteShootingProduct(
  idProduit: number,
): Promise<{ success: boolean; message?: string }> {
  return postJson(`/shootings/product/${idProduit}/delete`, {});
}

// ─── Mes shootings (lecture seule, utile pour debug) ───────────────────────

export interface EfashionShootingSummary {
  id: number;
  dateDemande: string;
  dateFinalisation: string | null;
  totalPieces: number;
  references: string[];
}

export async function efashionListMyShootings(): Promise<{
  success: boolean;
  shootings: EfashionShootingSummary[];
}> {
  return getJson("/shootings/my-shootings");
}

