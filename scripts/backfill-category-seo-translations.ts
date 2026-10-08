/**
 * scripts/backfill-category-seo-translations.ts
 *
 * Backfill one-shot : complète les champs SEO par locale d'une Category
 * (seoTitle, seoIntro, seoSecondary, seoFaq) dans `CategoryTranslation`.
 *
 * - seoTitle/seoIntro/seoSecondary : texte brut, traduction PFS directe.
 * - seoFaq : JSON tableau [{ q, a }, …] — on traduit chaque q+a.
 *
 * Idempotent : si une locale a déjà un champ SEO non vide, on ne l'écrase pas.
 *
 * Usage :
 *   npx tsx scripts/backfill-category-seo-translations.ts --tenant=issyma
 */
import { prisma } from "@/lib/prisma";
import { tenantALS } from "@/lib/tenant-als";
import { translatePhrases } from "@/lib/pfs-translate";
import type { Prisma } from "@prisma/client";

const TARGET_LOCALES = ["en", "de", "es", "it"] as const;
type TargetLocale = (typeof TARGET_LOCALES)[number];

const BATCH_PHRASE_SIZE = 10;

type FaqItem = { q: string; a: string };

async function main() {
  const slug = process.argv.find((a) => a.startsWith("--tenant="))?.split("=")[1];
  if (!slug) {
    console.error("Usage: --tenant=<slug>");
    process.exit(1);
  }
  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) {
    console.error(`Tenant "${slug}" introuvable`);
    process.exit(1);
  }
  await tenantALS.run(tenant.id, () => backfill(tenant.slug, tenant.id));
}

function parseFaq(raw: unknown): FaqItem[] {
  if (!raw) return [];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => ({
      q: typeof r.q === "string" ? r.q.trim() : "",
      a: typeof r.a === "string" ? r.a.trim() : "",
    }))
    .filter((it) => it.q && it.a);
}

async function backfill(slug: string, tenantId: string) {
  const categories = await prisma.category.findMany({
    where: { tenantId },
    select: {
      id: true,
      name: true,
      seoTitle: true,
      seoIntro: true,
      seoSecondary: true,
      seoFaq: true,
      translations: {
        select: {
          locale: true,
          seoTitle: true,
          seoIntro: true,
          seoSecondary: true,
          seoFaq: true,
        },
      },
    },
  });

  console.log(`[${slug}] ${categories.length} catégorie(s) chargée(s)`);

  // Construit une map { "catId::field" : phraseFR } pour les champs texte,
  // et { "catId::faq_q_<i>" / "::faq_a_<i>" : phraseFR } pour les FAQ.
  const phrases: Record<string, string> = {};
  const needs: {
    categoryId: string;
    missingLocales: TargetLocale[];
    text: { seoTitle?: string; seoIntro?: string; seoSecondary?: string };
    faq: FaqItem[];
  }[] = [];

  for (const cat of categories) {
    const hasTextFr =
      (cat.seoTitle?.trim() ?? "") ||
      (cat.seoIntro?.trim() ?? "") ||
      (cat.seoSecondary?.trim() ?? "");
    const faqFr = parseFaq(cat.seoFaq);
    if (!hasTextFr && faqFr.length === 0) continue;

    const existingByLocale = new Map(cat.translations.map((t) => [t.locale, t]));
    const missing: TargetLocale[] = [];
    for (const loc of TARGET_LOCALES) {
      const t = existingByLocale.get(loc);
      const hasText =
        (t?.seoTitle?.trim() ?? "") ||
        (t?.seoIntro?.trim() ?? "") ||
        (t?.seoSecondary?.trim() ?? "");
      const hasFaq = parseFaq(t?.seoFaq).length > 0;
      // Si tout ce qui existait en FR est traduit, skip la locale
      const needsText = hasTextFr && !hasText;
      const needsFaq = faqFr.length > 0 && !hasFaq;
      if (needsText || needsFaq) missing.push(loc);
    }
    if (missing.length === 0) continue;

    const text = {
      seoTitle: cat.seoTitle?.trim() || undefined,
      seoIntro: cat.seoIntro?.trim() || undefined,
      seoSecondary: cat.seoSecondary?.trim() || undefined,
    };
    needs.push({ categoryId: cat.id, missingLocales: missing, text, faq: faqFr });

    if (text.seoTitle) phrases[`${cat.id}::seoTitle`] = text.seoTitle;
    if (text.seoIntro) phrases[`${cat.id}::seoIntro`] = text.seoIntro;
    if (text.seoSecondary) phrases[`${cat.id}::seoSecondary`] = text.seoSecondary;
    faqFr.forEach((item, i) => {
      phrases[`${cat.id}::faq_q_${i}`] = item.q;
      phrases[`${cat.id}::faq_a_${i}`] = item.a;
    });
  }

  const keys = Object.keys(phrases);
  if (keys.length === 0) {
    console.log(`[${slug}] Tout est déjà traduit ✓`);
    return;
  }
  console.log(`[${slug}] ${needs.length} catégorie(s) à compléter, ${keys.length} phrase(s) à traduire`);

  // On fragmente par lot de BATCH_PHRASE_SIZE et agrège le résultat.
  const translated: Record<string, Partial<Record<string, string>>> = {};
  for (let i = 0; i < keys.length; i += BATCH_PHRASE_SIZE) {
    const chunkKeys = keys.slice(i, i + BATCH_PHRASE_SIZE);
    const chunkPhrases: Record<string, string> = {};
    for (const k of chunkKeys) chunkPhrases[k] = phrases[k];
    let result: Awaited<ReturnType<typeof translatePhrases>> = null;
    try {
      result = await translatePhrases(chunkPhrases);
    } catch (err) {
      console.warn(`  Batch ${i / BATCH_PHRASE_SIZE + 1} : exception`, err);
    }
    if (!result) continue;
    for (const k of chunkKeys) {
      if (result[k]) translated[k] = result[k];
    }
    console.log(`  ${Math.min(i + BATCH_PHRASE_SIZE, keys.length)}/${keys.length} phrases traduites`);
  }

  // Reconstruit les updates et upsert par (categoryId, locale)
  let writes = 0;
  for (const n of needs) {
    for (const loc of n.missingLocales) {
      const data: Prisma.CategoryTranslationUncheckedUpdateInput = {};
      let changed = false;
      if (n.text.seoTitle) {
        const v = translated[`${n.categoryId}::seoTitle`]?.[loc]?.trim();
        if (v) {
          data.seoTitle = v;
          changed = true;
        }
      }
      if (n.text.seoIntro) {
        const v = translated[`${n.categoryId}::seoIntro`]?.[loc]?.trim();
        if (v) {
          data.seoIntro = v;
          changed = true;
        }
      }
      if (n.text.seoSecondary) {
        const v = translated[`${n.categoryId}::seoSecondary`]?.[loc]?.trim();
        if (v) {
          data.seoSecondary = v;
          changed = true;
        }
      }
      if (n.faq.length > 0) {
        const faqOut: FaqItem[] = [];
        let ok = true;
        for (let i = 0; i < n.faq.length; i++) {
          const q = translated[`${n.categoryId}::faq_q_${i}`]?.[loc]?.trim();
          const a = translated[`${n.categoryId}::faq_a_${i}`]?.[loc]?.trim();
          if (!q || !a) {
            ok = false;
            break;
          }
          faqOut.push({ q, a });
        }
        if (ok) {
          data.seoFaq = faqOut as unknown as Prisma.InputJsonValue;
          changed = true;
        }
      }
      if (!changed) continue;

      // Besoin du `name` au cas où la ligne CategoryTranslation n'existe pas
      // encore pour cette locale (créée par le script taxonomy avant celui-ci,
      // donc en principe toujours présente — mais on gère le cas où non).
      await prisma.categoryTranslation.upsert({
        where: { categoryId_locale: { categoryId: n.categoryId, locale: loc } },
        update: data,
        create: {
          categoryId: n.categoryId,
          locale: loc,
          name: "", // sera renseigné par le script taxonomy
          ...data,
        },
      });
      writes++;
    }
  }

  console.log(`[${slug}] Terminé : ${writes} ligne(s) CategoryTranslation mise(s) à jour`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
