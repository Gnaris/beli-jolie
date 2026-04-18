/**
 * PFS taxonomy static data — extracted from "Modèle PFS.xlsx" ANNEXE sheets.
 * Used to render human-readable labels in the Excel export (PFS uploader expects names, not Salesforce IDs).
 */

export const PFS_GENDER_LABELS: Record<string, string> = {
  WOMAN: "Femme",
  MAN: "Homme",
  KID: "Enfant",
  SUPPLIES: "Lifestyle_et_Plus",
};

export function pfsGenderLabel(code: string | null | undefined): string {
  if (!code) return "";
  return PFS_GENDER_LABELS[code] ?? code;
}

/**
 * Valid family names per gender (reference — not currently enforced).
 * Kept for documentation/validation purposes.
 */
export const PFS_FAMILIES_BY_GENDER: Record<string, string[]> = {
  Femme: [
    "Accessoires", "Beauté", "Bijoux_Fantaisie", "Chaussures",
    "Grandes_Tailles", "Lingerie", "Maroquinerie", "Vêtements",
  ],
  Homme: [
    "Accessoires_H", "Beauté_H", "Bijoux_H", "Chaussures_H",
    "Maroquinerie_H", "Sous_Vêtements", "Vêtements_H",
  ],
  Enfant: [
    "Fille", "Garçon", "Bébé", "Accessoires_K",
    "Maroquinerie_K", "Bijoux_Fantaisie_K", "Montres_K",
  ],
  Lifestyle_et_Plus: [
    "Emballages", "Fête_et_Décorations", "Lifestyle",
    "Matériel_Boutique", "Uniformes_Professionnels",
  ],
};
