import "server-only";
import { prisma } from "@/lib/prisma";
import { getCachedCompanyInfo, getCachedShopName } from "@/lib/cached-data";
import type { WhatsAppMergeContext } from "@/lib/whatsapp-message";

/**
 * Charge le contexte de rendu d'un modèle WhatsApp pour un couple
 * (client destinataire, admin expéditeur).
 *
 * userId peut être null si la cliente clique sur WhatsApp d'une AdminClientCard
 * (fiche perso admin sans compte inscrit) — dans ce cas, seules les variables
 * « boutique » et « admin » sont peuplées, les tokens client restent absents
 * et sont préservés à l'affichage par `interpolate`.
 *
 * Server-only car dépend de Prisma + du context de tenant (via ALS/headers).
 */
export async function loadWhatsAppMergeContext(input: {
  userId: string | null;
  adminId: string;
}): Promise<WhatsAppMergeContext> {
  const ctx: WhatsAppMergeContext = {};

  const [user, admin, company, shopName] = await Promise.all([
    input.userId
      ? prisma.user.findUnique({
          where: { id: input.userId },
          select: {
            firstName: true,
            lastName: true,
            email: true,
            company: true,
            phone: true,
            siret: true,
            vatNumber: true,
            addressStreet: true,
            addressZip: true,
            addressCity: true,
            addressCountry: true,
          },
        })
      : Promise.resolve(null),
    prisma.user.findUnique({
      where: { id: input.adminId },
      select: { firstName: true, lastName: true },
    }),
    getCachedCompanyInfo(),
    getCachedShopName(),
  ]);

  if (user && input.userId) {
    ctx.firstName = (user.firstName ?? "").trim();
    ctx.lastName = (user.lastName ?? "").trim();
    ctx.fullName = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
    ctx.email = user.email;
    ctx.company = user.company ?? "";
    ctx.phone = user.phone ?? "";
    ctx.siret = user.siret ?? "";
    ctx.tvaIntra = user.vatNumber ?? "";
    ctx.address = user.addressStreet ?? "";
    ctx.postalCode = user.addressZip ?? "";
    ctx.city = user.addressCity ?? "";
    ctx.country = user.addressCountry ?? "";

    const stats = await prisma.order.aggregate({
      where: { userId: input.userId, status: { not: "CANCELLED" } },
      _count: { _all: true },
      _sum: { totalTTC: true },
      _max: { createdAt: true },
    });
    ctx.orderCount = String(stats._count._all);
    ctx.totalSpent = stats._sum.totalTTC
      ? `${Number(stats._sum.totalTTC).toFixed(2).replace(".", ",")} €`
      : "0,00 €";
    ctx.lastOrderDate = stats._max.createdAt
      ? stats._max.createdAt.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })
      : "";
  }

  ctx.shopName = shopName;
  ctx.shopAddress = company?.address
    ? [company.address, company.postalCode, company.city].filter(Boolean).join(", ")
    : "";
  ctx.shopEmail = company?.email ?? "";
  ctx.shopPhone = company?.phone ?? "";
  ctx.shopWebsite = company?.website ?? "";

  ctx.adminFirstName = (admin?.firstName ?? "").trim();
  ctx.adminLastName = (admin?.lastName ?? "").trim();

  return ctx;
}
