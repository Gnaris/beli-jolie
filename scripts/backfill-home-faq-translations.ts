/**
 * scripts/backfill-home-faq-translations.ts
 *
 * Backfill one-shot : complète les traductions (en/de/es/it) de la FAQ affichée
 * sur la page d'accueil pour un tenant donné.
 *
 * Lecture : `SiteConfig[home_faq]` (JSON array d'items { id, question, answer,
 * questionEn?, answerEn?, translations? }).
 *
 * Comportement :
 *   - EN existant (format legacy `questionEn`/`answerEn` OU nouveau
 *     `translations.en`) est PRÉSERVÉ (texte souvent écrit à la main par la
 *     cliente, pas la peine de le réécraser).
 *   - DE/ES/IT manquants sont traduits via l'API PFS en un seul appel groupé.
 *   - Format de sortie normalisé : `translations.{en,de,es,it}` + nettoyage
 *     des champs legacy `questionEn`/`answerEn`.
 *
 * Usage :
 *   npx tsx scripts/backfill-home-faq-translations.ts --tenant=beliandjolie
 *   npx tsx scripts/backfill-home-faq-translations.ts --tenant=issyma
 */
import { prisma } from "@/lib/prisma";
import { tenantALS } from "@/lib/tenant-als";
import { translatePhrases } from "@/lib/pfs-translate";
import { setSiteConfig } from "@/lib/site-config-write";

const TARGET_LOCALES = ["en", "de", "es", "it"] as const;
type TargetLocale = (typeof TARGET_LOCALES)[number];

type FaqItemIn = {
  id?: string;
  question?: string;
  answer?: string;
  questionEn?: string;
  answerEn?: string;
  translations?: Record<string, { question?: string; answer?: string }>;
};
type FaqItemOut = {
  id: string;
  question: string;
  answer: string;
  translations: Record<string, { question?: string; answer?: string }>;
};

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

async function backfill(slug: string, tenantId: string) {
  const row = await prisma.siteConfig.findFirst({
    where: { tenantId, key: "home_faq" },
  });
  if (!row?.value) {
    console.log(`[${slug}] Aucune FAQ configurée — rien à faire`);
    return;
  }

  let items: FaqItemIn[];
  try {
    const parsed = JSON.parse(row.value);
    if (!Array.isArray(parsed)) throw new Error("home_faq n'est pas un tableau");
    items = parsed;
  } catch (err) {
    console.error(`[${slug}] home_faq invalide :`, err);
    process.exit(1);
  }

  console.log(`[${slug}] ${items.length} item(s) FAQ chargé(s)`);

  // 1) Pour chaque item, poser translations.en depuis le legacy si pas déjà présent
  const normalized: FaqItemOut[] = items.map((it, i) => {
    const translations: Record<string, { question?: string; answer?: string }> = { ...(it.translations ?? {}) };
    const legacyQ = it.questionEn?.trim();
    const legacyA = it.answerEn?.trim();
    if ((legacyQ || legacyA) && !translations.en) {
      translations.en = {};
      if (legacyQ) translations.en.question = legacyQ;
      if (legacyA) translations.en.answer = legacyA;
    }
    return {
      id: typeof it.id === "string" && it.id ? it.id : `faq-${i}`,
      question: (it.question ?? "").trim(),
      answer: (it.answer ?? "").trim(),
      translations,
    };
  });

  // 2) Collecte des phrases manquantes à faire traduire par PFS
  const phrases: Record<string, string> = {};
  for (const it of normalized) {
    for (const loc of TARGET_LOCALES) {
      const existing = it.translations[loc];
      if (existing?.question?.trim() && existing?.answer?.trim()) continue; // déjà complet
      // On traduit nom+réponse d'un coup — PFS renvoie les 5 locales par call,
      // donc on utilise toujours la même paire de clés quelle que soit la locale manquante.
      if (it.question) phrases[`q::${it.id}`] = it.question;
      if (it.answer) phrases[`a::${it.id}`] = it.answer;
    }
  }

  if (Object.keys(phrases).length === 0) {
    console.log(`[${slug}] Tout est déjà traduit — rien à faire ✓`);
    return;
  }

  console.log(`[${slug}] ${Object.keys(phrases).length} phrase(s) à envoyer à PFS`);
  const result = await translatePhrases(phrases);
  if (!result) {
    console.error(`[${slug}] PFS a renvoyé null — abandon`);
    process.exit(1);
  }

  // 3) Fusion : pour chaque item × locale manquante, pose la traduction PFS
  //    uniquement si l'EN manquait ou si la locale est de/es/it (jamais écraser
  //    un EN manuel existant).
  let writes = 0;
  for (const it of normalized) {
    const perQ = result[`q::${it.id}`];
    const perA = result[`a::${it.id}`];
    for (const loc of TARGET_LOCALES) {
      const existing = it.translations[loc] ?? {};
      let changed = false;
      if (!existing.question?.trim() && perQ?.[loc]?.trim()) {
        existing.question = perQ[loc]!.trim();
        changed = true;
      }
      if (!existing.answer?.trim() && perA?.[loc]?.trim()) {
        existing.answer = perA[loc]!.trim();
        changed = true;
      }
      if (changed) {
        it.translations[loc] = existing;
        writes++;
      }
    }
  }

  // 4) Nettoyage : on produit la forme stable (pas de legacy, translations
  //    triées par locale pour un diff lisible).
  const cleaned = normalized.map((it) => {
    const ordered: Record<string, { question?: string; answer?: string }> = {};
    for (const loc of TARGET_LOCALES) {
      const t = it.translations[loc];
      if (!t) continue;
      const q = t.question?.trim();
      const a = t.answer?.trim();
      if (!q && !a) continue;
      ordered[loc] = {};
      if (q) ordered[loc].question = q;
      if (a) ordered[loc].answer = a;
    }
    const out: FaqItemOut = {
      id: it.id,
      question: it.question,
      answer: it.answer,
      translations: ordered,
    };
    return out;
  });

  await setSiteConfig("home_faq", JSON.stringify(cleaned), { tenantId });

  console.log(`[${slug}] ${writes} traduction(s) ajoutée(s) · ${cleaned.length} item(s) sauvegardé(s)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
