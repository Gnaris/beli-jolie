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

export async function updateStockDisplayConfig(config: {
  showOutOfStockVariants: boolean;
  showOutOfStockProducts: boolean;
}): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    await Promise.all([
      prisma.siteConfig.upsert({
        where: { key: "show_out_of_stock_variants" },
        update: { value: String(config.showOutOfStockVariants) },
        create: { key: "show_out_of_stock_variants", value: String(config.showOutOfStockVariants) },
      }),
      prisma.siteConfig.upsert({
        where: { key: "show_out_of_stock_products" },
        update: { value: String(config.showOutOfStockProducts) },
        create: { key: "show_out_of_stock_products", value: String(config.showOutOfStockProducts) },
      }),
    ]);
    revalidatePath("/admin/parametres");
    revalidateTag("site-config", "default");
    revalidatePath("/produits");
    revalidatePath("/");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

export async function updateBannerImage(
  imagePath: string | null
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    if (imagePath) {
      await prisma.siteConfig.upsert({
        where: { key: "banner_image" },
        update: { value: imagePath },
        create: { key: "banner_image", value: imagePath },
      });
    } else {
      await prisma.siteConfig.deleteMany({ where: { key: "banner_image" } });
    }
    revalidatePath("/admin/parametres");
    revalidateTag("site-config", "default");
    revalidatePath("/");
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

// ─── Resend (Email) Configuration ───────────────────────────────────────────

export async function updateResendConfig(config: {
  apiKey: string;
  fromEmail: string;
  fromName: string;
  notifyEmail: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    const { apiKey, fromEmail, fromName, notifyEmail } = config;

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
      upsertOrDelete("resend_api_key", apiKey),
      upsertOrDelete("resend_from_email", fromEmail),
      upsertOrDelete("resend_from_name", fromName),
      upsertOrDelete("resend_notify_email", notifyEmail),
    ]);

    revalidatePath("/admin/parametres");
    revalidateTag("site-config", "default");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

export async function validateResendConfig(config: {
  apiKey: string;
}): Promise<{ valid: boolean; error?: string }> {
  try {
    await requireAdmin();
    const { validateResendApiKey } = await import("@/lib/email");
    return await validateResendApiKey(config.apiKey);
  } catch (e) {
    return { valid: false, error: e instanceof Error ? e.message : "Erreur de validation." };
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

// ─── Ankorstore (Marketplace) Configuration ─────────────────────────────────

export async function updateAnkorstoreCredentials(config: {
  clientId: string;
  clientSecret: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    const { clientId, clientSecret } = config;

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
      upsertOrDelete("ankors_client_id", clientId),
      upsertOrDelete("ankors_client_secret", clientSecret),
    ]);

    revalidatePath("/admin/parametres");
    revalidateTag("site-config", "default");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
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
    revalidatePath("/admin/parametres");
    revalidateTag("site-config", "default");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

export async function validateAnkorstoreCredentials(config: {
  clientId: string;
  clientSecret: string;
}): Promise<{ valid: boolean; error?: string }> {
  try {
    await requireAdmin();
    const { testAnkorstoreCredentials } = await import("@/lib/ankorstore-auth");
    return await testAnkorstoreCredentials(config.clientId.trim(), config.clientSecret.trim());
  } catch {
    return { valid: false, error: "Impossible de contacter Ankorstore." };
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

export interface MarketplaceMarkupSettings {
  pfs: { type: MarkupType; value: number; rounding: RoundingMode };
  ankorstoreWholesale: { type: MarkupType; value: number; rounding: RoundingMode };
  ankorstoreRetail: { type: MarkupType; value: number; rounding: RoundingMode };
  ankorstoreVatRate: number; // percent (e.g. 20)
}

export async function updateMarketplaceMarkup(
  settings: MarketplaceMarkupSettings
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();

    const pairs: { key: string; value: string }[] = [
      { key: "pfs_price_markup_type", value: settings.pfs.type },
      { key: "pfs_price_markup_value", value: String(settings.pfs.value) },
      { key: "pfs_price_markup_rounding", value: settings.pfs.rounding },
      { key: "ankorstore_wholesale_markup_type", value: settings.ankorstoreWholesale.type },
      { key: "ankorstore_wholesale_markup_value", value: String(settings.ankorstoreWholesale.value) },
      { key: "ankorstore_wholesale_markup_rounding", value: settings.ankorstoreWholesale.rounding },
      { key: "ankorstore_retail_markup_type", value: settings.ankorstoreRetail.type },
      { key: "ankorstore_retail_markup_value", value: String(settings.ankorstoreRetail.value) },
      { key: "ankorstore_retail_markup_rounding", value: settings.ankorstoreRetail.rounding },
      { key: "ankorstore_default_vat_rate", value: String(settings.ankorstoreVatRate) },
    ];

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

