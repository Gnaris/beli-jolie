/**
 * Rattrapage : ajoute aux produits existants les traductions manquantes en
 * EN / ES / DE / IT à partir du nom et de la description en français.
 *
 * Pourquoi : jusqu'au 2026-06-06, l'auto-traduction au save ne ciblait que les
 * locales d'affichage du site (FR + EN), donc les exports vers les marketplaces
 * (PFS, Ankorstore, etc.) sortaient les colonnes ES/DE/IT vides. Désormais on
 * stocke aussi ES/DE/IT en base — ce script remplit la base pour les produits
 * créés avant ce changement.
 *
 * Usage : NODE_ENV=production npx tsx scripts/backfill-product-translations.ts
 *
 * Options :
 *   --dry-run       n'écrit rien, affiche seulement ce qui serait fait
 *   --limit=N       n'traite que les N premiers produits (utile pour tester)
 *   --sleep=MS      pause entre 2 produits (défaut: 200 ms) — évite de saturer PFS
 *   --batch=N       sauvegarde par lots de N produits (défaut: 50)
 *
 * Logs : ligne par produit avec ✓ (créé), ↻ (mis à jour), · (déjà à jour), ✗ (échec).
 */

import { prisma } from "@/lib/prisma";
import { translateToAllLocales } from "@/lib/pfs-translate";
import { logger } from "@/lib/logger";

const TARGET_LOCALES = ["en", "es", "de", "it"] as const;
type TargetLocale = (typeof TARGET_LOCALES)[number];

interface Options {
  dryRun: boolean;
  limit: number | null;
  sleepMs: number;
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const opts: Options = { dryRun: false, limit: null, sleepMs: 200 };
  for (const a of args) {
    if (a === "--dry-run") opts.dryRun = true;
    else if (a.startsWith("--limit=")) opts.limit = parseInt(a.slice("--limit=".length), 10);
    else if (a.startsWith("--sleep=")) opts.sleepMs = parseInt(a.slice("--sleep=".length), 10);
  }
  return opts;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const opts = parseArgs();
  console.log(`▶ Rattrapage traductions produits — dryRun=${opts.dryRun}, limit=${opts.limit ?? "tous"}, sleep=${opts.sleepMs}ms`);

  // 1) Récupère tous les produits non archivés avec leurs traductions existantes
  const products = await prisma.product.findMany({
    where: { status: { not: "ARCHIVED" } },
    select: {
      id: true,
      reference: true,
      name: true,
      description: true,
      translations: { select: { locale: true, name: true, description: true } },
    },
    orderBy: { createdAt: "asc" },
    ...(opts.limit ? { take: opts.limit } : {}),
  });

  console.log(`  ${products.length} produits à inspecter`);

  let nbCreated = 0;
  let nbUpdated = 0;
  let nbSkipped = 0;
  let nbFailed = 0;

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    const existingByLocale = new Map(p.translations.map((t) => [t.locale, t]));
    // Identifie les locales pour lesquelles il manque le nom OU la description.
    const missing = TARGET_LOCALES.filter((l) => {
      const t = existingByLocale.get(l);
      if (!t) return true;
      if (!t.name?.trim()) return true;
      if (p.description?.trim() && !t.description?.trim()) return true;
      return false;
    });

    if (missing.length === 0) {
      nbSkipped++;
      process.stdout.write(`[${i + 1}/${products.length}] · ${p.reference}\n`);
      continue;
    }

    try {
      // 1 seul appel PFS par texte renvoie toutes les locales d'un coup.
      const [allNames, allDescs] = await Promise.all([
        p.name?.trim() ? translateToAllLocales(p.name) : Promise.resolve({} as Record<string, string>),
        p.description?.trim() ? translateToAllLocales(p.description) : Promise.resolve({} as Record<string, string>),
      ]);

      let touched = 0;
      let created = 0;
      for (const locale of missing) {
        const finalName = (allNames[locale] ?? "").trim();
        const finalDesc = (allDescs[locale] ?? "").trim();
        if (!finalName) continue; // PFS a échoué pour cette locale

        if (!opts.dryRun) {
          const existed = existingByLocale.has(locale);
          await prisma.productTranslation.upsert({
            where: { productId_locale: { productId: p.id, locale } },
            update: { name: finalName, description: finalDesc },
            create: { productId: p.id, locale, name: finalName, description: finalDesc },
          });
          if (existed) touched++;
          else created++;
        } else {
          touched++;
        }
      }

      if (created > 0) nbCreated++;
      if (touched > 0 && created === 0) nbUpdated++;

      const flag = created > 0 ? "✓" : "↻";
      const verb = opts.dryRun ? "(dry-run)" : "";
      process.stdout.write(
        `[${i + 1}/${products.length}] ${flag} ${p.reference} → +${created} créées, ${touched} mises à jour ${verb}\n`,
      );
    } catch (err) {
      nbFailed++;
      const msg = err instanceof Error ? err.message : String(err);
      process.stdout.write(`[${i + 1}/${products.length}] ✗ ${p.reference} : ${msg}\n`);
      logger.warn("[backfill-translations] product failed", { reference: p.reference, error: msg });
    }

    if (opts.sleepMs > 0 && i < products.length - 1) {
      await sleep(opts.sleepMs);
    }
  }

  console.log("");
  console.log("─".repeat(50));
  console.log(`  Créées (au moins 1 locale nouvelle) : ${nbCreated}`);
  console.log(`  Mises à jour                        : ${nbUpdated}`);
  console.log(`  Déjà à jour (rien à faire)          : ${nbSkipped}`);
  console.log(`  Échecs                              : ${nbFailed}`);
  console.log("─".repeat(50));

  if (opts.dryRun) {
    console.log("⚠ Mode --dry-run : aucune écriture en base n'a été faite.");
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error("Fatal :", e);
    await prisma.$disconnect();
    process.exit(1);
  });
