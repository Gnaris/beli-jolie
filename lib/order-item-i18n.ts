/**
 * Résolution du nom produit affiché sur une ligne de commande selon la locale.
 *
 * Priorité (du plus précis au plus permissif) :
 *   1. `productNameI18n[locale]` — snapshot localisé figé à la création de la
 *      commande. Fiable même si le produit a été renommé/supprimé depuis.
 *   2. `ProductTranslation` lookup dynamique via `productRef` — pour les
 *      commandes antérieures à la feature de snapshot, OU quand une traduction
 *      a été ajoutée après la commande (règle d'ouverture : les anciennes
 *      commandes bénéficient aussi des nouvelles traductions tant qu'elles
 *      sont demandées via lookup).
 *   3. Fallback `productName` — nom FR snapshot, toujours présent.
 */

export interface OrderItemLikeForName {
  productName: string;
  productNameI18n?: unknown;
  productRef: string;
}

/** Lookup d'une entrée JSON `{ fr?, en?, de?, it?, es? }` pour une locale donnée. */
export function pickFromI18n(
  i18n: unknown,
  locale: string,
): string | null {
  if (!i18n || typeof i18n !== "object") return null;
  const value = (i18n as Record<string, unknown>)[locale];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

/**
 * Résolution complète. Les callers qui n'ont pas chargé les
 * `ProductTranslation` passent `translationLookup: null` — on utilise alors
 * uniquement le snapshot i18n puis le fallback FR.
 */
export function resolveOrderItemName(
  item: OrderItemLikeForName,
  locale: string,
  translationLookup?: Map<string, string> | null,
): string {
  // Locale FR : toujours renvoyer le snapshot FR (c'est le nom au moment de
  // la commande, utile pour l'historique).
  if (locale === "fr") return item.productName;

  // 1. Snapshot i18n
  const fromSnapshot = pickFromI18n(item.productNameI18n, locale);
  if (fromSnapshot) return fromSnapshot;

  // 2. Lookup dynamique via productRef → ProductTranslation (si fourni)
  if (translationLookup) {
    const fromLookup = translationLookup.get(item.productRef);
    if (fromLookup && fromLookup.trim()) return fromLookup;
  }

  // 3. Fallback FR snapshot
  return item.productName;
}

/**
 * Prépare un `Map<productRef, name>` pour une liste de refs produits et une
 * locale cible. À appeler côté serveur avant le rendu d'une page de commande,
 * pour alimenter le 3ᵉ niveau de fallback du helper.
 */
export async function buildTranslationLookupByRef(
  prismaClient: {
    product: {
      findMany: (args: {
        where: { reference: { in: string[] } };
        select: { reference: true; translations: { select: { locale: true; name: true } } };
      }) => Promise<Array<{ reference: string; translations: Array<{ locale: string; name: string }> }>>;
    };
  },
  productRefs: string[],
  locale: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (locale === "fr" || productRefs.length === 0) return out;
  const uniqueRefs = Array.from(new Set(productRefs));
  const products = await prismaClient.product.findMany({
    where: { reference: { in: uniqueRefs } },
    select: {
      reference: true,
      translations: { select: { locale: true, name: true } },
    },
  });
  for (const p of products) {
    const t = p.translations.find((x) => x.locale === locale);
    if (t?.name?.trim()) out.set(p.reference, t.name.trim());
  }
  return out;
}
