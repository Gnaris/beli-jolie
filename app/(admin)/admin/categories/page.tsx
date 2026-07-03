import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { getEfashionLabelMaps, resolveCategoryLabel } from "@/lib/efashion-labels";
import CategoriesMasterDetail, { type CategoryRow } from "@/components/admin/categories/CategoriesMasterDetail";
import CategoriesHeaderActions from "@/components/admin/categories/CategoriesHeaderActions";
import PageHeader from "@/components/admin/shared/PageHeader";
import {
  getCachedHasPfsConfig,
  getCachedHasEfashionConfig,
  getCachedHasFaireConfig,
} from "@/lib/cached-data";
import { buildTranslationsMap } from "@/lib/translations";
import { getFaireTaxonomy } from "@/lib/faire-taxonomy";
import { findFaireTaxonomyById } from "@/lib/faire-taxonomy-types";

export const metadata: Metadata = {
  title: "Catégories",
};

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

export default async function CategoriesPage() {
  const [categories, efashionLabels, hasPfsConfig, hasEfashionConfig, hasFaireConfig, faireTypes] = await Promise.all([
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
    // Taxonomie Faire (cachée) — résout les tt_xxx en nom humain "Bracelets"
    // avec breadcrumb "Bijoux › Bracelets". Renvoie [] en cas d'erreur ou si
    // Faire n'est pas configuré, auquel cas l'ID brut reste le fallback.
    getFaireTaxonomy().catch(() => []),
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
    name: c.name,
    position: c.position,
    translations: buildTranslationsMap(c.name, c.translations),
    pfsGender: c.pfsGender,
    pfsFamilyName: c.pfsFamilyName,
    pfsCategoryName: c.pfsCategoryName,
    efashionCategorieId: c.efashionCategorieId,
    faireTaxonomyId: c.faireTaxonomyId,
    productCount: c._count.products,
    createdAt: c.createdAt,
    subCategories: c.subCategories.map((s) => ({
      id: s.id,
      name: s.name,
      translations: buildTranslationsMap(s.name, s.translations),
    })),
    pfsLabel: buildPfsLabel(c.pfsGender, c.pfsFamilyName, c.pfsCategoryName),
    efashionLabel: resolveCategoryLabel(efashionLabels, c.efashionCategorieId) ?? null,
    faireLabel: buildFaireLabel(c.faireTaxonomyId),
  }));

  // hasTranslations = a déjà au moins une traduction non-FR (FR est le nom de
  // base). On repart des enregistrements Prisma pour éviter de compter le fr
  // qu'on a seedé plus haut pour l'affichage.
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
    <div className="max-w-[1400px] mx-auto space-y-5 px-4 md:px-6 py-6">
      <PageHeader
        eyebrow="Catalogue"
        title="Catégories"
        subtitle="Organisez votre catalogue produits et leurs mappings marketplaces"
        actions={<CategoriesHeaderActions items={allTranslateItems} />}
      />

      {/* Master/Detail */}
      <CategoriesMasterDetail
        categories={rows}
        hasPfsConfig={hasPfsConfig}
        hasEfashionConfig={hasEfashionConfig}
        hasFaireConfig={hasFaireConfig}
      />
    </div>
  );
}
