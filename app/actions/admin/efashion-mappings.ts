"use server";

/**
 * Server actions pour gérer le mapping des bibliothèques BJ vers les IDs eFashion.
 *
 * 1 action de lecture (`loadEfashionAnnexes`) + 1 action par entité pour mettre
 * à jour le mapping (Category, ManufacturingCountry, Season, Composition).
 *
 * Les tailles ne sont pas mappées : eFashion résout la « déclinaison » (série
 * de tailles) dynamiquement à la publication (cf.
 * `lib/efashion-declinaison-matcher.ts`).
 *
 * `Color.efashionColorId` n'a pas d'action dédiée : il se remplit automatiquement
 * lors de la liaison manuelle d'un produit (cf. `linkEfashionProductManually`).
 * Une action `updateColorEfashionMapping` est tout de même exposée pour les
 * corrections manuelles.
 */

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  getEfashionAnnexes,
  searchEfashionCompositions,
  type EfashionAnnexes,
} from "@/lib/efashion-annexes";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Non autorisé");
}

// ─── Lecture des annexes (côté client UI) ──────────────────────────────────

export async function loadEfashionAnnexes(): Promise<
  | { success: true; data: EfashionAnnexes }
  | { success: false; error: string }
> {
  try {
    await requireAdmin();
    const data = await getEfashionAnnexes();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Erreur" };
  }
}

export async function searchEfashionCompositionsAction(
  term: string,
): Promise<{ success: boolean; results?: Array<{ id: number; label: string }>; error?: string }> {
  try {
    await requireAdmin();
    const results = await searchEfashionCompositions(term);
    return { success: true, results };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Erreur" };
  }
}

// ─── Updates (1 par entité) ────────────────────────────────────────────────

export async function updateCategoryEfashionMapping(
  categoryId: string,
  efashionCategorieId: number | null,
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    await prisma.category.update({
      where: { id: categoryId },
      data: { efashionCategorieId },
    });
    revalidatePath("/admin/categories");
    revalidateTag("categories", "default");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

export async function updateManufacturingCountryEfashionMapping(
  countryId: string,
  efashionProvenanceId: number | null,
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    await prisma.manufacturingCountry.update({
      where: { id: countryId },
      data: { efashionProvenanceId },
    });
    revalidatePath("/admin/pays");
    revalidateTag("manufacturing-countries", "default");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

export async function updateSeasonEfashionMapping(
  seasonId: string,
  efashionCollectionId: number | null,
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    await prisma.season.update({
      where: { id: seasonId },
      data: { efashionCollectionId },
    });
    revalidatePath("/admin/saisons");
    revalidateTag("seasons", "default");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

export async function updateCompositionEfashionMapping(
  compositionId: string,
  efashionId: number | null,
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    await prisma.composition.update({
      where: { id: compositionId },
      data: { efashionId },
    });
    revalidatePath("/admin/compositions");
    revalidateTag("compositions", "default");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

export async function updateColorEfashionMapping(
  colorId: string,
  efashionColorId: number | null,
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    await prisma.color.update({
      where: { id: colorId },
      data: { efashionColorId },
    });

    // Toujours tenter l'ajout au catalogue vendeur eFashion (silencieux si déjà
    // dans le catalogue). Cohérent avec le comportement de createColorQuick.
    if (efashionColorId) {
      try {
        const { efashionGetMe } = await import("@/lib/efashion-api");
        const { efashionAddCouleurToVendeur } = await import("@/lib/efashion-api-write");
        const me = await efashionGetMe();
        await efashionAddCouleurToVendeur({
          id_vendeur: me.id_vendeur,
          id_couleur: efashionColorId,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/déjà dans votre catalogue/i.test(msg)) {
          const { logger } = await import("@/lib/logger");
          logger.warn("[eFashion] addCouleurToVendeur failed at color mapping update", {
            colorId,
            efashionColorId,
            error: msg,
          });
        }
      }
      revalidateTag("efashion-annexes", "default");
    }

    revalidatePath("/admin/couleurs");
    revalidateTag("colors", "default");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

/**
 * Ajoute une couleur du catalogue maître eFashion au catalogue vendeur.
 * Indispensable avant de pouvoir utiliser cette couleur dans une création produit.
 */
export async function addEfashionColorToVendor(
  efashionColorId: number,
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    const { efashionGetMe } = await import("@/lib/efashion-api");
    const { efashionAddCouleurToVendeur } = await import("@/lib/efashion-api-write");
    const me = await efashionGetMe();
    await efashionAddCouleurToVendeur({
      id_vendeur: me.id_vendeur,
      id_couleur: efashionColorId,
    });
    // Invalide le cache des annexes pour que la nouvelle couleur apparaisse comme "in catalog"
    revalidateTag("efashion-annexes", "default");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

/**
 * Force le rechargement des annexes eFashion (utile si on a ajouté une
 * catégorie / déclinaison côté eFashion entretemps).
 */
export async function refreshEfashionAnnexes(): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    revalidateTag("efashion-annexes", "default");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}
