"use server";

import { getServerSession } from "next-auth";
import { revalidateTag } from "next/cache";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { setSiteConfig, unsetSiteConfig } from "@/lib/site-config-write";
import {
  PRODUCT_FAQ_DEFAULTS_KEY,
  generateFaqItemId,
  parseProductFaqDefaults,
  type ProductFaqDefault,
} from "@/lib/product-faq";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Non autorisé");
}

const MAX_ITEMS = 15;
const TITLE_MAX = 120;
const BODY_MAX = 2000;

const DefaultsItemInputSchema = z.object({
  id: z.string().trim().optional(),
  title: z.string(),
  body: z.string(),
});

const UpdateDefaultsSchema = z.object({
  items: z.array(DefaultsItemInputSchema).max(MAX_ITEMS),
});

/**
 * Remplace la liste des rubriques « Foire aux informations » par défaut pour
 * la boutique courante. Chaque item sans id reçoit un id stable généré ici
 * (côté serveur) pour éviter les collisions. Un titre vide (après trim)
 * supprime l'entrée. Liste vide = clé supprimée (= pas de FAI affichée).
 */
export async function updateProductFaqDefaults(
  input: unknown,
): Promise<{ success: boolean; error?: string; items?: ProductFaqDefault[] }> {
  try {
    await requireAdmin();
    const parsed = UpdateDefaultsSchema.safeParse(input);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return {
        success: false,
        error: first?.message ?? "Données invalides",
      };
    }

    const seenIds = new Set<string>();
    const cleaned: ProductFaqDefault[] = [];
    for (const raw of parsed.data.items) {
      const title = raw.title.trim().slice(0, TITLE_MAX);
      if (!title) continue;
      const body = raw.body.slice(0, BODY_MAX);
      let id = (raw.id ?? "").trim();
      if (!id || seenIds.has(id)) id = generateFaqItemId();
      seenIds.add(id);
      cleaned.push({ id, title, body });
    }

    if (cleaned.length === 0) {
      await unsetSiteConfig(PRODUCT_FAQ_DEFAULTS_KEY);
    } else {
      await setSiteConfig(PRODUCT_FAQ_DEFAULTS_KEY, JSON.stringify(cleaned));
    }
    revalidateTag("site-config", "default");
    revalidateTag("products", "default");
    return { success: true, items: cleaned };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Erreur",
    };
  }
}

const UpdateOverridesSchema = z.object({
  productId: z.string().min(1),
  overrides: z.record(z.string(), z.string()),
});

/**
 * Met à jour les surcharges FAI d'un produit. Clés vides (après trim) ne sont
 * pas stockées — le produit retombe sur le texte par défaut. Objet vide =
 * champ Prisma remis à null.
 */
export async function updateProductFaqOverrides(
  input: unknown,
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    const parsed = UpdateOverridesSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: "Données invalides" };
    }

    // Lire les ids valides depuis les défauts courants pour écarter les
    // orphelines à la source — évite d'accumuler du bruit dans la BDD.
    const row = await prisma.siteConfig.findFirst({
      where: { key: PRODUCT_FAQ_DEFAULTS_KEY },
    });
    const validIds = new Set(
      parseProductFaqDefaults(row?.value).map((d) => d.id),
    );

    const cleaned: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed.data.overrides)) {
      if (!validIds.has(key)) continue;
      const trimmed = value.trim();
      if (!trimmed) continue;
      cleaned[key] = value.slice(0, BODY_MAX);
    }

    const hasOverrides = Object.keys(cleaned).length > 0;
    await prisma.product.update({
      where: { id: parsed.data.productId },
      data: { faqOverrides: hasOverrides ? cleaned : Prisma.DbNull },
    });
    revalidateTag("products", "default");
    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Erreur",
    };
  }
}
