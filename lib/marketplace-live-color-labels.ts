/**
 * Extraction du nom de couleur "vu la dernière fois côté marketplace" pour
 * chaque variante liée d'un produit.
 *
 * Alimenté par les snapshots `*LastSyncSnapshot` posés à la fin de chaque
 * synchronisation réussie. Sert à la section « Mapping Marketplaces » de la
 * fiche produit pour afficher, pour chaque variante liée, le libellé réel
 * stocké côté marketplace — indépendamment d'un override que l'admin aurait
 * changé localement sans avoir encore resynchronisé.
 *
 * Fallback : si le snapshot est absent (produit lié sans sync réussie récente),
 * on ne renseigne rien pour la variante et le composant client fera son
 * meilleur effort avec le mapping courant.
 */

import type { PfsSyncSnapshot } from "@/lib/pfs-sync-diff";
import type { FaireSyncSnapshot } from "@/lib/faire-sync-diff";
// Type minimal repris du legacy pour ne pas casser la lecture du snapshot BJ existant.
type AnkorstoreSyncSnapshot = {
  variants?: Array<{ ankorsVariantId?: string | null; ankorsColorName?: string | null }>;
};
import type { PfsColorOption } from "@/components/admin/products/ColorVariantManager";

/**
 * Libellé marketplace-side par variante liée, une entrée par marketplace.
 *
 * - `pfs` : indexé par `pfsVariantId` (string). Valeur = label FR de la couleur
 *   PFS trouvée dans la biblio, avec la ref entre parenthèses.
 * - `ankor` : indexé par `ankorsVariantId` (string). Valeur = texte envoyé.
 * - `faire` : indexé par `faireVariantId` (string). Valeur = `colorOption`.
 * - `efashion` : le snapshot eFashion ne stocke pas la couleur ; on renvoie
 *   toujours une map vide et le composant client retombe sur l'effectif.
 */
export interface LiveMarketplaceColorLabels {
  pfs: Record<string, string>;
  ankor: Record<string, string>;
  faire: Record<string, string>;
  efashion: Record<number, string>;
}

export function extractLiveMarketplaceColorLabels(input: {
  pfsSnapshot: unknown;
  ankorsSnapshot: unknown;
  faireSnapshot: unknown;
  pfsColorOptions: PfsColorOption[];
}): LiveMarketplaceColorLabels {
  return {
    pfs: extractPfs(input.pfsSnapshot, input.pfsColorOptions),
    ankor: extractAnkor(input.ankorsSnapshot),
    faire: extractFaire(input.faireSnapshot),
    efashion: {},
  };
}

function extractPfs(
  raw: unknown,
  pfsColorOptions: PfsColorOption[],
): Record<string, string> {
  const out: Record<string, string> = {};
  const snap = coerce<PfsSyncSnapshot>(raw);
  if (!snap?.variants) return out;
  const byRef = new Map(pfsColorOptions.map((o) => [o.ref, o.label]));
  for (const [variantId, v] of Object.entries(snap.variants)) {
    const ref = v?.colorRef;
    if (!ref) continue;
    const label = byRef.get(ref);
    out[variantId] = label ? `${label} (${ref})` : ref;
  }
  return out;
}

function extractAnkor(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const snap = coerce<AnkorstoreSyncSnapshot>(raw);
  if (!snap?.variants) return out;
  for (const [variantId, v] of Object.entries(snap.variants)) {
    const name = v?.optionColor?.trim();
    if (name) out[variantId] = name;
  }
  return out;
}

function extractFaire(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const snap = coerce<FaireSyncSnapshot>(raw);
  if (!snap?.variants) return out;
  for (const v of Object.values(snap.variants)) {
    const vid = v?.faireVariantId;
    const name = v?.colorOption?.trim();
    if (vid && name) out[vid] = name;
  }
  return out;
}

function coerce<T>(raw: unknown): T | null {
  if (!raw || typeof raw !== "object") return null;
  return raw as T;
}
