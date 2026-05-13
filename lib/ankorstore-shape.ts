/**
 * Construction du bloc `shape_properties` envoyé à Ankorstore.
 *
 * - Le poids est en kg, SANS `unit_code` : Ankorstore applique "kg" par défaut
 *   côté plateforme et envoyer l'unité explicitement provoque un affichage
 *   dupliqué dans leur backoffice.
 * - Les dimensions sont en cm, AVEC `unit_code: "cm"` explicite (la valeur
 *   par défaut côté Ankorstore n'est pas documentée). On n'inclut que les
 *   axes effectivement renseignés côté produit.
 * - Si rien n'est renseigné (ni poids ni aucune dimension), on retourne
 *   `undefined` pour ne pas envoyer le bloc vide.
 */

export interface AnkorstoreShapeBlock {
  weight?: { amount: number };
  dimensions?: {
    unitCode: "cm";
    width?: number;
    height?: number;
    length?: number;
  };
}

export interface DimensionsInput {
  length: number | null;
  width: number | null;
  height: number | null;
}

function positiveOrUndefined(v: number | null | undefined): number | undefined {
  if (v == null) return undefined;
  if (!Number.isFinite(v)) return undefined;
  if (v <= 0) return undefined;
  return v;
}

export function buildAnkorstoreShapeProperties(
  weightKg: number | null | undefined,
  dims: DimensionsInput,
): AnkorstoreShapeBlock | undefined {
  const weight = positiveOrUndefined(weightKg);
  const length = positiveOrUndefined(dims.length);
  const width = positiveOrUndefined(dims.width);
  const height = positiveOrUndefined(dims.height);

  const hasDimensions = length != null || width != null || height != null;

  if (weight == null && !hasDimensions) return undefined;

  const block: AnkorstoreShapeBlock = {};

  if (weight != null) {
    block.weight = { amount: weight };
  }

  if (hasDimensions) {
    block.dimensions = {
      unitCode: "cm",
      ...(length != null ? { length } : {}),
      ...(width != null ? { width } : {}),
      ...(height != null ? { height } : {}),
    };
  }

  return block;
}
