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
]);

const VARIANT_FIELDS_PUSH = new Set(["price", "stock", "weight", "isActive"]);
const VARIANT_FIELDS_PULL = new Set(["price", "stock", "weight", "isActive"]);

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
  return [iss.scope, iss.field, iss.colorRef ?? "", iss.variantType ?? ""].join(":");
}
