/**
 * scripts/backfill-seo-texts-translations.ts
 *
 * Backfill one-shot : traduit les 4 textes SEO FR (seo_tagline, home_seo_text,
 * produits_seo_text, produits_seo_intro) vers les 4 locales non-FR (en, de,
 * es, it) via l'API PFS, puis écrit les 16 clés SiteConfig correspondantes.
 *
 * Idempotent : une clé localisée déjà remplie n'est pas écrasée (ex. la cliente
 * a rédigé la version EN à la main → on ne la retouche pas).
 *
 * Garde-fou longueur : si une traduction dépasse les limites admin (80 pour
 * `seo_tagline`, 400 pour `produits_seo_intro`), on tronque proprement au
 * dernier espace avant la limite + « … » — sinon un save manuel ultérieur de
 * l'écran admin refuserait la valeur.
 *
 * Usage :
 *   npx tsx scripts/backfill-seo-texts-translations.ts --tenant=beliandjolie
 *   npx tsx scripts/backfill-seo-texts-translations.ts --tenant=issyma
 */
import { prisma } from "@/lib/prisma";
import { tenantALS } from "@/lib/tenant-als";
import { translatePhrases } from "@/lib/pfs-translate";
import { setSiteConfig } from "@/lib/site-config-write";
import { NON_DEFAULT_LOCALES } from "@/i18n/locales";

const FIELDS = {
  seo_tagline: 80,
  produits_seo_intro: 400,
  home_seo_text: 5000,
  produits_seo_text: 5000,
} as const;
type Field = keyof typeof FIELDS;

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

function truncateAtWord(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  // On réserve 1 char pour « … »
  const target = Math.max(0, maxLen - 1);
  const sliced = text.slice(0, target);
  const lastSpace = sliced.lastIndexOf(" ");
  const cut = lastSpace > target * 0.6 ? lastSpace : target;
  return sliced.slice(0, cut).trimEnd() + "…";
}

async function backfill(slug: string, tenantId: string) {
  // 1) Charge FR + locales existantes
  const allKeys: string[] = [...Object.keys(FIELDS)];
  for (const loc of NON_DEFAULT_LOCALES) {
    for (const f of Object.keys(FIELDS)) allKeys.push(`${f}_${loc}`);
  }
  const rows = await prisma.siteConfig.findMany({
    where: { tenantId, key: { in: allKeys } },
    select: { key: true, value: true },
  });
  const map = new Map(rows.map((r) => [r.key, (r.value ?? "").trim()]));

  const phrases: Record<string, string> = {};
  const toTranslate: { field: Field; locales: string[] }[] = [];

  for (const field of Object.keys(FIELDS) as Field[]) {
    const fr = map.get(field) ?? "";
    if (!fr) {
      console.log(`[${slug}] "${field}" vide en FR — skip`);
      continue;
    }
    const missing = NON_DEFAULT_LOCALES.filter((loc) => !map.get(`${field}_${loc}`));
    if (missing.length === 0) {
      console.log(`[${slug}] "${field}" déjà traduit partout`);
      continue;
    }
    phrases[field] = fr;
    toTranslate.push({ field, locales: missing });
  }

  if (toTranslate.length === 0) {
    console.log(`[${slug}] Rien à faire ✓`);
    return;
  }

  console.log(
    `[${slug}] ${toTranslate.length} champ(s) à traduire : ${toTranslate.map((t) => t.field).join(", ")}`,
  );

  const result = await translatePhrases(phrases);
  if (!result) {
    console.error(`[${slug}] PFS a renvoyé null — abandon`);
    process.exit(1);
  }

  let writes = 0;
  let truncations = 0;
  for (const { field, locales } of toTranslate) {
    const perLocale = result[field] ?? {};
    const maxLen = FIELDS[field];
    for (const loc of locales) {
      const raw = perLocale[loc as "en" | "de" | "es" | "it"]?.trim();
      if (!raw) {
        console.warn(`  ⚠ ${field} / ${loc} : traduction indisponible`);
        continue;
      }
      let value = raw;
      if (value.length > maxLen) {
        value = truncateAtWord(value, maxLen);
        truncations++;
        console.warn(`  ⚠ ${field}_${loc} tronqué (${raw.length} → ${value.length} car.)`);
      }
      await setSiteConfig(`${field}_${loc}`, value, { tenantId });
      writes++;
    }
  }

  console.log(`[${slug}] Terminé : ${writes} clé(s) écrite(s), ${truncations} troncature(s)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
