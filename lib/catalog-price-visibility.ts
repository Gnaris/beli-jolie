import type { CatalogPriceVisibility } from "@prisma/client";
import type { Session } from "next-auth";
import { canSeePrices } from "./price-visibility";

/**
 * Résout l'affichage des prix sur la page publique d'un catalogue partagé.
 *
 * La règle est lue **côté serveur** depuis `Catalog.priceVisibility` : un
 * visiteur ne peut jamais forcer l'affichage en manipulant l'URL ou un
 * cookie — la valeur ne transite pas par le client.
 *
 * - `SHOW` : prix visibles pour tout le monde, même les visiteurs anonymes
 *   (utile pour un catalogue purement marketing partagé sur les réseaux).
 * - `HIDE` : prix cachés pour tout le monde, même les clients APPROVED
 *   (utile pour envoyer un catalogue « inspiration » sans prix).
 * - `CONNECTED_ONLY` : prix visibles uniquement si le visiteur est un
 *   client APPROVED ou un ADMIN — comportement standard du site.
 */
export function resolveCatalogShowPrices(
  visibility: CatalogPriceVisibility,
  session: Session | null | undefined,
): boolean {
  if (visibility === "HIDE") return false;
  if (visibility === "SHOW") return true;
  return canSeePrices(session);
}
