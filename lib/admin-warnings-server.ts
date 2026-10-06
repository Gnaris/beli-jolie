import "server-only";

import { prisma } from "@/lib/prisma";
import { NON_DEFAULT_LOCALES } from "@/i18n/locales";
import type { AdminWarningsCounts } from "@/lib/admin-warnings";

export async function fetchAdminWarnings(): Promise<AdminWarningsCounts> {
  const [
    totalProducts,
    fullyTranslatedProducts,
    unusedColorsCount,
    unusedCompositionsCount,
    unusedTagsCount,
    untranslatedCategoriesCount,
    untranslatedSubCategoriesCount,
    pendingOrdersCount,
    pendingUsersCount,
    openClaimsCount,
    pendingReviewsCount,
  ] = await Promise.all([
    prisma.product.count(),
    prisma.product.count({
      where: {
        AND: NON_DEFAULT_LOCALES.map((locale) => ({ translations: { some: { locale } } })),
      },
    }),
    prisma.color.count({ where: { translations: { none: {} } } }),
    prisma.composition.count({ where: { translations: { none: {} } } }),
    prisma.tag.count({ where: { translations: { none: {} } } }),
    prisma.category.count({ where: { translations: { none: {} } } }),
    prisma.subCategory.count({ where: { translations: { none: {} } } }),
    prisma.order.count({ where: { status: "PENDING" } }),
    prisma.user.count({ where: { role: "CLIENT", status: "PENDING" } }),
    prisma.claim.count({ where: { status: "OPEN" } }),
    prisma.customerReview.count({ where: { status: "PENDING" } }),
  ]);

  const untranslatedCount = totalProducts - fullyTranslatedProducts;

  return {
    untranslatedCount,
    unusedColorsCount,
    unusedCompositionsCount,
    unusedTagsCount,
    untranslatedCategoriesCount,
    untranslatedSubCategoriesCount,
    pendingOrdersCount,
    pendingUsersCount,
    openClaimsCount,
    pendingReviewsCount,
  };
}
