/**
 * Tables d'auto-mapping des bibliothèques BJ → IDs eFashion.
 *
 * Construites manuellement à partir des référentiels eFashion vérifiés en
 * production (`getEfashionAnnexes`) et validés avec la cliente :
 *  - Catégories : tous les bijoux sous « Accessoires > Bijoux > … » ;
 *    Présentoir/Sacs/Pochettes/Présentoirs nus → « Accessoires > Autres > Présentoir » ;
 *    Lunettes → « Accessoires > Autres > Lunettes » ; vêtements ignorés.
 *  - Saison : Printemps/Été 2026 → « Toutes les saisons » (3).
 *  - Matières : Acier et Acier inoxydable → Inox (182), Laiton → Métal (47).
 *  - Couleurs : 34 matchent directement le catalogue vendeur ; 8 existent chez
 *    eFashion mais doivent être ajoutées au catalogue vendeur via
 *    `efashionAddCouleurToVendeur` avant utilisation (drapeau `needsVendorAdd`).
 *
 * Utilisé par `scripts/efashion-automap-libraries.ts`. Pas de logique métier ici
 * — uniquement des données + un lookup case/accent-insensible.
 */

export interface EfashionLibraryMappingEntry {
  /** Nom BJ exact (avant normalisation). Sert au log. */
  name: string;
  /** ID eFashion correspondant. */
  efashionId: number;
}

export interface EfashionColorMappingEntry extends EfashionLibraryMappingEntry {
  /** True si la couleur existe chez eFashion mais doit d'abord être ajoutée
   *  au catalogue du vendeur via `addCouleurToVendeur` avant d'être utilisable. */
  needsVendorAdd: boolean;
}

/** Normalise un nom : NFD + suppression diacritiques + lowercase + trim. */
export function normalizeLibraryName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Recherche un mapping dans une table en comparant les noms normalisés. */
export function findEfashionMapping<T extends EfashionLibraryMappingEntry>(
  name: string,
  table: T[],
): T | null {
  const needle = normalizeLibraryName(name);
  return table.find((e) => normalizeLibraryName(e.name) === needle) ?? null;
}

// ─── Catégories ─────────────────────────────────────────────────────────────

export const EFASHION_CATEGORY_MAPPING: EfashionLibraryMappingEntry[] = [
  // Bijoux → Accessoires > Bijoux > …
  { name: "Bagues", efashionId: 160101 },
  { name: "Boucles d'oreilles", efashionId: 160102 },
  { name: "Bracelets", efashionId: 160103 },
  { name: "Broches", efashionId: 160111 },
  { name: "Chaînes de cheville", efashionId: 160108 },
  { name: "Colliers", efashionId: 160104 },
  { name: "Parures de bijoux", efashionId: 160109 },
  { name: "Pendentifs", efashionId: 160110 },
  { name: "Piercings", efashionId: 160105 },
  { name: "Porte-clés", efashionId: 160107 },
  // Non-bijoux avec produits → Accessoires > Autres > …
  { name: "Lots avec présentoir", efashionId: 160412 },
  { name: "Présentoirs et rangements nus", efashionId: 160412 },
  { name: "Sacs", efashionId: 160412 },
  { name: "Boîtes & Pochettes", efashionId: 160412 },
  { name: "Lunettes", efashionId: 160402 },
  // Vêtements (Blouses, Chemises, Robes, etc.) volontairement absents.
];

// ─── Pays ────────────────────────────────────────────────────────────────

export const EFASHION_COUNTRY_MAPPING: EfashionLibraryMappingEntry[] = [
  { name: "Chine", efashionId: 1 },
];

// ─── Saisons ─────────────────────────────────────────────────────────────

export const EFASHION_SEASON_MAPPING: EfashionLibraryMappingEntry[] = [
  // Printemps/Été 2026 → « Toutes les saisons » (choix de la cliente)
  { name: "Printemps/Été 2026", efashionId: 3 },
];

// ─── Matières ────────────────────────────────────────────────────────────

export const EFASHION_COMPOSITION_MAPPING: EfashionLibraryMappingEntry[] = [
  { name: "Acier", efashionId: 182 }, // Inox
  { name: "Acier inoxydable", efashionId: 182 }, // Inox
  { name: "Bois", efashionId: 95 },
  { name: "Laiton", efashionId: 47 }, // Métal (laiton absent chez eFashion)
  { name: "Métal", efashionId: 47 },
  { name: "Pierre", efashionId: 65 },
  { name: "Plastique", efashionId: 66 },
  { name: "Résine", efashionId: 29 },
  { name: "Tissu", efashionId: 61 },
];

// ─── Couleurs ────────────────────────────────────────────────────────────
// 34 déjà dans le catalogue vendeur (needsVendorAdd=false)
// 8 à ajouter via efashionAddCouleurToVendeur (needsVendorAdd=true)

export const EFASHION_COLOR_MAPPING: EfashionColorMappingEntry[] = [
  { name: "Argent", efashionId: 22, needsVendorAdd: false },
  { name: "Beige", efashionId: 6, needsVendorAdd: false },
  { name: "Bicolore", efashionId: 1590, needsVendorAdd: false },
  { name: "Blanc", efashionId: 16, needsVendorAdd: false },
  { name: "Bleu", efashionId: 3, needsVendorAdd: false },
  { name: "Bleu Ciel", efashionId: 69, needsVendorAdd: false },
  { name: "Bleu Clair", efashionId: 44, needsVendorAdd: true },
  { name: "Bleu Foncé", efashionId: 45, needsVendorAdd: false },
  { name: "Bordeaux", efashionId: 66, needsVendorAdd: false },
  { name: "Brun", efashionId: 611, needsVendorAdd: false },
  { name: "Brun foncé", efashionId: 1653, needsVendorAdd: true },
  { name: "Corail", efashionId: 7, needsVendorAdd: false },
  { name: "Cyan", efashionId: 1437, needsVendorAdd: true },
  { name: "Doré", efashionId: 78, needsVendorAdd: false },
  { name: "Écru", efashionId: 119, needsVendorAdd: false },
  { name: "Fuchsia", efashionId: 17, needsVendorAdd: false },
  { name: "Gris", efashionId: 15, needsVendorAdd: false },
  { name: "Gris Clair", efashionId: 38, needsVendorAdd: false },
  { name: "Gris Foncé", efashionId: 39, needsVendorAdd: false },
  { name: "Gris Perle", efashionId: 60, needsVendorAdd: true },
  { name: "Gris Souris", efashionId: 432, needsVendorAdd: true },
  { name: "Ivoire", efashionId: 90, needsVendorAdd: true },
  { name: "Jaune", efashionId: 12, needsVendorAdd: false },
  { name: "Kaki", efashionId: 33, needsVendorAdd: false },
  { name: "Léopard", efashionId: 135, needsVendorAdd: false },
  { name: "Marine", efashionId: 96, needsVendorAdd: false },
  { name: "Marron", efashionId: 19, needsVendorAdd: false },
  { name: "Marron Clair", efashionId: 48, needsVendorAdd: true },
  { name: "Marron Foncé", efashionId: 47, needsVendorAdd: true },
  { name: "Moutarde", efashionId: 61, needsVendorAdd: false },
  { name: "Multicolore", efashionId: 351, needsVendorAdd: false },
  { name: "Noir", efashionId: 5, needsVendorAdd: false },
  { name: "Orange", efashionId: 4, needsVendorAdd: false },
  { name: "Rose", efashionId: 1, needsVendorAdd: false },
  { name: "Rose Fluo", efashionId: 410, needsVendorAdd: false },
  { name: "Rouge", efashionId: 2, needsVendorAdd: false },
  { name: "Rouge Foncé", efashionId: 458, needsVendorAdd: false },
  { name: "Transparent", efashionId: 1364, needsVendorAdd: false },
  { name: "Turquoise", efashionId: 185, needsVendorAdd: false },
  { name: "Vert", efashionId: 10, needsVendorAdd: false },
  { name: "Vert Foncé", efashionId: 160, needsVendorAdd: false },
  { name: "Violet", efashionId: 11, needsVendorAdd: false },
];
