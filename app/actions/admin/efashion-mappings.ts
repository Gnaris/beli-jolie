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
import {
  buildMappingImpactSummary,
  type MappingChangeSummary,
} from "@/lib/mapping-impact";

/**
 * Retour standard des 4 actions de mapping eFashion : succès avec un impact
 * marketplace éventuel (modale « X produits impactés ») ou échec.
 */
type EfashionMappingUpdateResult =
  | { success: true; impact: MappingChangeSummary | null }
  | { success: false; error: string };

/**
 * Résout le libellé humain d'une entrée eFashion (catégorie / saison /
 * composition / couleur) via les annexes cachées. Fallback `id N` si la
 * ressource n'est pas trouvable (annexes indisponibles ou id inconnu).
 */
async function resolveEfashionLabel(
  kind: "category" | "season" | "composition" | "color",
  id: number | null,
): Promise<string | null> {
  if (id == null) return null;
  try {
    const annexes = await getEfashionAnnexes();
    if (kind === "category") {
      const hit = annexes.categories.find((c) => c.id === id && c.isLeaf);
      return hit?.path ?? `id ${id}`;
    }
    if (kind === "season") {
      const hit = annexes.collections.find((c) => c.id === id);
      return hit?.label ?? `id ${id}`;
    }
    if (kind === "composition") {
      const hit = annexes.compositions.find((c) => c.id === id);
      return hit?.label ?? `id ${id}`;
    }
    const hit = annexes.colors.find((c) => c.id === id);
    return hit?.fr ?? `id ${id}`;
  } catch {
    return `id ${id}`;
  }
}

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
): Promise<EfashionMappingUpdateResult> {
  try {
    await requireAdmin();
    const before = await prisma.category.findUnique({
      where: { id: categoryId },
      select: { name: true, efashionCategorieId: true },
    });
    if (!before) return { success: false, error: "Catégorie introuvable." };

    await prisma.category.update({
      where: { id: categoryId },
      data: { efashionCategorieId },
    });
    revalidatePath("/admin/categories");
    revalidateTag("categories", "default");

    if (before.efashionCategorieId === efashionCategorieId) {
      return { success: true, impact: null };
    }
    const [oldLabel, newLabel] = await Promise.all([
      resolveEfashionLabel("category", before.efashionCategorieId),
      resolveEfashionLabel("category", efashionCategorieId),
    ]);
    const impact = await buildMappingImpactSummary({
      attribute: "category",
      marketplace: "efashion",
      localId: categoryId,
      localName: before.name,
      oldValueLabel: oldLabel,
      newValueLabel: newLabel,
      rollbackFields: { efashionCategorieId: before.efashionCategorieId },
    });
    return { success: true, impact };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}


export async function updateSeasonEfashionMapping(
  seasonId: string,
  efashionCollectionId: number | null,
): Promise<EfashionMappingUpdateResult> {
  try {
    await requireAdmin();
    const before = await prisma.season.findUnique({
      where: { id: seasonId },
      select: { name: true, efashionCollectionId: true },
    });
    if (!before) return { success: false, error: "Saison introuvable." };

    await prisma.season.update({
      where: { id: seasonId },
      data: { efashionCollectionId },
    });
    revalidatePath("/admin/saisons");
    revalidateTag("seasons", "default");

    if (before.efashionCollectionId === efashionCollectionId) {
      return { success: true, impact: null };
    }
    const [oldLabel, newLabel] = await Promise.all([
      resolveEfashionLabel("season", before.efashionCollectionId),
      resolveEfashionLabel("season", efashionCollectionId),
    ]);
    const impact = await buildMappingImpactSummary({
      attribute: "season",
      marketplace: "efashion",
      localId: seasonId,
      localName: before.name,
      oldValueLabel: oldLabel,
      newValueLabel: newLabel,
      rollbackFields: { efashionCollectionId: before.efashionCollectionId },
    });
    return { success: true, impact };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

export async function updateCompositionEfashionMapping(
  compositionId: string,
  efashionId: number | null,
): Promise<EfashionMappingUpdateResult> {
  try {
    await requireAdmin();
    const before = await prisma.composition.findUnique({
      where: { id: compositionId },
      select: { name: true, efashionId: true },
    });
    if (!before) return { success: false, error: "Composition introuvable." };

    await prisma.composition.update({
      where: { id: compositionId },
      data: { efashionId },
    });
    revalidatePath("/admin/compositions");
    revalidateTag("compositions", "default");

    if (before.efashionId === efashionId) {
      return { success: true, impact: null };
    }
    const [oldLabel, newLabel] = await Promise.all([
      resolveEfashionLabel("composition", before.efashionId),
      resolveEfashionLabel("composition", efashionId),
    ]);
    const impact = await buildMappingImpactSummary({
      attribute: "composition",
      marketplace: "efashion",
      localId: compositionId,
      localName: before.name,
      oldValueLabel: oldLabel,
      newValueLabel: newLabel,
      rollbackFields: { efashionId: before.efashionId },
    });
    return { success: true, impact };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

export async function updateColorEfashionMapping(
  colorId: string,
  efashionColorId: number | null,
): Promise<EfashionMappingUpdateResult> {
  try {
    await requireAdmin();
    const before = await prisma.color.findUnique({
      where: { id: colorId },
      select: { name: true, efashionColorId: true },
    });
    if (!before) return { success: false, error: "Couleur introuvable." };

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

    if (before.efashionColorId === efashionColorId) {
      return { success: true, impact: null };
    }
    const [oldLabel, newLabel] = await Promise.all([
      resolveEfashionLabel("color", before.efashionColorId),
      resolveEfashionLabel("color", efashionColorId),
    ]);
    const impact = await buildMappingImpactSummary({
      attribute: "color",
      marketplace: "efashion",
      localId: colorId,
      localName: before.name,
      oldValueLabel: oldLabel,
      newValueLabel: newLabel,
      rollbackFields: { efashionColorId: before.efashionColorId },
    });
    return { success: true, impact };
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
