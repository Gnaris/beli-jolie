"use server";
import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { clearAutoMaintenance } from "@/lib/health";
import type { ProductDisplayConfig } from "@/lib/product-display";
import { parseDisplayConfig } from "@/lib/product-display-shared";
import type { DisplaySection, HomepageCarousel } from "@/lib/product-display-shared";
import { encryptIfSensitive } from "@/lib/encryption";
import type { MarkupType, RoundingMode } from "@/lib/marketplace-pricing";
import { deleteFile, keyFromDbPath } from "@/lib/storage";
import { logger } from "@/lib/logger";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Non autorisé");
}

export async function updateMinOrderHT(value: number): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    if (value < 0) return { success: false, error: "Le montant doit être positif." };
    await prisma.siteConfig.upsert({
      where: { key: "min_order_ht" },
      update: { value: String(value) },
      create: { key: "min_order_ht", value: String(value) },
    });
    revalidatePath("/admin/parametres");
    revalidateTag("site-config", "default");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

export async function setMaintenanceMode(
  enabled: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    await prisma.siteConfig.upsert({
      where: { key: "maintenance_mode" },
      update: { value: String(enabled) },
      create: { key: "maintenance_mode", value: String(enabled) },
    });
    // If admin disables maintenance, also clear the auto-maintenance flag
    if (!enabled) {
      clearAutoMaintenance();
    }
    revalidatePath("/admin/parametres");
    revalidateTag("site-config", "default");
    revalidatePath("/api/site-status");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

export async function updateBusinessHours(schedule: {
  timezone: string;
  days: Record<string, { open: string; close: string; closed?: boolean }>;
}): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    await prisma.siteConfig.upsert({
      where: { key: "business_hours" },
      update: { value: JSON.stringify(schedule) },
      create: { key: "business_hours", value: JSON.stringify(schedule) },
    });
    revalidatePath("/admin/parametres");
    revalidateTag("site-config", "default");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

/**
 * Met à jour les textes SEO affichés sur la home et sur la page /produits.
 * Ces textes apparaissent côté visiteur (utiles pour Google) et sont éditables
 * dans Admin > Paramètres > onglet « Référencement ».
 *
 * Clés SiteConfig : `home_seo_text`, `produits_seo_text`. Une chaîne vide
 * supprime simplement le bloc côté front.
 */
export async function updateSeoTexts(input: {
  homeText: string;
  produitsText: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    const home = input.homeText.trim();
    const produits = input.produitsText.trim();
    const MAX = 5000;
    if (home.length > MAX || produits.length > MAX) {
      return { success: false, error: `Le texte ne doit pas dépasser ${MAX} caractères.` };
    }
    await Promise.all([
      prisma.siteConfig.upsert({
        where: { key: "home_seo_text" },
        update: { value: home },
        create: { key: "home_seo_text", value: home },
      }),
      prisma.siteConfig.upsert({
        where: { key: "produits_seo_text" },
        update: { value: produits },
        create: { key: "produits_seo_text", value: produits },
      }),
    ]);
    revalidatePath("/admin/parametres");
    revalidateTag("site-config", "default");
    revalidatePath("/", "layout");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

export async function updateStockDisplayConfig(config: {
  showOutOfStockVariants: boolean;
}): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    await prisma.siteConfig.upsert({
      where: { key: "show_out_of_stock_variants" },
      update: { value: String(config.showOutOfStockVariants) },
      create: { key: "show_out_of_stock_variants", value: String(config.showOutOfStockVariants) },
    });
    revalidatePath("/admin/parametres");
    revalidateTag("site-config", "default");
    revalidatePath("/produits");
    revalidatePath("/");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

/**
 * Met à jour la bannière d'accueil. La valeur stockée est le chemin public du
 * fichier large (`accueil-{stamp}.webp`) ; sa déclinaison medium
 * (`accueil-{stamp}-md.webp`) est déduite du même nom de base.
 *
 * Les anciens fichiers (large + medium) sont purgés du disque à chaque
 * remplacement ou effacement pour éviter l'accumulation dans
 * `public/uploads/banniere/`.
 */
export async function updateBannerImage(
  imagePath: string | null
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();

    const previousRow = await prisma.siteConfig.findUnique({
      where: { key: "banner_image" },
      select: { value: true },
    });
    const previousPath = previousRow?.value ?? null;

    if (imagePath) {
      await prisma.siteConfig.upsert({
        where: { key: "banner_image" },
        update: { value: imagePath },
        create: { key: "banner_image", value: imagePath },
      });
    } else {
      await prisma.siteConfig.deleteMany({ where: { key: "banner_image" } });
    }

    if (previousPath && previousPath !== imagePath) {
      const mediumPath = previousPath.replace(/\.webp$/i, "-md.webp");
      for (const dbPath of [previousPath, mediumPath]) {
        try {
          await deleteFile(keyFromDbPath(dbPath));
        } catch (err) {
          logger.warn("[updateBannerImage] Failed to delete old banner file", { path: dbPath, error: err });
        }
      }
    }

    revalidatePath("/admin/parametres");
    revalidateTag("site-config", "default");
    revalidatePath("/");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

/**
 * Met à jour le favicon (icône du site dans l'onglet du navigateur + résultats Google).
 *
 * `paths` doit contenir les chemins publics des deux PNG générés par l'API
 * d'upload (`/api/admin/favicon/image`) : `icon` (32×32) et `appleIcon` (180×180).
 * Passer `null` supprime la clé `site_favicon` → fallback sur le favicon généré
 * automatiquement à partir de la 1re lettre du `shopName`.
 *
 * Les anciens fichiers PNG sont supprimés du disque après remplacement ou
 * effacement pour éviter l'accumulation dans `public/uploads/favicon/`.
 */
export async function updateFavicon(
  paths: { icon: string; appleIcon: string } | null
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();

    // Read previous paths first so we can purge them from disk after the BDD swap.
    const previousRow = await prisma.siteConfig.findUnique({
      where: { key: "site_favicon" },
      select: { value: true },
    });
    let previous: { icon?: string; appleIcon?: string } | null = null;
    if (previousRow?.value) {
      try { previous = JSON.parse(previousRow.value); } catch { /* ignore corrupted JSON */ }
    }

    if (paths) {
      if (!paths.icon || !paths.appleIcon) {
        return { success: false, error: "Chemins d'image invalides." };
      }
      const value = JSON.stringify({ icon: paths.icon, appleIcon: paths.appleIcon });
      await prisma.siteConfig.upsert({
        where: { key: "site_favicon" },
        update: { value },
        create: { key: "site_favicon", value },
      });
    } else {
      await prisma.siteConfig.deleteMany({ where: { key: "site_favicon" } });
    }

    // Purge previous files (skip if they were just rewritten with the same path).
    const toDelete: string[] = [];
    if (previous?.icon && previous.icon !== paths?.icon) toDelete.push(previous.icon);
    if (previous?.appleIcon && previous.appleIcon !== paths?.appleIcon) toDelete.push(previous.appleIcon);
    for (const dbPath of toDelete) {
      try {
        await deleteFile(keyFromDbPath(dbPath));
      } catch (err) {
        // Non-blocking: log and continue. BDD is the source of truth, an orphan
        // file just wastes a few KB.
        logger.warn("[updateFavicon] Failed to delete old favicon file", { path: dbPath, error: err });
      }
    }

    revalidatePath("/admin/parametres");
    revalidateTag("site-config", "default");
    // Les metadata routes /icon et /apple-icon sont en force-dynamic, mais on
    // pousse quand même une invalidation explicite pour les CDN intermédiaires.
    revalidatePath("/icon");
    revalidatePath("/apple-icon");
    revalidatePath("/manifest.webmanifest");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

export async function updateEasyExpressApiKey(
  apiKey: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    const trimmed = apiKey.trim();
    if (!trimmed) {
      // Supprimer la clé
      await prisma.siteConfig.deleteMany({ where: { key: "easy_express_api_key" } });
    } else {
      const encrypted = encryptIfSensitive("easy_express_api_key", trimmed);
      await prisma.siteConfig.upsert({
        where: { key: "easy_express_api_key" },
        update: { value: encrypted },
        create: { key: "easy_express_api_key", value: encrypted },
      });
    }
    revalidatePath("/admin/parametres");
    revalidateTag("site-config", "default");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

export async function validateEasyExpressApiKey(
  apiKey: string
): Promise<{ valid: boolean; error?: string }> {
  try {
    await requireAdmin();
    // Tester la clé avec un appel rates bidon (FR → FR, 1kg)
    const res = await fetch("https://easy-express.fr/api/v3/shipments/rates", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify({
        senderAddress: { countryCode: "FR", postalCode: "75001" },
        receiverAddress: { countryCode: "FR", postalCode: "75001" },
        parcels: [{ weight: 1 }],
      }),
    });
    const rawText = await res.text();
    if (!res.ok) return { valid: false, error: `Erreur ${res.status}` };
    const data = JSON.parse(rawText) as Record<string, unknown>;
    const response = data.Response as Record<string, unknown> | undefined;
    return { valid: response?.Code === 200 };
  } catch {
    return { valid: false, error: "Impossible de contacter Easy-Express." };
  }
}

// ─── PFS (Marketplace) Configuration ─────────────────────────────────────────

export async function updatePfsCredentials(config: {
  email: string;
  password: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    const { email, password } = config;

    const upsertOrDelete = (key: string, value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return prisma.siteConfig.deleteMany({ where: { key } });
      const stored = encryptIfSensitive(key, trimmed);
      return prisma.siteConfig.upsert({
        where: { key },
        update: { value: stored },
        create: { key, value: stored },
      });
    };

    await Promise.all([
      upsertOrDelete("pfs_email", email),
      upsertOrDelete("pfs_password", password),
    ]);

    revalidatePath("/admin/parametres");
    revalidateTag("site-config", "default");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

export async function togglePfsEnabled(enabled: boolean): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    await prisma.siteConfig.upsert({
      where: { key: "pfs_enabled" },
      update: { value: enabled ? "true" : "false" },
      create: { key: "pfs_enabled", value: enabled ? "true" : "false" },
    });
    revalidatePath("/admin/parametres");
    revalidateTag("site-config", "default");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

export async function validatePfsCredentials(config: {
  email: string;
  password: string;
}): Promise<{ valid: boolean; error?: string }> {
  try {
    await requireAdmin();
    const res = await fetch("https://wholesaler-api.parisfashionshops.com/api/v1/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "application/json",
      },
      body: JSON.stringify({ email: config.email.trim(), password: config.password.trim() }),
    });
    if (!res.ok) return { valid: false, error: `Erreur d'authentification (${res.status})` };
    const data = await res.json();
    if (!data.access_token) return { valid: false, error: "Réponse invalide (pas de token)." };
    return { valid: true };
  } catch {
    return { valid: false, error: "Impossible de contacter Paris Fashion Shops." };
  }
}

// ─── PFS Brand selector ───────────────────────────────────────────────────────

/**
 * Retourne la liste live des marques disponibles sur le compte PFS.
 * Utilisée par le sélecteur dans Paramètres > Marketplaces.
 */
export async function loadPfsBrands(): Promise<{
  success: boolean;
  brands?: { id: string; name: string; logoUrl: string | null }[];
  error?: string;
}> {
  try {
    await requireAdmin();
    const { pfsListBrands } = await import("@/lib/pfs-api");
    const brands = await pfsListBrands();
    return {
      success: true,
      brands: brands.map((b) => ({
        id: b.id,
        name: b.name,
        logoUrl: b.logo_url ?? null,
      })),
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Impossible de charger les marques PFS",
    };
  }
}

/**
 * Sauvegarde la marque PFS sélectionnée (id + nom).
 * Passer { id: "", name: "" } pour effacer la sélection (verrouille PFS).
 */
export async function updatePfsBrand(config: {
  id: string;
  name: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    const id = config.id.trim();
    const name = config.name.trim();

    const upsertOrDelete = (key: string, value: string) => {
      if (!value) return prisma.siteConfig.deleteMany({ where: { key } });
      return prisma.siteConfig.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      });
    };

    if ((id && !name) || (name && !id)) {
      return { success: false, error: "Sélectionnez une marque dans la liste." };
    }

    await Promise.all([
      upsertOrDelete("pfs_brand_id", id),
      upsertOrDelete("pfs_brand_name", name),
    ]);

    revalidatePath("/admin/parametres");
    revalidateTag("site-config", "default");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

// ─── Ankorstore Configuration ────────────────────────────────────────────────

export async function updateAnkorstoreCredentials(config: {
  clientId: string;
  clientSecret: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    const clientId = config.clientId.trim();
    const clientSecret = config.clientSecret.trim();
    await prisma.siteConfig.upsert({
      where: { key: "ankors_client_id" },
      update: { value: encryptIfSensitive("ankors_client_id", clientId) },
      create: { key: "ankors_client_id", value: encryptIfSensitive("ankors_client_id", clientId) },
    });
    await prisma.siteConfig.upsert({
      where: { key: "ankors_client_secret" },
      update: { value: encryptIfSensitive("ankors_client_secret", clientSecret) },
      create: { key: "ankors_client_secret", value: encryptIfSensitive("ankors_client_secret", clientSecret) },
    });
    revalidateTag("site-config", "default");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Erreur inconnue" };
  }
}

export async function toggleAnkorstoreEnabled(enabled: boolean): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    await prisma.siteConfig.upsert({
      where: { key: "ankors_enabled" },
      update: { value: enabled ? "true" : "false" },
      create: { key: "ankors_enabled", value: enabled ? "true" : "false" },
    });
    revalidateTag("site-config", "default");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Erreur inconnue" };
  }
}

export async function validateAnkorstoreCredentials(config: {
  clientId: string;
  clientSecret: string;
}): Promise<{ valid: boolean; error?: string }> {
  try {
    await requireAdmin();
    // Import dynamique pour éviter de charger le module Ankorstore quand pas appelé
    const { testAnkorstoreCredentials } = await import("@/lib/ankorstore-auth");
    return testAnkorstoreCredentials(config.clientId.trim(), config.clientSecret.trim());
  } catch {
    return { valid: false, error: "Impossible de valider les identifiants Ankorstore." };
  }
}

// ─── eFashion Paris Configuration ────────────────────────────────────────────

export async function updateEfashionCredentials(config: {
  email: string;
  password: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    const email = config.email.trim();
    const password = config.password.trim();

    const upsertOrDelete = (key: string, value: string) => {
      if (!value) return prisma.siteConfig.deleteMany({ where: { key } });
      const stored = encryptIfSensitive(key, value);
      return prisma.siteConfig.upsert({
        where: { key },
        update: { value: stored },
        create: { key, value: stored },
      });
    };

    await Promise.all([
      upsertOrDelete("efashion_email", email),
      upsertOrDelete("efashion_password", password),
    ]);

    // Force réauth au prochain appel API (l'ancienne session devient invalide).
    const { invalidateEfashionSession } = await import("@/lib/efashion-auth");
    invalidateEfashionSession();

    revalidatePath("/admin/parametres");
    revalidateTag("site-config", "default");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

export async function toggleEfashionEnabled(
  enabled: boolean,
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    await prisma.siteConfig.upsert({
      where: { key: "efashion_enabled" },
      update: { value: enabled ? "true" : "false" },
      create: { key: "efashion_enabled", value: enabled ? "true" : "false" },
    });
    revalidatePath("/admin/parametres");
    revalidateTag("site-config", "default");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

export async function validateEfashionCredentials(config: {
  email: string;
  password: string;
}): Promise<{ valid: boolean; error?: string; vendor?: { id: number; name: string } }> {
  try {
    await requireAdmin();
    const { testEfashionCredentials } = await import("@/lib/efashion-auth");
    return await testEfashionCredentials(config.email.trim(), config.password.trim());
  } catch {
    return { valid: false, error: "Impossible de contacter eFashion Paris." };
  }
}

// ─── DeepL Configuration ────────────────────────────────────────────────────

export async function updateDeeplApiKey(
  apiKey: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    const trimmed = apiKey.trim();
    if (!trimmed) {
      await prisma.siteConfig.deleteMany({ where: { key: "deepl_api_key" } });
    } else {
      const encrypted = encryptIfSensitive("deepl_api_key", trimmed);
      await prisma.siteConfig.upsert({
        where: { key: "deepl_api_key" },
        update: { value: encrypted },
        create: { key: "deepl_api_key", value: encrypted },
      });
    }
    revalidatePath("/admin/parametres");
    revalidateTag("site-config", "default");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

export async function validateDeeplApiKey(
  apiKey: string
): Promise<{ valid: boolean; error?: string }> {
  try {
    await requireAdmin();
    const key = apiKey.trim();
    const isFreePlan = key.endsWith(":fx");
    const baseUrl = isFreePlan
      ? "https://api-free.deepl.com"
      : "https://api.deepl.com";

    const res = await fetch(`${baseUrl}/v2/usage`, {
      headers: { Authorization: `DeepL-Auth-Key ${key}` },
    });
    if (!res.ok) return { valid: false, error: `Erreur ${res.status} — clé invalide.` };
    const data = await res.json();
    if (typeof data.character_count !== "number") return { valid: false, error: "Réponse inattendue." };
    return { valid: true };
  } catch {
    return { valid: false, error: "Impossible de contacter DeepL." };
  }
}

// ─── Garde-fou rafraîchissement (avertissement si récent) ──────────────────

/**
 * Configure le garde-fou qui prévient quand on tente de rafraîchir un produit
 * déjà rafraîchi il y a moins de N jours.
 *
 * Clés SiteConfig : `refresh_warning_enabled` (bool) + `refresh_warning_days` (int).
 * Désactivé = comportement actuel (aucun avertissement).
 */
export async function updateRefreshWarning(
  enabled: boolean,
  days: number,
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    if (!Number.isFinite(days) || days < 1 || days > 365) {
      return { success: false, error: "Le nombre de jours doit être entre 1 et 365." };
    }
    const intDays = Math.floor(days);
    await Promise.all([
      prisma.siteConfig.upsert({
        where: { key: "refresh_warning_enabled" },
        update: { value: enabled ? "true" : "false" },
        create: { key: "refresh_warning_enabled", value: enabled ? "true" : "false" },
      }),
      prisma.siteConfig.upsert({
        where: { key: "refresh_warning_days" },
        update: { value: String(intDays) },
        create: { key: "refresh_warning_days", value: String(intDays) },
      }),
    ]);
    revalidatePath("/admin/parametres");
    revalidateTag("site-config", "default");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

// ─── Auto-translate toggle ─────────────────────────────────────────────────

export async function updateAutoTranslate(
  enabled: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    await prisma.siteConfig.upsert({
      where: { key: "auto_translate_enabled" },
      update: { value: enabled ? "true" : "false" },
      create: { key: "auto_translate_enabled", value: enabled ? "true" : "false" },
    });
    revalidatePath("/admin/parametres");
    revalidateTag("site-config", "default");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

export type CarouselProductInfo = {
  id: string;
  name: string;
  reference: string;
  category: string;
  image: string | null;
};

export async function searchProductsForCarousel(
  query: string
): Promise<CarouselProductInfo[]> {
  await requireAdmin();
  if (!query || query.length < 2) return [];
  const products = await prisma.product.findMany({
    where: {
      status: "ONLINE",
      OR: [
        { name: { contains: query } },
        { reference: { contains: query } },
      ],
    },
    select: {
      id: true, name: true, reference: true,
      category: { select: { name: true } },
      colors: {
        where: { isPrimary: true },
        take: 1,
        select: { images: { take: 1, orderBy: { order: "asc" }, select: { path: true } } },
      },
    },
    take: 20,
    orderBy: { name: "asc" },
  });
  return products.map(p => ({
    id: p.id,
    name: p.name,
    reference: p.reference,
    category: p.category.name,
    image: p.colors[0]?.images[0]?.path ?? null,
  }));
}

export async function getProductsByIds(
  ids: string[]
): Promise<CarouselProductInfo[]> {
  await requireAdmin();
  if (ids.length === 0) return [];
  const products = await prisma.product.findMany({
    where: { id: { in: ids } },
    select: {
      id: true, name: true, reference: true,
      category: { select: { name: true } },
      colors: {
        where: { isPrimary: true },
        take: 1,
        select: { images: { take: 1, orderBy: { order: "asc" }, select: { path: true } } },
      },
    },
  });
  // Maintain input order
  const map = new Map(products.map(p => [p.id, p]));
  return ids.map(id => map.get(id)).filter(Boolean).map(p => ({
    id: p!.id,
    name: p!.name,
    reference: p!.reference,
    category: p!.category.name,
    image: p!.colors[0]?.images[0]?.path ?? null,
  }));
}

export async function updateProductDisplayConfig(
  config: ProductDisplayConfig
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    if (!config || !["date", "custom"].includes(config.catalogMode)) {
      return { success: false, error: "Configuration invalide." };
    }
    await prisma.siteConfig.upsert({
      where: { key: "product_display_config" },
      update: { value: JSON.stringify(config) },
      create: { key: "product_display_config", value: JSON.stringify(config) },
    });
    revalidatePath("/admin/parametres");
    revalidateTag("site-config", "default");
    revalidatePath("/produits");
    revalidatePath("/");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

export async function updateCatalogDisplayConfig(
  catalogMode: "date" | "custom",
  sections: DisplaySection[]
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    const row = await prisma.siteConfig.findUnique({ where: { key: "product_display_config" } });
    const current = parseDisplayConfig(row?.value ?? null);
    const updated: ProductDisplayConfig = { ...current, catalogMode, sections: catalogMode === "custom" ? sections : [] };
    await prisma.siteConfig.upsert({
      where: { key: "product_display_config" },
      update: { value: JSON.stringify(updated) },
      create: { key: "product_display_config", value: JSON.stringify(updated) },
    });
    revalidatePath("/admin/parametres");
    revalidateTag("site-config", "default");
    revalidatePath("/produits");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

export async function updateHomepageCarouselsConfig(
  carousels: HomepageCarousel[]
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    const row = await prisma.siteConfig.findUnique({ where: { key: "product_display_config" } });
    const current = parseDisplayConfig(row?.value ?? null);
    const updated: ProductDisplayConfig = { ...current, homepageCarousels: carousels };
    await prisma.siteConfig.upsert({
      where: { key: "product_display_config" },
      update: { value: JSON.stringify(updated) },
      create: { key: "product_display_config", value: JSON.stringify(updated) },
    });
    revalidatePath("/admin/parametres");
    revalidateTag("site-config", "default");
    revalidatePath("/");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}


// ─── Marketplace Markup Configuration ────────────────────────────────────────

type MarkupState = { type: MarkupType; value: number; rounding: RoundingMode };

export interface MarketplaceMarkupSettings {
  pfs?: MarkupState;
  ankorstoreWholesale?: MarkupState;
  ankorstoreRetail?: MarkupState;
  ankorstoreVatRate?: number;
  efashion?: MarkupState;
}

export async function updateMarketplaceMarkup(
  settings: MarketplaceMarkupSettings
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();

    const pairs: { key: string; value: string }[] = [];

    if (settings.pfs) {
      pairs.push(
        { key: "pfs_price_markup_type", value: settings.pfs.type },
        { key: "pfs_price_markup_value", value: String(settings.pfs.value) },
        { key: "pfs_price_markup_rounding", value: settings.pfs.rounding }
      );
    }

    if (settings.ankorstoreWholesale) {
      pairs.push(
        { key: "ankorstore_wholesale_markup_type", value: settings.ankorstoreWholesale.type },
        { key: "ankorstore_wholesale_markup_value", value: String(settings.ankorstoreWholesale.value) },
        { key: "ankorstore_wholesale_markup_rounding", value: settings.ankorstoreWholesale.rounding }
      );
    }

    if (settings.ankorstoreRetail) {
      pairs.push(
        { key: "ankorstore_retail_markup_type", value: settings.ankorstoreRetail.type },
        { key: "ankorstore_retail_markup_value", value: String(settings.ankorstoreRetail.value) },
        { key: "ankorstore_retail_markup_rounding", value: settings.ankorstoreRetail.rounding }
      );
    }

    if (settings.ankorstoreVatRate !== undefined) {
      pairs.push({ key: "ankorstore_default_vat_rate", value: String(settings.ankorstoreVatRate) });
    }

    if (settings.efashion) {
      pairs.push(
        { key: "efashion_price_markup_type", value: settings.efashion.type },
        { key: "efashion_price_markup_value", value: String(settings.efashion.value) },
        { key: "efashion_price_markup_rounding", value: settings.efashion.rounding }
      );
    }

    await Promise.all(
      pairs.map(({ key, value }) =>
        prisma.siteConfig.upsert({
          where: { key },
          update: { value },
          create: { key, value },
        })
      )
    );

    revalidatePath("/admin/parametres");
    revalidateTag("site-config", "default");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

// ─── Shipping Margin ─────────────────────────────────────────────────────────

export interface ShippingMarginSettings {
  type: "fixed" | "percent";
  value: number;
}

export async function updateShippingMargin(
  settings: ShippingMarginSettings
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();

    if (settings.value < 0) return { success: false, error: "La valeur doit être positive." };

    await Promise.all([
      prisma.siteConfig.upsert({
        where: { key: "shipping_margin_type" },
        update: { value: settings.type },
        create: { key: "shipping_margin_type", value: settings.type },
      }),
      prisma.siteConfig.upsert({
        where: { key: "shipping_margin_value" },
        update: { value: String(settings.value) },
        create: { key: "shipping_margin_value", value: String(settings.value) },
      }),
    ]);

    revalidatePath("/admin/parametres");
    revalidateTag("site-config", "default");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

// ─── Announcement Banner ──────────────────────────────────────────────────────

export interface AnnouncementBannerData {
  messages: string[];
  bgColor: string;
  textColor: string;
  speed: number; // seconds per message
}

export async function updateAnnouncementBanner(
  data: AnnouncementBannerData
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();

    const messages = data.messages.map((m) => m.trim()).filter((m) => m.length > 0);

    if (messages.length === 0) {
      await prisma.siteConfig.deleteMany({ where: { key: "announcement_banner" } });
    } else {
      const payload = { messages, bgColor: data.bgColor, textColor: data.textColor, speed: data.speed || 8 };
      await prisma.siteConfig.upsert({
        where: { key: "announcement_banner" },
        update: { value: JSON.stringify(payload) },
        create: { key: "announcement_banner", value: JSON.stringify(payload) },
      });
    }

    revalidatePath("/admin/parametres");
    revalidateTag("site-config", "default");
    revalidatePath("/");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

