"use server";

/**
 * Server actions déclenchées par la modale « X produits impactés sur
 * {Marketplace} » (`MappingChangeImpactModal`) après qu'un admin a modifié le
 * mapping marketplace d'un attribut (saison / catégorie / couleur /
 * composition) dans /admin/{saisons|categories|couleurs|compositions}.
 *
 *   - `loadImpactedProductsForSync` : renvoie les méta produits à enqueuer
 *     côté client (le bouton « Synchroniser maintenant » pousse ensuite via
 *     `useMarketplaceRefreshQueue().enqueue`).
 *   - `markImpactedProductsSyncRequired` : pose le drapeau `{mp}SyncRequired`
 *     sur les produits impactés — badge orange, resync manuelle plus tard.
 *   - `rollbackMappingChange` : bouton « Ignorer » — revient à l'ancienne
 *     valeur du mapping en base pour ne pas laisser de désynchro silencieuse.
 */

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  analyzeMappingImpact,
  marketplaceSyncRequiredField,
  type MappingAttribute,
  type MappingMarketplace,
  type MappingImpactedProduct,
} from "@/lib/mapping-impact";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Accès non autorisé.");
}

/**
 * Recharge la liste complète des produits impactés (id + méta) pour que le
 * client enqueue une resync. Séparé du retour de la server action de mapping
 * pour éviter de sérialiser N produits à chaque save (rare qu'on clique
 * ensuite sur « Synchroniser »).
 */
export async function loadImpactedProductsForSync(
  attribute: MappingAttribute,
  marketplace: MappingMarketplace,
  localId: string,
): Promise<
  | { success: true; products: MappingImpactedProduct[] }
  | { success: false; error: string }
> {
  try {
    await requireAdmin();
    const impact = await analyzeMappingImpact({ attribute, marketplace, localId });
    return { success: true, products: impact.products };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Erreur" };
  }
}

/**
 * Pose `pfsSyncRequired = true` (ou eq. eFashion / Faire) sur tous les
 * produits publiés sur le marketplace concerné qui utilisent l'attribut
 * modifié. Le badge orange apparaîtra dans le tableau produits.
 */
export async function markImpactedProductsSyncRequired(
  attribute: MappingAttribute,
  marketplace: MappingMarketplace,
  localId: string,
): Promise<{ success: true; count: number } | { success: false; error: string }> {
  try {
    await requireAdmin();
    const impact = await analyzeMappingImpact({ attribute, marketplace, localId });
    if (impact.count === 0) return { success: true, count: 0 };

    const field = marketplaceSyncRequiredField(marketplace);
    await prisma.product.updateMany({
      where: { id: { in: impact.products.map((p) => p.id) } },
      data: { [field]: true },
    });

    revalidateTag("products", "default");
    revalidatePath("/admin/produits");
    return { success: true, count: impact.count };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Erreur" };
  }
}

/**
 * Bouton « Ignorer » : rétablit l'ancienne valeur du mapping en base, pour
 * éviter que la modification silencieuse ne s'installe et désynchronise le
 * marketplace au premier resync.
 *
 * `rollbackFields` porte les colonnes à ré-écrire sur le modèle
 * d'attribut (ex : `{ pfsRef: "PE2026" }` pour Season/PFS, ou
 * `{ pfsGender: "Femme", pfsFamilyName: "Bijoux", pfsCategoryName: "Bagues" }`
 * pour Category/PFS qui porte plusieurs champs).
 */
export async function rollbackMappingChange(
  attribute: MappingAttribute,
  localId: string,
  rollbackFields: Record<string, string | number | null>,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    await requireAdmin();
    switch (attribute) {
      case "season":
        await prisma.season.update({ where: { id: localId }, data: rollbackFields });
        revalidateTag("seasons", "default");
        revalidatePath("/admin/saisons");
        break;
      case "category":
        await prisma.category.update({ where: { id: localId }, data: rollbackFields });
        revalidateTag("categories", "default");
        revalidatePath("/admin/categories");
        break;
      case "color":
        await prisma.color.update({ where: { id: localId }, data: rollbackFields });
        revalidateTag("colors", "default");
        revalidatePath("/admin/couleurs");
        break;
      case "composition":
        await prisma.composition.update({ where: { id: localId }, data: rollbackFields });
        revalidateTag("compositions", "default");
        revalidatePath("/admin/compositions");
        break;
    }
    revalidatePath("/admin/produits");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Erreur" };
  }
}
