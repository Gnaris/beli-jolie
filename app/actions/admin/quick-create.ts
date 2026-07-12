"use server";

/**
 * Quick-create server actions — create categories, subcategories, colors, etc.
 * on the fly from the admin UI.
 */

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath, revalidateTag } from "next/cache";
import { sanitizePfsFamilyName } from "@/lib/pfs-family-resolve";

/** Renvoie les locales (hors FR) que l'utilisatrice a déjà saisies manuellement
 *  dans la modale — à exclure de l'auto-traduction pour ne pas écraser sa saisie. */
function userProvidedLocales(translations: Record<string, string>): string[] {
  return Object.entries(translations)
    .filter(([locale, value]) => locale !== "fr" && value?.trim().length > 0)
    .map(([locale]) => locale);
}

/**
 * Import dynamique pour éviter de tirer toute la chaîne PFS-auth/cached-data
 * dans les modules qui n'ont besoin que des actions quick-create (tests + RSC
 * qui veulent un graph d'imports minimal).
 */
type AutoTranslateName = keyof typeof import("@/lib/auto-translate");
async function autoTranslate(fn: AutoTranslateName, id: string, name: string, skip: string[]) {
  try {
    const mod = await import("@/lib/auto-translate");
    const handler = mod[fn] as (id: string, name: string, skip?: string[]) => Promise<void>;
    await handler(id, name, skip);
  } catch {
    // Fire-and-forget : l'absence de traduction ne doit jamais bloquer la création.
  }
}

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Non autorisé");
}

function titleCase(name: string): string {
  return name.trim();
}

function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "x";
}

export async function createCategoryQuick(
  translations: Record<string, string>,
  pfsGender?: string | null,
  pfsFamilyName?: string | null,
  pfsCategoryName?: string | null,
  pfsCategoryId?: string | null,
  efashionCategorieId?: number | null,
): Promise<{ id: string; name: string; subCategories: { id: string; name: string }[] }> {
  await requireAdmin();
  const name = titleCase(translations["fr"] ?? Object.values(translations)[0] ?? "");
  if (!name) throw new Error("Le nom (FR) est requis.");
  const gender = pfsGender?.trim() || null;
  // Filtre de sécurité : la famille doit être un nom connu de la taxonomie
  // (pas un identifiant Salesforce brut comme "a035J00000185J7QAI"), sinon on
  // refuse la création — l'admin verrait un mapping incomplet en BDD.
  const familyName = sanitizePfsFamilyName(pfsFamilyName);
  if (!gender || !familyName) {
    throw new Error("Le genre et la famille Paris Fashion Shop sont obligatoires.");
  }
  // Si une catégorie avec ce nom existe déjà, on la met à jour avec les infos PFS
  const existing = await prisma.category.findFirst({ where: { name } });
  if (existing) {
    await prisma.category.update({
      where: { id: existing.id },
      data: {
        pfsGender: gender,
        pfsFamilyName: familyName,
        pfsCategoryName: pfsCategoryName?.trim() || null,
        pfsCategoryId: pfsCategoryId?.trim() || null,
        ...(efashionCategorieId !== undefined ? { efashionCategorieId } : {}),
      },
    });
    for (const [locale, value] of Object.entries(translations)) {
      if (locale === "fr" || !value.trim()) continue;
      await prisma.categoryTranslation.upsert({
        where: { categoryId_locale: { categoryId: existing.id, locale } },
        create: { categoryId: existing.id, locale, name: value.trim() },
        update: { name: value.trim() },
      });
    }
    await autoTranslate("autoTranslateCategory", existing.id, name, userProvidedLocales(translations));
    revalidatePath("/admin/produits");
    revalidateTag("categories", "default");
    const subs = await prisma.subCategory.findMany({
      where: { categoryId: existing.id },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    return { id: existing.id, name: existing.name, subCategories: subs };
  }

  const slug = slugify(name);
  const created = await prisma.category.create({
    data: {
      name,
      slug,
      pfsGender: gender,
      pfsFamilyName: familyName,
      pfsCategoryName: pfsCategoryName?.trim() || null,
      pfsCategoryId: pfsCategoryId?.trim() || null,
      efashionCategorieId: efashionCategorieId ?? null,
    },
  });
  for (const [locale, value] of Object.entries(translations)) {
    if (locale === "fr" || !value.trim()) continue;
    await prisma.categoryTranslation.upsert({
      where: { categoryId_locale: { categoryId: created.id, locale } },
      create: { categoryId: created.id, locale, name: value.trim() },
      update: { name: value.trim() },
    });
  }
  await autoTranslate("autoTranslateCategory", created.id, name, userProvidedLocales(translations));
  revalidatePath("/admin/produits");
  revalidateTag("categories", "default");
  return { id: created.id, name: created.name, subCategories: [] };
}

export async function createSubCategoryQuick(
  translations: Record<string, string>,
  categoryId: string,
): Promise<{ id: string; name: string }> {
  await requireAdmin();
  const name = titleCase(translations["fr"] ?? Object.values(translations)[0] ?? "");
  if (!name) throw new Error("Le nom (FR) est requis.");
  // Idempotent : si la sous-catégorie existe déjà dans cette catégorie
  // (contrainte unique (name, categoryId)), on la retourne au lieu de planter.
  const existing = await prisma.subCategory.findFirst({ where: { name, categoryId } });
  const slug = slugify(name);
  const upserted = existing
    ?? (await prisma.subCategory.create({ data: { name, slug, categoryId } }));
  for (const [locale, value] of Object.entries(translations)) {
    if (locale === "fr" || !value.trim()) continue;
    await prisma.subCategoryTranslation.upsert({
      where: { subCategoryId_locale: { subCategoryId: upserted.id, locale } },
      create: { subCategoryId: upserted.id, locale, name: value.trim() },
      update: { name: value.trim() },
    });
  }
  await autoTranslate("autoTranslateSubCategory", upserted.id, name, userProvidedLocales(translations));
  revalidatePath("/admin/produits");
  revalidateTag("categories", "default");
  return { id: upserted.id, name: upserted.name };
}

export type CreateColorQuickResult =
  | { ok: true; id: string; name: string; hex: string | null; patternImage: string | null }
  | { ok: false; error: string };

export async function createColorQuick(
  translations: Record<string, string>,
  hex: string | null | undefined,
  patternImage: string | null | undefined,
  pfsColorRef?: string | null,
  efashionColorId?: number | null,
): Promise<CreateColorQuickResult> {
  await requireAdmin();
  const name = titleCase(translations["fr"] ?? Object.values(translations)[0] ?? "");
  if (!name) return { ok: false, error: "Le nom (FR) est requis." };
  const existing = await prisma.color.findFirst({
    where: { name: { equals: name } },
    select: { name: true },
  });
  if (existing) {
    // Retourné comme donnée (et non `throw`) pour que le message atteigne le client
    // en production — un throw serait masqué par Next.js en "An error occurred in
    // the Server Components render".
    return { ok: false, error: `La couleur « ${existing.name} » existe déjà dans la bibliothèque.` };
  }
  const created = await prisma.color.create({
    data: {
      name,
      hex: hex ?? null,
      patternImage: patternImage ?? null,
      pfsColorRef: pfsColorRef?.trim() || null,
      efashionColorId: efashionColorId ?? null,
    },
  });
  for (const [locale, value] of Object.entries(translations)) {
    if (locale === "fr" || !value.trim()) continue;
    await prisma.colorTranslation.upsert({
      where: { colorId_locale: { colorId: created.id, locale } },
      create: { colorId: created.id, locale, name: value.trim() },
      update: { name: value.trim() },
    });
  }
  await autoTranslate("autoTranslateColor", created.id, name, userProvidedLocales(translations));

  // Si une liaison eFashion est demandée → on tente systématiquement
  // d'ajouter la couleur au catalogue vendeur eFashion. Si elle y est déjà,
  // eFashion renvoie « Cette couleur est déjà dans votre catalogue » — on
  // ignore cette erreur (cas idempotent). Toute autre erreur est loguée mais
  // ne bloque pas la création BJ (le mapping est déjà posé).
  if (efashionColorId) {
    try {
      const { efashionGetMe } = await import("@/lib/efashion-api");
      const { efashionAddCouleurToVendeur } = await import("@/lib/efashion-api-write");
      const me = await efashionGetMe();
      await efashionAddCouleurToVendeur({
        id_vendeur: me.id_vendeur,
        id_couleur: efashionColorId,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/déjà dans votre catalogue/i.test(msg)) {
        const { logger } = await import("@/lib/logger");
        logger.warn("[eFashion] addCouleurToVendeur failed at color creation", {
          colorId: created.id,
          efashionColorId,
          error: msg,
        });
      }
    }
    // Invalide le cache des annexes pour que la couleur apparaisse comme "in catalog" la prochaine fois
    revalidateTag("efashion-annexes", "default");
  }

  revalidateTag("colors", "default");
  return { ok: true, id: created.id, name: created.name, hex: created.hex, patternImage: created.patternImage };
}

export async function createCompositionQuick(
  translations: Record<string, string>,
  pfsCompositionRef?: string | null,
  efashionId?: number | null,
): Promise<{ id: string; name: string }> {
  await requireAdmin();
  const name = titleCase(translations["fr"] ?? Object.values(translations)[0] ?? "");
  if (!name) throw new Error("Le nom (FR) est requis.");
  // Idempotent : la composition peut déjà exister (contrainte unique sur name).
  // Dans ce cas on met juste à jour ses refs marketplace + traductions.
  const existing = await prisma.composition.findFirst({ where: { name } });
  const upserted = existing
    ? await prisma.composition.update({
        where: { id: existing.id },
        data: {
          ...(pfsCompositionRef !== undefined ? { pfsCompositionRef: pfsCompositionRef ?? null } : {}),
          ...(efashionId !== undefined ? { efashionId } : {}),
        },
      })
    : await prisma.composition.create({
        data: { name, pfsCompositionRef: pfsCompositionRef ?? null, efashionId: efashionId ?? null },
      });
  for (const [locale, value] of Object.entries(translations)) {
    if (locale === "fr" || !value.trim()) continue;
    await prisma.compositionTranslation.upsert({
      where: { compositionId_locale: { compositionId: upserted.id, locale } },
      create: { compositionId: upserted.id, locale, name: value.trim() },
      update: { name: value.trim() },
    });
  }
  await autoTranslate("autoTranslateComposition", upserted.id, name, userProvidedLocales(translations));
  revalidateTag("compositions", "default");
  return { id: upserted.id, name: upserted.name };
}

export async function createManufacturingCountryQuick(
  translations: Record<string, string>,
  isoCode?: string | null,
  pfsCountryRef?: string | null,
  efashionProvenanceId?: number | null,
): Promise<{ id: string; name: string }> {
  await requireAdmin();
  const name = titleCase(translations["fr"] ?? Object.values(translations)[0] ?? "");
  if (!name) throw new Error("Le nom (FR) est requis.");
  const normalizedRef = pfsCountryRef?.trim() || null;
  if (!normalizedRef) {
    throw new Error("La correspondance Paris Fashion Shop est obligatoire.");
  }
  const normalizedIso = isoCode?.trim().toUpperCase() || null;
  if (!normalizedIso) {
    throw new Error("Le code ISO du pays (2 lettres) est obligatoire.");
  }
  if (!/^[A-Z]{2}$/.test(normalizedIso)) {
    throw new Error("Le code ISO doit être composé de 2 lettres (ex: FR, CN, TR).");
  }
  // Si un pays porte déjà ce nom, on met à jour ses refs marketplace +
  // traductions (idempotent). Le contrôle ISO ci-dessous ignore son propre id.
  const existing = await prisma.manufacturingCountry.findFirst({ where: { name } });
  const isoConflict = await prisma.manufacturingCountry.findFirst({
    where: {
      isoCode: normalizedIso,
      ...(existing ? { NOT: { id: existing.id } } : {}),
    },
    select: { name: true },
  });
  if (isoConflict) {
    throw new Error(`Ce code ISO est déjà utilisé par le pays « ${isoConflict.name} ».`);
  }
  const upserted = existing
    ? await prisma.manufacturingCountry.update({
        where: { id: existing.id },
        data: {
          isoCode: normalizedIso,
          pfsCountryRef: normalizedRef,
          ...(efashionProvenanceId !== undefined ? { efashionProvenanceId } : {}),
        },
      })
    : await prisma.manufacturingCountry.create({
        data: {
          name,
          isoCode: normalizedIso,
          pfsCountryRef: normalizedRef,
          efashionProvenanceId: efashionProvenanceId ?? null,
        },
      });
  for (const [locale, value] of Object.entries(translations)) {
    if (locale === "fr" || !value.trim()) continue;
    await prisma.manufacturingCountryTranslation.upsert({
      where: { manufacturingCountryId_locale: { manufacturingCountryId: upserted.id, locale } },
      create: { manufacturingCountryId: upserted.id, locale, name: value.trim() },
      update: { name: value.trim() },
    });
  }
  await autoTranslate("autoTranslateManufacturingCountry", upserted.id, name, userProvidedLocales(translations));
  revalidateTag("manufacturing-countries", "default");
  return { id: upserted.id, name: upserted.name };
}

export async function createSeasonQuick(
  translations: Record<string, string>,
  pfsRef?: string | null,
  efashionCollectionId?: number | null,
): Promise<{ id: string; name: string }> {
  await requireAdmin();
  const name = titleCase(translations["fr"] ?? Object.values(translations)[0] ?? "");
  if (!name) throw new Error("Le nom (FR) est requis.");
  const normalizedRef = pfsRef?.trim().toUpperCase() || null;
  if (!normalizedRef) {
    throw new Error("La correspondance Paris Fashion Shop est obligatoire.");
  }
  // Idempotent : si la saison existe déjà (contrainte unique sur name),
  // on met à jour ses champs marketplace + traductions au lieu de planter.
  const existing = await prisma.season.findFirst({ where: { name } });
  const upserted = existing
    ? await prisma.season.update({
        where: { id: existing.id },
        data: {
          pfsRef: normalizedRef,
          ...(efashionCollectionId !== undefined ? { efashionCollectionId } : {}),
        },
      })
    : await prisma.season.create({
        data: { name, pfsRef: normalizedRef, efashionCollectionId: efashionCollectionId ?? null },
      });
  for (const [locale, value] of Object.entries(translations)) {
    if (locale === "fr" || !value.trim()) continue;
    await prisma.seasonTranslation.upsert({
      where: { seasonId_locale: { seasonId: upserted.id, locale } },
      create: { seasonId: upserted.id, locale, name: value.trim() },
      update: { name: value.trim() },
    });
  }
  await autoTranslate("autoTranslateSeason", upserted.id, name, userProvidedLocales(translations));
  revalidateTag("seasons", "default");
  return { id: upserted.id, name: upserted.name };
}

export async function createTagQuick(
  translations: Record<string, string>,
): Promise<{ id: string; name: string }> {
  await requireAdmin();
  const name = (translations["fr"] ?? Object.values(translations)[0] ?? "").trim().toLowerCase();
  if (!name) throw new Error("Le nom (FR) est requis.");
  let created = await prisma.tag.findFirst({ where: { name } });
  if (!created) {
    created = await prisma.tag.create({ data: { name } });
  }
  for (const [locale, value] of Object.entries(translations)) {
    if (locale === "fr" || !value.trim()) continue;
    await prisma.tagTranslation.upsert({
      where: { tagId_locale: { tagId: created.id, locale } },
      create: { tagId: created.id, locale, name: value.trim() },
      update: { name: value.trim() },
    });
  }
  await autoTranslate("autoTranslateTag", created.id, name, userProvidedLocales(translations));
  revalidateTag("tags", "default");
  return { id: created.id, name: created.name };
}
