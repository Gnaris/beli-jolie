/**
 * Helpers du flow d'import en masse d'images.
 *
 * Extraits dans un module séparé pour pouvoir les tester sans monter le
 * composant React `ImportImagesTab` (qui est "use client" et tire next-intl,
 * fetch global, etc.).
 */

export interface ParsedImageFilename {
  reference: string;
  color: string;
  position: number;
}

/**
 * Parse un nom de fichier image au format Beli & Jolie :
 *   "REF COULEUR POSITION.ext"  (séparateurs espace)
 *   "REF_COULEUR_POSITION.ext"  (séparateurs underscore)
 * Position doit être un entier entre 1 et 10.
 * Retourne null si le format n'est pas reconnu.
 */
export function parseImageFilename(filename: string): ParsedImageFilename | null {
  const extIdx = filename.lastIndexOf(".");
  const base = extIdx >= 0 ? filename.slice(0, extIdx) : filename;

  let reference: string;
  let color: string;
  let positionStr: string;

  if (base.includes("_")) {
    const firstUnderscore = base.indexOf("_");
    const lastUnderscore = base.lastIndexOf("_");
    if (firstUnderscore === lastUnderscore) return null;
    reference = base.slice(0, firstUnderscore);
    color = base.slice(firstUnderscore + 1, lastUnderscore);
    positionStr = base.slice(lastUnderscore + 1);
  } else {
    const parts = base.split(" ").filter(Boolean);
    if (parts.length < 3) return null;
    reference = parts[0];
    positionStr = parts[parts.length - 1];
    color = parts.slice(1, parts.length - 1).join(" ");
  }

  const position = parseInt(positionStr, 10);
  if (isNaN(position) || position < 1 || position > 10) return null;
  reference = reference.trim().toUpperCase();
  color = color.trim();
  if (!reference || !color) return null;
  return { reference, color, position };
}

/**
 * Sépare une liste de fichiers en « à importer » et « ignorés ».
 *
 * Un fichier est ignoré si :
 *  - son nom n'est pas un format valide (parseImageFilename retourne null), ou
 *  - sa référence figure dans `missingRefFilenames` (référence inconnue en BDD,
 *    information donnée par /api/admin/products/import/images/check-conflicts).
 *
 * Pourquoi : la cliente a demandé que les introuvables soient ignorés
 * silencieusement au lancement de l'import — pas comptés comme erreurs.
 */
export function partitionImportableImages<T extends { name: string }>(
  files: T[],
  missingRefFilenames: Iterable<string>,
): { toImport: T[]; ignored: T[] } {
  const missing = new Set(missingRefFilenames);
  const toImport: T[] = [];
  const ignored: T[] = [];
  for (const f of files) {
    if (missing.has(f.name) || !parseImageFilename(f.name)) {
      ignored.push(f);
    } else {
      toImport.push(f);
    }
  }
  return { toImport, ignored };
}
