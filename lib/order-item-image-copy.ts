import path from "node:path";
import { copyFile, keyFromDbPath, orderImageDir, statFile } from "@/lib/storage";

/**
 * Copie la miniature d'un OrderItem vers un dossier propre à la commande.
 *
 * Objectif : rendre chaque commande autonome des fiches produit, pour que la
 * suppression d'une variante (ou d'un produit entier) ne casse plus la trace
 * visuelle de la commande.
 *
 * Best-effort :
 *  - si `sourceDbPath` est null → retourne null (rien à copier)
 *  - si le fichier source a déjà disparu du disque → retourne null (on garde
 *    l'ancien chemin en base, la vignette affichera un placeholder mais toutes
 *    les infos texte de la ligne restent intactes)
 *  - si l'imagePath pointe déjà vers le dossier commandes/ → no-op (idempotent
 *    pour rejouer le script rétroactif sans double-copie)
 *
 * Retourne le nouveau `dbPath` (`/uploads/{tenant}/commandes/{orderNumber}/{itemId}.webp`)
 * ou `null` si aucune copie n'a été faite.
 */
export async function copyOrderItemImageToOrderDir(params: {
  sourceDbPath: string | null;
  orderNumber: string;
  orderItemId: string;
  tenantSlug: string;
}): Promise<string | null> {
  const { sourceDbPath, orderNumber, orderItemId, tenantSlug } = params;
  if (!sourceDbPath) return null;

  const destDir = orderImageDir(orderNumber, tenantSlug);
  // Idempotent : si le chemin pointe déjà vers le dossier de la commande, on
  // ne fait rien. Cas rencontré quand le script rétroactif tourne 2 fois.
  if (sourceDbPath.includes(`/${destDir}/`)) return null;

  const srcKey = keyFromDbPath(sourceDbPath);
  const srcStat = await statFile(srcKey);
  if (!srcStat) return null;

  const ext = path.extname(sourceDbPath) || ".webp";
  const destKey = `${destDir}/${orderItemId}${ext}`;

  await copyFile(srcKey, destKey);
  return `/${destKey}`;
}
