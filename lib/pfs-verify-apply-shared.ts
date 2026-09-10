/**
 * Helpers purs pour PFS Verify Apply — importables depuis un composant client
 * (aucune dépendance à Prisma / next/headers).
 *
 * La logique métier "lourde" (accès BDD, appels PFS) reste dans
 * `lib/pfs-verify-apply.ts`, qui réexporte ces helpers pour compat.
 */

import type { PfsVerifyIssue } from "@/lib/pfs-verify";

// ─── Whitelists Lot B ──────────────────────────────────────────────────────
//
// Push (« Envoyer PFS ») est plus permissif que pull car les endpoints PFS
// (pfsUpdateProduct, pfsPatchVariants, pfsUpdateStatus) acceptent déjà tous
// les champs "identifiants" (catégorie/famille/composition/pays/saison). Le
// seul cas structurel non supporté = créer/supprimer une variante inline.
//
// Pull (« Prendre PFS ») reste limité aux champs scalaires directs : les
// champs à IDs (catégorie/famille/composition/pays/saison) demandent une
// résolution inverse du mapping côté BDD locale — ce sera le Lot C.

const PRODUCT_FIELDS_PUSH = new Set([
  "name",
  "description",
  "dimensions",
  "isBestSeller",
  "productStatus",
  "composition",
  "country",
  "season",
  "gender",
  "category",
  "family",
]);

const PRODUCT_FIELDS_PULL = new Set([
  "name",
  "description",
  "dimensions",
  "isBestSeller",
  "productStatus",
  "composition",
  // 2026-09-08 : ajout catégorie — résolution inverse via Category.pfsCategoryId
  // (matching la Category BJ locale qui pointe sur la même catégorie PFS).
  // Si aucune Category locale n'est mappée à la valeur PFS reçue, l'apply
  // lève une erreur claire et l'audit-auto skippe cet écart pour ce produit.
  "category",
]);

// `missingVariant` / `extraVariant` sont considérés comme des champs "variante"
// à part entière depuis 2026-07-24 : la modale d'écarts propose désormais
// d'ajouter/retirer une couleur des deux côtés (site ou PFS).
//   - `missingVariant` (côté nous, pas côté PFS) → push = "Ajouter sur PFS",
//     pull = "Retirer chez nous".
//   - `extraVariant`  (côté PFS, pas côté nous) → push = "Retirer de PFS",
//     pull = "Ajouter chez nous".
const VARIANT_FIELDS_PUSH = new Set([
  "price",
  "stock",
  "weight",
  "isActive",
  "missingVariant",
  "extraVariant",
]);
const VARIANT_FIELDS_PULL = new Set([
  "price",
  "stock",
  "weight",
  "isActive",
  "missingVariant",
  "extraVariant",
]);

/**
 * Legacy — le composant tooltip s'attendait à un seul helper "support Lot B".
 * On garde pour compat mais on préfère les 2 helpers spécialisés.
 */
export function isFieldSupportedLotB(
  scope: "product" | "color",
  field: string,
): boolean {
  return isPushSupportedLotB(scope, field) || isPullSupportedLotB(scope, field);
}

export function isPushSupportedLotB(scope: "product" | "color", field: string) {
  if (scope === "product") return PRODUCT_FIELDS_PUSH.has(field);
  return VARIANT_FIELDS_PUSH.has(field);
}
export function isPullSupportedLotB(scope: "product" | "color", field: string) {
  if (scope === "product") return PRODUCT_FIELDS_PULL.has(field);
  return VARIANT_FIELDS_PULL.has(field);
}

// ─── Clé d'écart (client + serveur) ────────────────────────────────────────

export function issueKey(iss: PfsVerifyIssue): string {
  // 5ᵉ segment optionnel = pfsVariantId. Permet de router l'apply push/pull
  // vers LA bonne ProductColor / variante PFS quand plusieurs PC UNIT partagent
  // la même couleur (legacy 10037/10039 Issyma : 1 PC par taille, chacune sa
  // variante PFS). Sans cet id, `findLocalVariant` retomberait sur la première
  // PC matchant (colorRef, variantType) et écraserait la mauvaise taille.
  const parts: string[] = [iss.scope, iss.field, iss.colorRef ?? "", iss.variantType ?? ""];
  if (iss.pfsVariantId) parts.push(iss.pfsVariantId);
  return parts.join(":");
}

// ─── Comptage des écarts corrigeables par pull (client + serveur) ──────────

/**
 * Compte les écarts d'un produit qui peuvent être corrigés automatiquement
 * via un pull PFS → site. Un écart est corrigeable si :
 *   - le champ est dans la whitelist Lot B (`isPullSupportedLotB`) ET
 *   - le serveur n'a pas posé de blocage ad hoc (`pullBlocked`).
 *
 * Utilisé par l'audit PFS (modale + bouton « Tout modifier ») pour n'appeler
 * `applyPfsVerifyPullsOnly` que sur des produits qui ont au moins un écart
 * automatiquement corrigeable.
 */
export function countPullableIssues(issues: PfsVerifyIssue[]): number {
  let n = 0;
  for (const iss of issues) {
    if (iss.pullBlocked) continue;
    if (!isPullSupportedLotB(iss.scope, iss.field)) continue;
    n++;
  }
  return n;
}
