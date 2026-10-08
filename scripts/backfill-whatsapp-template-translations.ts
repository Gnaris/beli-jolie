/**
 * scripts/backfill-whatsapp-template-translations.ts
 *
 * Backfill one-shot : complète les champs `bodyEn/bodyDe/bodyIt/bodyEs` des
 * `WhatsAppTemplate` pour un tenant donné. Utilise `translateWhatsAppBody`
 * qui protège les variables `{token}` (firstName, shopName…) avec un
 * sentinel ⟦N⟧ avant l'appel PFS, puis les restaure après — même règle que
 * le save classique via l'admin.
 *
 * Idempotent : ne touche que les colonnes NULL ou vides. Un corps traduit à
 * la main par la cliente (donc non-null) est préservé.
 *
 * Usage :
 *   npx tsx scripts/backfill-whatsapp-template-translations.ts --tenant=issyma
 *   npx tsx scripts/backfill-whatsapp-template-translations.ts --tenant=beliandjolie
 */
import { prisma } from "@/lib/prisma";
import { tenantALS } from "@/lib/tenant-als";
import { translatePhrases, type PfsTranslationLocale } from "@/lib/pfs-translate";

// Note : on duplique ici `protectVariables`/`restoreVariables` au lieu
// d'importer `@/lib/whatsapp-translate` — ce dernier `import "server-only"`,
// non résolvable depuis un script `tsx` hors runtime Next.
type WhatsAppTargetLocale = Exclude<PfsTranslationLocale, "fr">;
const TARGET_LOCALES: WhatsAppTargetLocale[] = ["en", "de", "it", "es"];

const SENTINEL_OPEN = "⟦";
const SENTINEL_CLOSE = "⟧";
const TOKEN_REGEX = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;

function protectVariables(source: string): { masked: string; tokens: string[] } {
  const tokens: string[] = [];
  const masked = source.replace(TOKEN_REGEX, (_m, name: string) => {
    const idx = tokens.length;
    tokens.push(name);
    return `${SENTINEL_OPEN}${idx}${SENTINEL_CLOSE}`;
  });
  return { masked, tokens };
}

function restoreVariables(translated: string, tokens: string[]): string | null {
  if (tokens.length === 0) return translated;
  const seen = new Set<number>();
  const re = new RegExp(`${SENTINEL_OPEN}(\\d+)${SENTINEL_CLOSE}`, "g");
  let ok = true;
  const restored = translated.replace(re, (match, idxStr: string) => {
    const idx = Number.parseInt(idxStr, 10);
    if (Number.isNaN(idx) || idx < 0 || idx >= tokens.length) {
      ok = false;
      return match;
    }
    if (seen.has(idx)) {
      ok = false;
      return match;
    }
    seen.add(idx);
    return `{${tokens[idx]}}`;
  });
  if (!ok || seen.size !== tokens.length) return null;
  if (restored.includes(SENTINEL_OPEN) || restored.includes(SENTINEL_CLOSE)) return null;
  return restored;
}

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
  const rows = await prisma.whatsAppTemplate.findMany({
    where: { tenantId },
    select: {
      id: true,
      title: true,
      body: true,
      bodyEn: true,
      bodyDe: true,
      bodyIt: true,
      bodyEs: true,
    },
  });

  console.log(`[${slug}] ${rows.length} modèle(s) WhatsApp`);
  if (rows.length === 0) return;

  // 1) Prépare les phrases masquées (variables {token} protégées) pour les
  //    templates qui ont au moins une locale manquante.
  type Prep = {
    id: string;
    title: string;
    masked: string;
    tokens: string[];
    missing: WhatsAppTargetLocale[];
  };
  const prepared: Prep[] = [];
  const phrases: Record<string, string> = {};
  for (const row of rows) {
    const current: Record<WhatsAppTargetLocale, string | null> = {
      en: row.bodyEn,
      de: row.bodyDe,
      it: row.bodyIt,
      es: row.bodyEs,
    };
    const missing = TARGET_LOCALES.filter((loc) => !current[loc] || !current[loc]!.trim());
    if (missing.length === 0) {
      console.log(`  "${row.title}" : déjà complet`);
      continue;
    }
    const { masked, tokens } = protectVariables(row.body);
    prepared.push({ id: row.id, title: row.title, masked, tokens, missing });
    phrases[row.id] = masked;
  }

  if (prepared.length === 0) {
    console.log(`[${slug}] Rien à faire ✓`);
    return;
  }

  // 2) Un seul call PFS pour tous les templates — l'API renvoie les 5 locales par clé.
  console.log(`[${slug}] ${prepared.length} modèle(s) → 1 appel PFS`);
  const result = await translatePhrases(phrases);
  if (!result) {
    console.error(`[${slug}] PFS a renvoyé null — abandon`);
    process.exit(1);
  }

  // 3) Restoration + persistance par template.
  let totalWrites = 0;
  const failures: { title: string; locale: WhatsAppTargetLocale }[] = [];
  for (const p of prepared) {
    const perLocale = result[p.id] ?? {};
    const dataUpdate: Record<string, string> = {};
    for (const loc of p.missing) {
      const raw = perLocale[loc]?.trim();
      if (!raw) {
        failures.push({ title: p.title, locale: loc });
        continue;
      }
      const restored = restoreVariables(raw, p.tokens);
      if (restored === null) {
        failures.push({ title: p.title, locale: loc });
        continue;
      }
      const column =
        loc === "en" ? "bodyEn" : loc === "de" ? "bodyDe" : loc === "it" ? "bodyIt" : "bodyEs";
      dataUpdate[column] = restored;
      totalWrites++;
    }
    if (Object.keys(dataUpdate).length > 0) {
      await prisma.whatsAppTemplate.update({
        where: { id: p.id },
        data: dataUpdate,
      });
    }
    console.log(
      `  "${p.title}" : ${Object.keys(dataUpdate).length}/${p.missing.length} locale(s) ajoutée(s)`,
    );
  }

  console.log(
    `[${slug}] Terminé : ${totalWrites} traduction(s) écrite(s), ${failures.length} échec(s)`,
  );
  if (failures.length > 0) {
    for (const f of failures) {
      console.log(`  ⚠ "${f.title}" (${f.locale}) : traduction indisponible`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
