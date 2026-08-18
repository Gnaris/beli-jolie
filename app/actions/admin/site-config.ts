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
import { setSiteConfig } from "@/lib/site-config-write";
import type { MinOrderMode } from "@/lib/min-order";
import { isMinOrderMode } from "@/lib/min-order";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Non autorisé");
}

export async function updateMinOrderHT(value: number): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    if (value < 0) return { success: false, error: "Le montant doit être positif." };
    await setSiteConfig("min_order_ht", String(value));
    revalidatePath("/admin/parametres");
    revalidateTag("site-config", "default");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

export interface MinOrderConfigInput {
  mode: MinOrderMode;
  valueAll?: number;
  valueFirst?: number;
  valueRest?: number;
}

export async function updateMinOrderConfig(
  input: MinOrderConfigInput,
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    if (!isMinOrderMode(input.mode)) {
      return { success: false, error: "Mode invalide." };
    }
    const valueAll = Number(input.valueAll ?? 0);
    const valueFirst = Number(input.valueFirst ?? 0);
    const valueRest = Number(input.valueRest ?? 0);
    for (const v of [valueAll, valueFirst, valueRest]) {
      if (!Number.isFinite(v) || v < 0) {
        return { success: false, error: "Les montants doivent être positifs." };
      }
    }
    if (input.mode === "all" && valueAll <= 0) {
      return { success: false, error: "Renseignez le montant minimum." };
    }
    if ((input.mode === "first_only" || input.mode === "first_then_rest") && valueFirst <= 0) {
      return { success: false, error: "Renseignez le minimum de la 1ʳᵉ commande." };
    }
    if (input.mode === "first_then_rest" && valueRest <= 0) {
      return { success: false, error: "Renseignez le minimum des commandes suivantes." };
    }
    await Promise.all([
      setSiteConfig("min_order_mode", input.mode),
      setSiteConfig("min_order_ht", String(input.mode === "all" ? valueAll : 0)),
      setSiteConfig(
        "min_order_ht_first",
        String(input.mode === "first_only" || input.mode === "first_then_rest" ? valueFirst : 0),
      ),
      setSiteConfig(
        "min_order_ht_rest",
        String(input.mode === "first_then_rest" ? valueRest : 0),
      ),
    ]);
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
    await setSiteConfig("maintenance_mode", String(enabled));
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
    await setSiteConfig("business_hours", JSON.stringify(schedule));
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
 * Clés SiteConfig :
 *  - `seo_tagline` : baseline courte (~80 car.) utilisée dans le <title> et
 *    l'aperçu Google. Vide → fallback « Grossiste B2B ».
 *  - `home_seo_text` : paragraphe long affiché en bas de la home.
 *  - `produits_seo_text` : paragraphe long en haut de la page /produits.
 * Une chaîne vide supprime simplement le bloc / retombe sur le défaut.
 */
export async function updateSeoTexts(input: {
  homeText: string;
  produitsText: string;
  tagline?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    const home = input.homeText.trim();
    const produits = input.produitsText.trim();
    const tagline = (input.tagline ?? "").trim();
    const MAX = 5000;
    const TAGLINE_MAX = 80;
    if (home.length > MAX || produits.length > MAX) {
      return { success: false, error: `Le texte ne doit pas dépasser ${MAX} caractères.` };
    }
    if (tagline.length > TAGLINE_MAX) {
      return { success: false, error: `La baseline ne doit pas dépasser ${TAGLINE_MAX} caractères.` };
    }
    await Promise.all([
      setSiteConfig("home_seo_text", home),
      setSiteConfig("produits_seo_text", produits),
      setSiteConfig("seo_tagline", tagline),
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
    await setSiteConfig("show_out_of_stock_variants", String(config.showOutOfStockVariants));
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

    const previousRow = await prisma.siteConfig.findFirst({
      where: { key: "banner_image" },
      select: { value: true },
    });
    const previousPath = previousRow?.value ?? null;

    if (imagePath) {
      await setSiteConfig("banner_image", imagePath);
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
    const previousRow = await prisma.siteConfig.findFirst({
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
      await setSiteConfig("site_favicon", value);
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
      await setSiteConfig("easy_express_api_key", encrypted);
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
      return setSiteConfig(key, stored);
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
    await setSiteConfig("pfs_enabled", enabled ? "true" : "false");
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
      return setSiteConfig(key, value);
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

/**
 * NOUVEAU (2026-08-13) — Ankorstore back-office reverse-engineered.
 * On garde les mêmes noms de server actions (`updateAnkorstoreCredentials`,
 * `toggleAnkorstoreEnabled`, `validateAnkorstoreCredentials`) pour ne pas
 * casser l'UI existante (MarketplaceConfig.tsx), mais on accepte désormais
 * `{ email, password }` au lieu de `{ clientId, clientSecret }`.
 */
export async function updateAnkorstoreCredentials(config: {
  email?: string;
  password?: string;
  /** @deprecated ancien schéma OAuth2 — ignoré depuis le passage au back-office. */
  clientId?: string;
  /** @deprecated ancien schéma OAuth2 — ignoré depuis le passage au back-office. */
  clientSecret?: string;
}): Promise<{ success: boolean; error?: string }> {
  const { updateAnkorstoreBoCredentials } = await import(
    "@/app/actions/admin/ankorstore-bo"
  );
  const email = (config.email ?? config.clientId ?? "").trim();
  const password = (config.password ?? config.clientSecret ?? "").trim();
  return updateAnkorstoreBoCredentials({ email, password });
}

export async function toggleAnkorstoreEnabled(enabled: boolean): Promise<{ success: boolean; error?: string }> {
  const { toggleAnkorstoreBoEnabled } = await import(
    "@/app/actions/admin/ankorstore-bo"
  );
  // Écriture croisée : on maintient AUSSI `ankors_enabled` pour compat lecture par
  // `getCachedAnkorstoreEnabled`, plus la nouvelle clé `ankorstore_bo_enabled`.
  try {
    await requireAdmin();
    await setSiteConfig("ankors_enabled", enabled ? "true" : "false");
    revalidateTag("site-config", "default");
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Erreur inconnue" };
  }
  return toggleAnkorstoreBoEnabled(enabled);
}

export async function validateAnkorstoreCredentials(config: {
  email?: string;
  password?: string;
  /** @deprecated */
  clientId?: string;
  /** @deprecated */
  clientSecret?: string;
}): Promise<{ valid: boolean; error?: string }> {
  const { validateAnkorstoreBoCredentials } = await import(
    "@/app/actions/admin/ankorstore-bo"
  );
  const email = (config.email ?? config.clientId ?? "").trim();
  const password = (config.password ?? config.clientSecret ?? "").trim();
  return validateAnkorstoreBoCredentials({ email, password });
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
      return setSiteConfig(key, stored);
    };

    await Promise.all([
      upsertOrDelete("efashion_email", email),
      upsertOrDelete("efashion_password", password),
    ]);

    // Force réauth au prochain appel API (l'ancienne session devient invalide).
    const { invalidateEfashionSession } = await import("@/lib/efashion-auth");
    await invalidateEfashionSession();

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
    await setSiteConfig("efashion_enabled", enabled ? "true" : "false");
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

// ─── Faire Configuration ─────────────────────────────────────────────────────

export async function updateFaireCredentials(config: {
  apiKey: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    const apiKey = config.apiKey.trim();
    if (!apiKey) {
      await prisma.siteConfig.deleteMany({ where: { key: "faire_api_key" } });
    } else {
      await setSiteConfig("faire_api_key", encryptIfSensitive("faire_api_key", apiKey));
    }
    revalidatePath("/admin/parametres");
    revalidateTag("site-config", "default");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Erreur inconnue" };
  }
}

export async function toggleFaireEnabled(
  enabled: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    await setSiteConfig("faire_enabled", enabled ? "true" : "false");
    revalidateTag("site-config", "default");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Erreur inconnue" };
  }
}

export async function validateFaireCredentials(config: {
  apiKey: string;
}): Promise<{ valid: boolean; error?: string }> {
  try {
    await requireAdmin();
    const { testFaireApiKey } = await import("@/lib/faire-auth");
    return await testFaireApiKey(config.apiKey.trim());
  } catch {
    return { valid: false, error: "Impossible de contacter Faire." };
  }
}

/**
 * Liste des codes ISO alpha-2 dont on ne veut PAS afficher la mention
 * « Made in {pays} » dans les descriptions envoyées à Faire.
 * Stockée en JSON dans SiteConfig[faire_made_in_excluded_isocodes].
 *
 * Effet de bord : les produits déjà liés à Faire dont le pays de fabrication
 * a changé de statut (nouvellement coché ou décoché) sont marqués
 * `faireSyncRequired = true` pour que le badge « Synchro nécessaire » s'affiche
 * — la cliente devra les rafraîchir pour pousser la nouvelle description.
 */
export async function updateFaireMadeInExcluded(
  isoCodes: string[]
): Promise<{ success: boolean; error?: string; markedForSync?: number }> {
  try {
    await requireAdmin();
    const cleaned = Array.from(
      new Set(
        (isoCodes ?? [])
          .map((c) => (typeof c === "string" ? c.trim().toUpperCase() : ""))
          .filter((c) => /^[A-Z]{2}$/.test(c)),
      ),
    );

    // Lire l'ancienne liste AVANT d'écrire pour calculer le diff symétrique
    // (pays ajoutés ∪ pays retirés). Seuls ces pays méritent un re-sync :
    // un produit Made in France n'est pas impacté quand on ajoute la Chine
    // à la liste d'exclusion.
    const oldRow = await prisma.siteConfig.findFirst({
      where: { key: "faire_made_in_excluded_isocodes" },
      select: { value: true },
    });
    let oldList: string[] = [];
    if (oldRow?.value) {
      try {
        const parsed = JSON.parse(oldRow.value);
        if (Array.isArray(parsed)) {
          oldList = parsed
            .filter((c): c is string => typeof c === "string")
            .map((c) => c.trim().toUpperCase())
            .filter((c) => /^[A-Z]{2}$/.test(c));
        }
      } catch { /* liste vide */ }
    }
    const oldSet = new Set(oldList);
    const newSet = new Set(cleaned);
    const changed: string[] = [];
    for (const c of oldSet) if (!newSet.has(c)) changed.push(c);
    for (const c of newSet) if (!oldSet.has(c)) changed.push(c);

    await setSiteConfig("faire_made_in_excluded_isocodes", JSON.stringify(cleaned));

    let markedForSync = 0;
    if (changed.length > 0) {
      const res = await prisma.product.updateMany({
        where: {
          faireProductId: { not: null },
          countryIsoCode: { in: changed },
        },
        data: { faireSyncRequired: true },
      });
      markedForSync = res.count;
    }

    revalidatePath("/admin/parametres");
    revalidateTag("site-config", "default");
    if (markedForSync > 0) {
      // Le tableau /admin/produits et la fiche /admin/produits/[id]/modifier
      // lisent Product.faireSyncRequired directement en BDD (pas via un
      // unstable_cache tagué "products"). Sans invalider explicitement le
      // segment layout, Next 16 sert la version RSC cachée et le badge orange
      // « Synchro nécessaire » reste invisible malgré le flag posé en base.
      revalidatePath("/admin/produits", "layout");
      revalidateTag("products", "default");
    }
    return { success: true, markedForSync };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

// ─── Microstore (Dokkr) — session QR-code, expire ~1 an ────────────────────

/**
 * Déconnecte Microstore : supprime la clé de session + le mask token de
 * SiteConfig et invalide les caches. Utilisé par le bouton « Déconnecter »
 * de la page paramètres et automatiquement quand la clé est expirée
 * (détection err 6011/6061 lors d'un appel API).
 */
export async function disconnectMicrostore(): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    await prisma.siteConfig.deleteMany({
      where: {
        key: {
          in: [
            "microstore_session_key",
            "microstore_mask_token",
            "microstore_expires_at",
            "microstore_enabled",
          ],
        },
      },
    });
    revalidatePath("/admin/parametres");
    revalidateTag("site-config", "default");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Erreur inconnue" };
  }
}

/**
 * Bascule l'état activé/désactivé de l'intégration Microstore (indépendant
 * de la connexion : on peut être connecté mais désactivé).
 */
export async function toggleMicrostoreEnabled(
  enabled: boolean,
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    await setSiteConfig("microstore_enabled", enabled ? "true" : "false");
    revalidateTag("site-config", "default");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Erreur inconnue" };
  }
}

// ─── Service de traduction (Paris Fashion Shop) ────────────────────────────

/**
 * Teste que l'API de traduction PFS répond bien avec les identifiants
 * configurés. Utilisé par le bouton « Tester la traduction » de Paramètres.
 */
export async function pingTranslationProvider(): Promise<{ ok: boolean; message: string }> {
  try {
    await requireAdmin();
    const { pingPfsTranslation } = await import("@/lib/pfs-translate");
    return await pingPfsTranslation();
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Erreur inconnue" };
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
      setSiteConfig("refresh_warning_enabled", enabled ? "true" : "false"),
      setSiteConfig("refresh_warning_days", String(intDays)),
    ]);
    revalidatePath("/admin/parametres");
    revalidateTag("site-config", "default");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

// ─── Badge « Réf » sur la 1ère image produit ──────────────────────────────

export async function updateBrandedReferenceBadge(
  enabled: boolean,
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    await setSiteConfig("branded_reference_badge_enabled", enabled ? "true" : "false");
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
    await setSiteConfig("auto_translate_enabled", enabled ? "true" : "false");
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
    await setSiteConfig("product_display_config", JSON.stringify(config));
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
    const row = await prisma.siteConfig.findFirst({ where: { key: "product_display_config" } });
    const current = parseDisplayConfig(row?.value ?? null);
    const updated: ProductDisplayConfig = { ...current, catalogMode, sections: catalogMode === "custom" ? sections : [] };
    await setSiteConfig("product_display_config", JSON.stringify(updated));
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
    const row = await prisma.siteConfig.findFirst({ where: { key: "product_display_config" } });
    const current = parseDisplayConfig(row?.value ?? null);
    const updated: ProductDisplayConfig = { ...current, homepageCarousels: carousels };
    await setSiteConfig("product_display_config", JSON.stringify(updated));
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
  faireWholesale?: MarkupState;
  faireRetail?: MarkupState;
  efashion?: MarkupState;
  microstore?: MarkupState;
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

    if (settings.microstore) {
      pairs.push(
        { key: "microstore_price_markup_type", value: settings.microstore.type },
        { key: "microstore_price_markup_value", value: String(settings.microstore.value) },
        { key: "microstore_price_markup_rounding", value: settings.microstore.rounding }
      );
    }

    if (settings.faireWholesale) {
      pairs.push(
        { key: "faire_wholesale_markup_type", value: settings.faireWholesale.type },
        { key: "faire_wholesale_markup_value", value: String(settings.faireWholesale.value) },
        { key: "faire_wholesale_markup_rounding", value: settings.faireWholesale.rounding }
      );
    }

    if (settings.faireRetail) {
      pairs.push(
        { key: "faire_retail_markup_type", value: settings.faireRetail.type },
        { key: "faire_retail_markup_value", value: String(settings.faireRetail.value) },
        { key: "faire_retail_markup_rounding", value: settings.faireRetail.rounding }
      );
    }

    await Promise.all(
      pairs.map(({ key, value }) => setSiteConfig(key, value))
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
      setSiteConfig("shipping_margin_type", settings.type),
      setSiteConfig("shipping_margin_value", String(settings.value)),
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
      await setSiteConfig("announcement_banner", JSON.stringify(payload));
    }

    revalidatePath("/admin/parametres");
    revalidateTag("site-config", "default");
    revalidatePath("/");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

