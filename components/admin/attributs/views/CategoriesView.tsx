import { prisma } from "@/lib/prisma";
import { getEfashionLabelMaps, resolveCategoryLabel } from "@/lib/efashion-labels";
import CategoriesMasterDetail, { type CategoryRow } from "@/components/admin/categories/CategoriesMasterDetail";
import CategoriesHeaderActions from "@/components/admin/categories/CategoriesHeaderActions";
import PageHeader from "@/components/admin/shared/PageHeader";
import {
  getCachedHasPfsConfig,
  getCachedHasEfashionConfig,
  getCachedHasFaireConfig,
  getCachedHasOrderchampConfig,
} from "@/lib/cached-data";
import { buildTranslationsMap } from "@/lib/translations";
import { getFaireTaxonomy } from "@/lib/faire-taxonomy";
import { findFaireTaxonomyById } from "@/lib/faire-taxonomy-types";
import {
  getCachedOrderchampTaxonomy,
  getOrderchampCategoryLabel,
} from "@/lib/orderchamp-taxonomy";
import {
  getMicrostoreLabelMaps,
  resolveMicrostoreLabelOrOrphan,
} from "@/lib/microstore-labels";

const PFS_GENDER_LABELS: Record<string, string> = {
  WOMAN: "Femme",
  MAN: "Homme",
  KID: "Enfant",
  SUPPLIES: "Fournitures",
};

function isSalesforceId(value: string | null): boolean {
  if (!value) return false;
  return /^[a-zA-Z0-9]{15,18}$/.test(value) && /^a0/.test(value);
}

function buildPfsLabel(g: string | null, f: string | null, c: string | null): string | null {
  const gender = g ? PFS_GENDER_LABELS[g] ?? g : null;
  const family = f && !isSalesforceId(f) ? f.replace(/_/g, " ") : null;
  if (gender && family && c) return `${gender} › ${family} › ${c}`;
  return null;
}

export default async function CategoriesView() {
  const [
    categories,
    efashionLabels,
    hasPfsConfig,
    hasEfashionConfig,
    hasFaireConfig,
    hasOrderchampConfig,
    faireTypes,
    orderchampTaxonomy,
    microstoreLabels,
  ] = await Promise.all([
    prisma.category.findMany({
      orderBy: [{ position: "asc" }, { name: "asc" }],
      include: {
        subCategories: {
          orderBy: { name: "asc" },
          include: { translations: true },
        },
        translations: true,
        _count: { select: { products: true } },
      },
    }),
    getEfashionLabelMaps(),
    getCachedHasPfsConfig(),
    getCachedHasEfashionConfig(),
    getCachedHasFaireConfig(),
    getCachedHasOrderchampConfig(),
    getFaireTaxonomy().catch(() => []),
    getCachedOrderchampTaxonomy().catch(() => []),
    getMicrostoreLabelMaps(),
  ]);

  function buildFaireLabel(taxonomyId: string | null): string | null {
    if (!taxonomyId) return null;
    const hit = findFaireTaxonomyById(faireTypes, taxonomyId);
    if (!hit) return taxonomyId;
    const trail = hit.categoryBreadcrumb?.join(" › ");
    return trail ? `${hit.name} · ${trail}` : hit.name;
  }

  const rows: CategoryRow[] = categories.map((c) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    image: c.image,
    position: c.position,
    translations: buildTranslationsMap(c.name, c.translations),
    pfsCategoryId: c.pfsCategoryId,
    pfsGender: c.pfsGender,
    pfsFamilyName: c.pfsFamilyName,
    pfsCategoryName: c.pfsCategoryName,
    efashionCategorieId: c.efashionCategorieId,
    faireTaxonomyId: c.faireTaxonomyId,
    orderchampCategoryPath: c.orderchampCategoryPath,
    microstoreCategoryId: c.microstoreCategoryId,
    microstoreLabel: resolveMicrostoreLabelOrOrphan(
      microstoreLabels.categories,
      c.microstoreCategoryId,
    ),
    productCount: c._count.products,
    createdAt: c.createdAt,
    subCategories: c.subCategories.map((s) => {
      const subMsId = (s as { microstoreCategoryId?: number | null }).microstoreCategoryId ?? null;
      return {
        id: s.id,
        name: s.name,
        translations: buildTranslationsMap(s.name, s.translations),
        orderchampCategoryPath: s.orderchampCategoryPath,
        orderchampLabel: s.orderchampCategoryPath
          ? getOrderchampCategoryLabel(s.orderchampCategoryPath, orderchampTaxonomy)
          : null,
        microstoreCategoryId: subMsId,
        microstoreLabel: resolveMicrostoreLabelOrOrphan(
          microstoreLabels.categories,
          subMsId,
        ),
      };
    }),
    pfsLabel: buildPfsLabel(c.pfsGender, c.pfsFamilyName, c.pfsCategoryName),
    efashionLabel: resolveCategoryLabel(efashionLabels, c.efashionCategorieId) ?? null,
    faireLabel: buildFaireLabel(c.faireTaxonomyId),
    orderchampLabel: c.orderchampCategoryPath
      ? getOrderchampCategoryLabel(c.orderchampCategoryPath, orderchampTaxonomy)
      : null,
  }));

  const allTranslateItems = [
    ...categories.map((c) => ({
      id: `cat:${c.id}`,
      text: c.name,
      hasTranslations: c.translations.length > 0,
    })),
    ...categories.flatMap((c) =>
      c.subCategories.map((s) => ({
        id: `sub:${s.id}`,
        text: s.name,
        hasTranslations: s.translations.length > 0,
      })),
    ),
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Catégories"
        actions={<CategoriesHeaderActions items={allTranslateItems} />}
      />
      <CategoriesMasterDetail
        categories={rows}
        hasPfsConfig={hasPfsConfig}
        hasEfashionConfig={hasEfashionConfig}
        hasFaireConfig={hasFaireConfig}
        hasOrderchampConfig={hasOrderchampConfig}
        orderchampTaxonomy={orderchampTaxonomy}
      />
    </div>
  );
}
