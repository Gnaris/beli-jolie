/**
 * Décision "conserver / remplacer" pour la synchro images Ankorstore.
 *
 * Contexte du bug corrigé (2026-08-14) : à chaque publish/update Ankor, le
 * code envoyait TOUJOURS des `file-upload:<hash>` fraîchement uploadés, même
 * quand les images n'avaient pas bougé côté boutique. Ankor accumule (ne
 * dédupe pas) — d'où doublons/triplés d'images visibles sur la fiche après
 * plusieurs syncs successifs (typiquement après plusieurs rotations auto de
 * la couleur principale).
 *
 * Cette fonction pure prend :
 *   - les paths BJ actuels (image produit-père + images de chaque variante)
 *   - le snapshot du dernier sync réussi (paths BJ envoyés la dernière fois)
 *   - l'état actuel chez Ankor (URLs `/products/images/…` par produit + par variante)
 * et décide, pour chaque scope, s'il faut :
 *   - `keep` : réutiliser les URLs Ankor telles quelles (aucun upload, filename
 *              existant réinjecté dans le PUT — Ankor préserve les images
 *              dont le filename commence par `/products/images/…`)
 *   - `replace` : uploader les paths BJ et écraser (nouveau `file-upload:<hash>`)
 *
 * L'appelant utilise ce plan pour :
 *   1. Uploader UNIQUEMENT les paths marqués "replace"
 *   2. Construire le payload d'images (URLs Ankor pour keep, keys upload pour replace)
 *   3. Après succès, persister `nextSnapshot` dans Product.ankorsLastSyncSnapshot
 *      pour la prochaine évaluation.
 */

export interface AnkorImageSnapshot {
  /** Path BJ de l'image produit-père envoyée la dernière fois (image de la
   *  couleur principale, ou null si le produit n'avait pas encore de photo). */
  productImagePath: string | null;
  /** Paths BJ par colorId, dans l'ordre envoyé lors du dernier sync. */
  colorImagePaths: Record<string, string[]>;
}

export interface AnkorCurrentImages {
  /** URLs images produit-père actuellement chez Ankor (format `/products/images/…`). */
  productImageUrls: string[];
  /** URLs images par colorId de la variante (matché via SKU côté appelant). */
  variantImageUrlsByColorId: Record<string, string[]>;
}

export interface BjColorImagesInput {
  colorId: string;
  imagePaths: string[];
}

export interface AnkorImageSyncInput {
  /** Path BJ de l'image produit-père à envoyer (celle de la couleur principale). */
  bjProductImagePath: string | null;
  /** Images BJ par variante active (avec colorId non-null). */
  bjColors: BjColorImagesInput[];
  /** Snapshot du dernier sync réussi. `null` = jamais synchronisé encore. */
  snapshot: AnkorImageSnapshot | null;
  /** État actuel chez Ankor (URLs à réutiliser si "keep"). */
  ankor: AnkorCurrentImages;
}

export type ScopeAction =
  | { action: "keep"; urls: string[] }
  | { action: "replace"; bjPaths: string[] }
  | { action: "none" };

export interface AnkorImageSyncPlan {
  productImage: ScopeAction;
  colors: Array<{ colorId: string } & ScopeAction>;
  /** Nouveau snapshot à persister APRÈS un sync réussi. */
  nextSnapshot: AnkorImageSnapshot;
  /** Paths BJ uniques à uploader (concat productImage + toutes couleurs "replace"). */
  pathsToUpload: string[];
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Décide, pour l'image produit-père et pour chaque variante, s'il faut
 * réutiliser ce qui est déjà chez Ankor ou uploader du neuf.
 */
export function computeAnkorImageSyncPlan(input: AnkorImageSyncInput): AnkorImageSyncPlan {
  const snapshot = input.snapshot;
  const uploadSet = new Set<string>();

  // ── Image produit-père ─────────────────────────────────────────────
  let productImage: ScopeAction;
  if (!input.bjProductImagePath) {
    // Pas de photo côté BJ (édge — produit sans image). On ne renvoie rien.
    productImage = { action: "none" };
  } else {
    const snapPath = snapshot?.productImagePath ?? null;
    const ankorHasImage = input.ankor.productImageUrls.length > 0;
    const unchanged = snapPath === input.bjProductImagePath;
    if (unchanged && ankorHasImage) {
      // On garde la 1ʳᵉ URL Ankor (l'image produit est unique).
      productImage = { action: "keep", urls: [input.ankor.productImageUrls[0]] };
    } else {
      productImage = { action: "replace", bjPaths: [input.bjProductImagePath] };
      uploadSet.add(input.bjProductImagePath);
    }
  }

  // ── Images par variante ────────────────────────────────────────────
  const colors: Array<{ colorId: string } & ScopeAction> = [];
  const nextColorImagePaths: Record<string, string[]> = {};

  for (const c of input.bjColors) {
    nextColorImagePaths[c.colorId] = c.imagePaths;

    if (c.imagePaths.length === 0) {
      colors.push({ colorId: c.colorId, action: "none" });
      continue;
    }

    const snapPaths = snapshot?.colorImagePaths?.[c.colorId] ?? [];
    const ankorUrls = input.ankor.variantImageUrlsByColorId[c.colorId] ?? [];
    const unchanged = arraysEqual(c.imagePaths, snapPaths);
    const ankorConsistent = ankorUrls.length === c.imagePaths.length;

    if (unchanged && ankorConsistent) {
      colors.push({ colorId: c.colorId, action: "keep", urls: ankorUrls });
    } else {
      colors.push({ colorId: c.colorId, action: "replace", bjPaths: c.imagePaths });
      for (const p of c.imagePaths) uploadSet.add(p);
    }
  }

  const nextSnapshot: AnkorImageSnapshot = {
    productImagePath: input.bjProductImagePath,
    colorImagePaths: nextColorImagePaths,
  };

  return {
    productImage,
    colors,
    nextSnapshot,
    pathsToUpload: Array.from(uploadSet),
  };
}
