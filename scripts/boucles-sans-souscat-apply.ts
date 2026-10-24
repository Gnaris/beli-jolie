/**
 * Applique un payload { ref, name, description, subCategoryName, tagNames }
 * sur un produit beliandjolie :
 *  - update name/description
 *  - prepend note "Complété par l'IA le DD/MM/YYYY"
 *  - important = true
 *  - crée la sous-catégorie si manquante sous la catégorie du produit
 *  - attache cette (seule) sous-catégorie au produit (replace all)
 *  - setter Product.microstoreSubCategoryId sur l'id de cette sous-catégorie
 *  - crée les tags manquants (anti-doublon via normalize), attache (replace all)
 *  - PAS de drapeaux marketplace levés (demande explicite de la cliente)
 *  - PAS de push vers PFS/Ankor/eFa/Faire/Microstore
 * Usage : npx tsx scripts/boucles-sans-souscat-apply.ts <payload.json>
 */
import "dotenv/config";
import fs from "fs";
import { prisma } from "@/lib/prisma";
import { tenantALS } from "@/lib/tenant-als";
import { normalizeForCompare } from "@/lib/text-normalize";
import { prependAiNote } from "@/lib/ai-note";
import { translatePhrases, type PfsTranslationLocale } from "@/lib/pfs-translate";
import { AUTO_TRANSLATE_LOCALES } from "@/i18n/locales";
import { revalidateTag } from "next/cache";

// Version awaitable de l'auto-traduction : on la call en await dans un script
// batch (sinon le process se termine avant que la promise fire-and-forget
// standard ait eu le temps de hitter PFS + d'écrire ProductTranslation).
async function translateProductAwait(
  productId: string,
  name: string,
  description: string,
): Promise<{ localesWritten: number; skipped?: string }> {
  const cfg = await prisma.siteConfig.findFirst({
    where: { key: "auto_translate_enabled" },
  });
  if (cfg?.value !== "true") {
    return { localesWritten: 0, skipped: "auto_translate_enabled=false" };
  }

  const trimmedName = name.trim();
  const trimmedDesc = description.trim();
  const phrases: Record<string, string> = {};
  if (trimmedName) phrases.name = trimmedName;
  if (trimmedDesc) phrases.description = trimmedDesc;
  if (Object.keys(phrases).length === 0) {
    return { localesWritten: 0, skipped: "nom et description vides" };
  }

  const result = await translatePhrases(phrases, { sourceLanguage: "fr" });
  if (!result) {
    return { localesWritten: 0, skipped: "PFS translate a échoué" };
  }

  let written = 0;
  for (const locale of AUTO_TRANSLATE_LOCALES) {
    const pfsLocale = locale as PfsTranslationLocale;
    const translatedName = phrases.name ? (result.name?.[pfsLocale] ?? "") : "";
    const translatedDesc = phrases.description
      ? (result.description?.[pfsLocale] ?? "")
      : "";

    const finalName = translatedName.trim();
    const finalDesc = translatedDesc.trim();
    if (trimmedName && (!finalName || finalName === trimmedName)) continue;
    if (!finalName && !finalDesc) continue;

    await prisma.productTranslation.upsert({
      where: { productId_locale: { productId, locale } },
      update: { name: finalName, description: finalDesc },
      create: { productId, locale, name: finalName, description: finalDesc },
    });
    written++;
  }
  return { localesWritten: written };
}

const TENANT_SLUG = "beliandjolie";

type Item = {
  ref: string;
  name: string;
  description: string;
  subCategoryName: string;
  tagNames: string[];
};

type Report = {
  ref: string;
  status: "ok" | "error" | "skipped";
  reason?: string;
  subCategoryId?: string;
  subCategoryCreated?: boolean;
  tagsCreated?: number;
  localesTranslated?: number;
  translationSkipped?: string;
};

async function applyItem(item: Item, now: Date): Promise<Report> {
  const product = await prisma.product.findFirst({
    where: { reference: item.ref },
    select: {
      id: true,
      status: true,
      categoryId: true,
      note: true,
    },
  });
  if (!product) return { ref: item.ref, status: "error", reason: "produit introuvable" };
  if (product.status === "ARCHIVED") {
    return { ref: item.ref, status: "skipped", reason: "ARCHIVED" };
  }

  // --- Sous-catégorie : 1 seule, sous la catégorie principale du produit.
  const subName = item.subCategoryName.trim();
  if (!subName) {
    return { ref: item.ref, status: "error", reason: "subCategoryName vide" };
  }
  const subNorm = normalizeForCompare(subName);
  const existingSub = await prisma.subCategory.findFirst({
    where: { categoryId: product.categoryId, name: subName },
    select: { id: true },
  });
  let subCategoryCreated = false;
  let subCategoryId: string;
  if (existingSub) {
    subCategoryId = existingSub.id;
  } else {
    const created = await prisma.subCategory.create({
      data: {
        name: subName,
        slug: subNorm.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
        categoryId: product.categoryId,
      },
      select: { id: true },
    });
    subCategoryId = created.id;
    subCategoryCreated = true;
  }

  // --- Tags : anti-doublon global via normalizeForCompare.
  const existingTags = await prisma.tag.findMany({ select: { id: true, name: true } });
  const tagIdByNormalized = new Map<string, string>();
  for (const t of existingTags) tagIdByNormalized.set(normalizeForCompare(t.name), t.id);

  let tagsCreated = 0;
  const tagIds: string[] = [];
  for (const rawName of item.tagNames) {
    const trimmed = rawName.trim();
    if (!trimmed) continue;
    const norm = normalizeForCompare(trimmed);
    if (!norm) continue;
    let id = tagIdByNormalized.get(norm);
    if (!id) {
      const created = await prisma.tag.create({
        data: { name: trimmed },
        select: { id: true },
      });
      id = created.id;
      tagIdByNormalized.set(norm, id);
      tagsCreated++;
    }
    if (!tagIds.includes(id)) tagIds.push(id);
  }

  await prisma.$transaction(async (tx) => {
    // Nettoyage M2M sous-catégories (il n'y en avait pas, mais sécurité).
    await tx.product.update({
      where: { id: product.id },
      data: {
        subCategories: { set: [] },
      },
    });
    await tx.product.update({
      where: { id: product.id },
      data: {
        name: item.name.trim(),
        description: item.description.trim(),
        note: prependAiNote(product.note, now),
        important: true,
        microstoreSubCategoryId: subCategoryId,
        subCategories: { connect: [{ id: subCategoryId }] },
        tags: {
          deleteMany: {},
          create: tagIds.map((tagId) => ({ tagId })),
        },
      },
    });
    // Traductions : on efface l'anglais existant, la traduction auto PFS les régénérera.
    await tx.productTranslation.deleteMany({ where: { productId: product.id } });
  });

  // Traduction FR → EN/DE/IT/ES via PFS (en await pour que le script attende).
  const trad = await translateProductAwait(
    product.id,
    item.name.trim(),
    item.description.trim(),
  );

  // Invalidation caches (best effort).
  try {
    // @ts-expect-error - Next 16
    revalidateTag("tags", "default");
    // @ts-expect-error - Next 16
    revalidateTag("sub-categories", "default");
    // @ts-expect-error - Next 16
    revalidateTag(`product:${product.id}`, "default");
  } catch {}

  return {
    ref: item.ref,
    status: "ok",
    subCategoryId,
    subCategoryCreated,
    tagsCreated,
    localesTranslated: trad.localesWritten,
    translationSkipped: trad.skipped,
  };
}

(async () => {
  const payloadPath = process.argv[2];
  if (!payloadPath) {
    console.error("Usage: npx tsx scripts/boucles-sans-souscat-apply.ts <payload.json>");
    process.exit(1);
  }

  const tenant = await prisma.tenant.findFirst({
    where: { slug: TENANT_SLUG },
    select: { id: true },
  });
  if (!tenant) throw new Error(`Tenant "${TENANT_SLUG}" introuvable`);

  const payload = JSON.parse(fs.readFileSync(payloadPath, "utf-8")) as { items: Item[] };
  console.log(`📋 ${payload.items.length} produit(s) à appliquer (tenant=${TENANT_SLUG}).`);

  const now = new Date();
  await tenantALS.run(tenant.id, async () => {
    const reports: Report[] = [];
    for (const item of payload.items) {
      try {
        const r = await applyItem(item, now);
        reports.push(r);
        console.log(`  ${item.ref} → ${r.status}${r.reason ? ` (${r.reason})` : ""}`);
      } catch (e: any) {
        const r: Report = { ref: item.ref, status: "error", reason: e?.message ?? String(e) };
        reports.push(r);
        console.log(`  ${item.ref} → error: ${r.reason}`);
      }
    }
    console.log("\n=== RAPPORT ===");
    console.log(JSON.stringify(reports, null, 2));
  });

  await prisma.$disconnect();
})().catch((err) => {
  console.error("ERREUR:", err);
  process.exit(1);
});
