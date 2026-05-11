/**
 * Helpers liés à la marque PFS sélectionnée.
 *
 * La marque est OBLIGATOIRE pour toute opération PFS (publish, refresh,
 * update, import). Sans marque, on bloque proprement avec un message
 * clair plutôt que de retomber sur un nom par défaut.
 */

import { getCachedPfsBrand } from "@/lib/cached-data";

export class PfsBrandRequiredError extends Error {
  constructor() {
    super(
      "Aucune marque PFS sélectionnée. Allez dans Admin > Paramètres > Marketplaces pour choisir une marque avant d'utiliser Paris Fashion Shop.",
    );
    this.name = "PfsBrandRequiredError";
  }
}

/**
 * Récupère la marque PFS sélectionnée ou lève une erreur claire.
 * À appeler en tête de toute opération qui doit envoyer/recevoir
 * des données PFS.
 */
export async function requirePfsBrand(): Promise<{ id: string; name: string }> {
  const brand = await getCachedPfsBrand();
  if (!brand) throw new PfsBrandRequiredError();
  return brand;
}
