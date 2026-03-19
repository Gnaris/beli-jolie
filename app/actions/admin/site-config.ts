"use server";
import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { clearAutoMaintenance } from "@/lib/health";
import type { ProductDisplayConfig } from "@/lib/product-display";

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
