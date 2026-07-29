"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadMarketplaceMarkupConfigs } from "@/lib/marketplace-pricing";
import type { MarkupConfig } from "@/lib/marketplace-pricing-shared";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Non autorisé");
}

export type MarketplaceMarkupKey =
  | "pfs"
  | "efashion"
  | "ankorstoreWholesale"
  | "ankorstoreRetail"
  | "faireWholesale"
  | "faireRetail";

export async function getMarketplaceMarkupConfig(
  key: MarketplaceMarkupKey,
): Promise<
  | { success: true; data: { markup: MarkupConfig; shopName: string } }
  | { success: false; error: string }
> {
  try {
    await requireAdmin();
    const [all, shopRow] = await Promise.all([
      loadMarketplaceMarkupConfigs(),
      prisma.siteConfig.findFirst({ where: { key: "shop_name" } }),
    ]);
    const shopName = shopRow?.value?.trim() || "notre boutique";
    return { success: true, data: { markup: all[key], shopName } };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Erreur inconnue" };
  }
}
