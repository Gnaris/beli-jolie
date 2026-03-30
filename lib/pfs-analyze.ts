/**
 * PFS Analyze Processor (Background Job)
 *
 * Analyzes PFS products to detect missing entities (categories, colors,
 * compositions, countries, seasons, sizes) — only for products that
 * don't already exist in the BJ database (matched by reference).
 *
 * Runs as a fire-and-forget background job, writing progress to PfsPrepareJob.
 * When done:
 *   - If missing entities → status NEEDS_VALIDATION (admin maps entities)
 *   - If all entities mapped → status RUNNING + starts prepare automatically
 */

import { prisma } from "@/lib/prisma";
import {
  pfsListProducts,
  pfsCheckReference,
  type PfsProduct,
} from "@/lib/pfs-api";
import { normalizeColorName } from "@/lib/import-processor";
import { stripVersionSuffix, PAGE_CONCURRENCY } from "@/lib/pfs-sync";
import { logger } from "@/lib/logger";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface MissingCategory {
  pfsName: string;
  pfsCategoryId: string;
  pfsGender: string;
  pfsFamilyId: string;
  suggestedName: string;
  usedBy: number;
  pfsLabels: Record<string, string>;
}

interface MissingColor {
  pfsName: string;
  pfsReference: string;
  suggestedName: string;
  hex: string | null;
  usedBy: number;
  pfsLabels: Record<string, string>;
}

interface MissingComposition {
  pfsName: string;
  pfsReference: string;
  suggestedName: string;
  usedBy: number;
  pfsLabels: Record<string, string>;
}

interface MissingCountry {
  pfsReference: string;
  suggestedName: string;
  pfsLabels: Record<string, string>;
}

interface MissingSeason {
  pfsReference: string;
  suggestedName: string;
  pfsLabels: Record<string, string>;
}

interface MissingSize {
  name: string;
  usedBy: number;
  pfsCategoryIds: string[];
}

// ─────────────────────────────────────────────
// ISO country code → French country name
// ─────────────────────────────────────────────

const ISO_COUNTRY_FR: Record<string, string> = {
  AF: "Afghanistan", AL: "Albanie", DZ: "Algérie", AD: "Andorre", AO: "Angola",
  AG: "Antigua-et-Barbuda", AR: "Argentine", AM: "Arménie", AU: "Australie", AT: "Autriche",
  AZ: "Azerbaïdjan", BS: "Bahamas", BH: "Bahreïn", BD: "Bangladesh", BB: "Barbade",
  BY: "Biélorussie", BE: "Belgique", BZ: "Belize", BJ: "Bénin", BT: "Bhoutan",
  BO: "Bolivie", BA: "Bosnie-Herzégovine", BW: "Botswana", BR: "Brésil",
  BN: "Brunéi", BG: "Bulgarie", BF: "Burkina Faso", BI: "Burundi", CV: "Cap-Vert",
  KH: "Cambodge", CM: "Cameroun", CA: "Canada", CF: "Centrafrique", TD: "Tchad",
  CL: "Chili", CN: "Chine", CO: "Colombie", KM: "Comores", CG: "Congo",
  CD: "Congo (RDC)", CR: "Costa Rica", HR: "Croatie", CU: "Cuba", CY: "Chypre",
  CZ: "Tchéquie", DK: "Danemark", DJ: "Djibouti", DM: "Dominique", DO: "Rép. dominicaine",
  EC: "Équateur", EG: "Égypte", SV: "Salvador", GQ: "Guinée équatoriale",
  ER: "Érythrée", EE: "Estonie", SZ: "Eswatini", ET: "Éthiopie", FJ: "Fidji",
  FI: "Finlande", FR: "France", GA: "Gabon", GM: "Gambie", GE: "Géorgie",
  DE: "Allemagne", GH: "Ghana", GR: "Grèce", GD: "Grenade", GT: "Guatemala",
  GN: "Guinée", GW: "Guinée-Bissau", GY: "Guyana", HT: "Haïti", HN: "Honduras",
  HU: "Hongrie", IS: "Islande", IN: "Inde", ID: "Indonésie", IR: "Iran",
  IQ: "Irak", IE: "Irlande", IL: "Israël", IT: "Italie", JM: "Jamaïque",
  JP: "Japon", JO: "Jordanie", KZ: "Kazakhstan", KE: "Kenya", KI: "Kiribati",
  KW: "Koweït", KG: "Kirghizistan", LA: "Laos", LV: "Lettonie", LB: "Liban",
  LS: "Lesotho", LR: "Libéria", LY: "Libye", LI: "Liechtenstein", LT: "Lituanie",
  LU: "Luxembourg", MG: "Madagascar", MW: "Malawi", MY: "Malaisie", MV: "Maldives",
  ML: "Mali", MT: "Malte", MH: "Marshall", MR: "Mauritanie", MU: "Maurice",
  MX: "Mexique", FM: "Micronésie", MD: "Moldavie", MC: "Monaco", MN: "Mongolie",
  ME: "Monténégro", MA: "Maroc", MZ: "Mozambique", MM: "Myanmar", NA: "Namibie",
  NR: "Nauru", NP: "Népal", NL: "Pays-Bas", NZ: "Nouvelle-Zélande", NI: "Nicaragua",
  NE: "Niger", NG: "Nigéria", NO: "Norvège", OM: "Oman", PK: "Pakistan",
  PW: "Palaos", PA: "Panama", PG: "Papouasie-Nvl-Guinée", PY: "Paraguay",
  PE: "Pérou", PH: "Philippines", PL: "Pologne", PT: "Portugal", QA: "Qatar",
  RO: "Roumanie", RU: "Russie", RW: "Rwanda", KN: "Saint-Kitts", LC: "Sainte-Lucie",
  VC: "Saint-Vincent", WS: "Samoa", SM: "Saint-Marin", ST: "São Tomé-et-Príncipe",
  SA: "Arabie saoudite", SN: "Sénégal", RS: "Serbie", SC: "Seychelles",
  SL: "Sierra Leone", SG: "Singapour", SK: "Slovaquie", SI: "Slovénie",
  SB: "Salomon", SO: "Somalie", ZA: "Afrique du Sud", SS: "Soudan du Sud",
  ES: "Espagne", LK: "Sri Lanka", SD: "Soudan", SR: "Suriname", SE: "Suède",
  CH: "Suisse", SY: "Syrie", TW: "Taïwan", TJ: "Tadjikistan", TZ: "Tanzanie",
  TH: "Thaïlande", TL: "Timor oriental", TG: "Togo", TO: "Tonga", TT: "Trinité-et-Tobago",
  TN: "Tunisie", TR: "Turquie", TM: "Turkménistan", TV: "Tuvalu", UG: "Ouganda",
  UA: "Ukraine", AE: "Émirats arabes unis", GB: "Royaume-Uni", US: "États-Unis",
  UY: "Uruguay", UZ: "Ouzbékistan", VU: "Vanuatu", VE: "Venezuela", VN: "Viêt Nam",
  YE: "Yémen", ZM: "Zambie", ZW: "Zimbabwe",
};

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function slugify(str: string): string {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const REFCHECK_CONCURRENCY = 15;
const MAX_ANALYZE_LOGS = 500;

// ─────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────

export async function runPfsAnalyze(
  jobId: string,
  options?: { limit?: number },
): Promise<void> {
  const maxProducts = options?.limit ?? 0;
  const analyzeLogs: string[] = [];

  const addLog = (msg: string) => {
    const time = new Date().toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    analyzeLogs.push(`[${time}] ${msg}`);
    if (analyzeLogs.length > MAX_ANALYZE_LOGS) analyzeLogs.shift();
  };

  const updateJob = async (data: Record<string, unknown>) => {
    await prisma.pfsPrepareJob.update({
      where: { id: jobId },
      data: {
        ...data,
        logs: { analyzeLogs },
      },
    });
  };

  const checkStopped = async (): Promise<boolean> => {
    const current = await prisma.pfsPrepareJob.findUnique({
      where: { id: jobId },
      select: { status: true },
    });
    return current?.status === "STOPPED";
  };

  try {
    addLog("Chargement des données existantes...");
    await updateJob({});

    // ── 1. Load existing DB entities ──
    const [dbCategories, dbColors, dbCompositions, dbCountries, dbSeasons, dbSizes, pfsMappings] =
      await Promise.all([
        prisma.category.findMany({ select: { id: true, name: true, slug: true, pfsCategoryId: true } }),
        prisma.color.findMany({ select: { id: true, name: true, hex: true, patternImage: true, pfsColorRef: true } }),
        prisma.composition.findMany({ select: { id: true, name: true, pfsCompositionRef: true } }),
        prisma.manufacturingCountry.findMany({ select: { id: true, name: true, isoCode: true, pfsCountryRef: true } }),
        prisma.season.findMany({ select: { id: true, name: true, pfsRef: true } }),
        prisma.size.findMany({ select: { id: true, name: true } }),
        prisma.pfsMapping.findMany({ select: { type: true, pfsName: true, bjName: true } }),
      ]);

    // Sets for fast lookup
    const categorySlugs = new Set<string>(dbCategories.map((c) => slugify(c.name)));
    const categoryNames = new Set<string>(dbCategories.map((c) => c.name.toLowerCase()));
    const categoryPfsIds = new Set<string>(
      dbCategories.filter((c) => c.pfsCategoryId).map((c) => c.pfsCategoryId!),
    );
    const colorNormalized = new Set<string>(dbColors.map((c) => normalizeColorName(c.name)));
    const colorPfsRefs = new Set<string>(
      dbColors.filter((c) => c.pfsColorRef).map((c) => c.pfsColorRef!.toUpperCase()),
    );
    const bjSizeNames = new Set<string>(dbSizes.map((s) => s.name.toLowerCase()));

    const compByRef = new Set<string>(
      dbCompositions.filter((c) => c.pfsCompositionRef).map((c) => c.pfsCompositionRef!.toUpperCase()),
    );
    const compByName = new Set<string>(dbCompositions.map((c) => normalizeColorName(c.name)));

    const countryByRef = new Set<string>(
      dbCountries.filter((c) => c.pfsCountryRef).map((c) => c.pfsCountryRef!.toUpperCase()),
    );
    const countryByIso = new Set<string>(
      dbCountries.filter((c) => c.isoCode).map((c) => c.isoCode!.toUpperCase()),
    );
    const countryByName = new Set<string>(dbCountries.map((c) => c.name.toUpperCase()));

    const seasonByRef = new Set<string>(
      dbSeasons.filter((s) => s.pfsRef).map((s) => s.pfsRef!.toUpperCase()),
    );
    const seasonByName = new Set<string>(dbSeasons.map((s) => s.name.toLowerCase()));

    // Build PfsMapping set (orphan-safe)
    const mappingSet = new Set<string>();
    for (const m of pfsMappings) {
      const key = `${m.type}::${m.pfsName.toLowerCase()}`;
      if (m.type === "category") {
        if (categorySlugs.has(slugify(m.bjName)) || categoryNames.has(m.bjName.toLowerCase())) {
          mappingSet.add(key);
        }
      } else if (m.type === "color") {
        if (colorNormalized.has(normalizeColorName(m.bjName))) {
          mappingSet.add(key);
        }
      } else if (m.type === "composition") {
        if (compByName.has(normalizeColorName(m.bjName))) {
          mappingSet.add(key);
        }
      } else if (m.type === "country") {
        if (countryByName.has(m.bjName.toUpperCase())) {
          mappingSet.add(key);
        }
      } else if (m.type === "season") {
        if (seasonByName.has(m.bjName.toLowerCase())) {
          mappingSet.add(key);
        }
      } else {
        mappingSet.add(key);
      }
    }

    addLog(
      `${dbCategories.length} catégories, ${dbColors.length} couleurs, ${dbCompositions.length} compositions, ${dbCountries.length} pays, ${dbSeasons.length} saisons, ${dbSizes.length} tailles chargés`,
    );
    await updateJob({});

    // ── 2. Phase 1 — Paginate PFS products & filter only new ones ──
    const missingCategories = new Map<string, MissingCategory>();
    const missingColors = new Map<string, MissingColor>();
    const missingSizesInternal = new Map<string, { name: string; usedBy: number; catIds: Set<string> }>();
    const scannedRefs: string[] = [];
    const seenRefs = new Set<string>();

    let totalScanned = 0;
    let totalNewProducts = 0;
    let totalExistingSkipped = 0;
    let page = 1;
    let lastPage = Infinity;
    let errorPages = 0;

    const processProduct = (product: PfsProduct) => {
      analyzeColors(product, missingColors, colorNormalized, mappingSet, colorPfsRefs);
      analyzeCategory(product, missingCategories, categorySlugs, categoryNames, mappingSet, categoryPfsIds);
      analyzeSizes(product, missingSizesInternal, bjSizeNames);

      const ref = product.reference;
      if (ref && !seenRefs.has(ref)) {
        seenRefs.add(ref);
        scannedRefs.push(ref);
      }
      totalNewProducts++;
    };

    // First page
    try {
      const firstResponse = await pfsListProducts(1, 100);
      if (firstResponse.meta?.last_page) lastPage = firstResponse.meta.last_page;

      if (firstResponse.data?.length > 0) {
        const firstPageProducts = firstResponse.data;

        // Filter out existing products first, then limit
        const filtered = await filterNewProducts(firstPageProducts);
        totalScanned += firstPageProducts.length;
        totalExistingSkipped += firstPageProducts.length - filtered.length;

        const toProcess = maxProducts > 0 ? filtered.slice(0, maxProducts) : filtered;
        for (const product of toProcess) processProduct(product);
      }

      addLog(
        `Page 1/${lastPage < Infinity ? lastPage : "?"} — ${totalScanned} analysés, ${totalNewProducts} nouveaux, ${totalExistingSkipped} existants ignorés`,
      );
      await updateJob({ totalProducts: totalNewProducts });
      page = 2;
    } catch (err) {
      addLog(`❌ Erreur page 1: ${err instanceof Error ? err.message : "Erreur inconnue"}`);
      await prisma.pfsPrepareJob.update({
        where: { id: jobId },
        data: {
          status: "FAILED",
          errorMessage: err instanceof Error ? err.message : "Erreur page 1",
          logs: { analyzeLogs },
        },
      });
      return;
    }

    // Remaining pages — keep scanning until we find enough NEW products
    while (page <= lastPage) {
      // Stop when we have enough new products (not scanned, but actual new)
      if (maxProducts > 0 && totalNewProducts >= maxProducts) break;

      if (await checkStopped()) {
        addLog("⏹ Arrêt demandé par l'administrateur");
        break;
      }

      const batchEnd = Math.min(page + PAGE_CONCURRENCY - 1, lastPage);
      const pageNumbers: number[] = [];
      for (let p = page; p <= batchEnd; p++) pageNumbers.push(p);

      addLog(
        `Pages ${page}-${batchEnd}/${lastPage} en parallèle — ${totalScanned} analysés, ${totalNewProducts} nouveaux...`,
      );

      const results = await Promise.allSettled(pageNumbers.map((p) => pfsListProducts(p, 100)));

      let batchEmpty = true;
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === "rejected") {
          errorPages++;
          continue;
        }
        const response = result.value;
        if (!response.data?.length) continue;

        batchEmpty = false;
        const pageProducts = response.data;

        // Filter out existing products first, then limit to what we still need
        const filtered = await filterNewProducts(pageProducts);
        totalScanned += pageProducts.length;
        totalExistingSkipped += pageProducts.length - filtered.length;

        let toProcess = filtered;
        if (maxProducts > 0) {
          const remaining = maxProducts - totalNewProducts;
          if (remaining <= 0) break;
          toProcess = filtered.slice(0, remaining);
        }

        for (const product of toProcess) processProduct(product);
      }

      await updateJob({ totalProducts: totalNewProducts });

      if (batchEmpty && results.every((r) => r.status === "fulfilled")) break;
      page = batchEnd + 1;
      await new Promise((r) => setTimeout(r, 200));
    }

    // Check if stopped
    if (await checkStopped()) {
      addLog(`⏹ Analyse arrêtée — ${totalScanned} analysés, ${totalNewProducts} nouveaux`);
      await updateJob({});
      return;
    }

    if (errorPages > 0) {
      addLog(`⚠️ ${errorPages} page(s) en erreur — résultats partiels`);
    }

    addLog(
      `Phase 1 terminée — ${totalScanned} produits scannés, ${totalNewProducts} nouveaux, ${totalExistingSkipped} déjà existants`,
    );

    // ── If no new products found, complete early ──
    if (totalNewProducts === 0) {
      addLog("🏁 Aucun nouveau produit à importer — tous les produits PFS sont déjà dans la boutique.");
      await prisma.pfsPrepareJob.update({
        where: { id: jobId },
        data: {
          status: "COMPLETED",
          totalProducts: 0,
          analyzeResult: {
            totalScanned,
            totalNewProducts: 0,
            totalExistingSkipped,
            missingEntities: { categories: [], colors: [], compositions: [], countries: [], seasons: [], sizes: [] },
            existingMappings: pfsMappings.length,
            existingEntities: {},
            limit: maxProducts > 0 ? maxProducts : undefined,
          },
          logs: { analyzeLogs },
        },
      });
      return;
    }

    // ── 3. Phase 2 — checkReference for compositions/countries/seasons ──
    addLog(
      `Vérification compositions/pays/saisons pour ${scannedRefs.length} produit(s) unique(s)...`,
    );

    const missingCompositions = new Map<string, MissingComposition>();
    const missingCountries = new Map<string, MissingCountry>();
    const missingSeasons = new Map<string, MissingSeason>();
    let refCheckOk = 0;
    let refCheckFail = 0;

    for (let i = 0; i < scannedRefs.length; i += REFCHECK_CONCURRENCY) {
      if (await checkStopped()) {
        addLog("⏹ Arrêt demandé pendant la vérification des références");
        await updateJob({});
        return;
      }

      const batch = scannedRefs.slice(i, i + REFCHECK_CONCURRENCY);
      const refResults = await Promise.allSettled(batch.map((ref) => pfsCheckReference(ref)));

      for (const res of refResults) {
        if (res.status !== "fulfilled" || !res.value?.product) {
          refCheckFail++;
          continue;
        }
        refCheckOk++;
        const p = res.value.product;

        // Compositions
        for (const mat of p.material_composition ?? []) {
          const ref = mat.reference;
          if (missingCompositions.has(ref)) {
            missingCompositions.get(ref)!.usedBy++;
            continue;
          }
          if (compByRef.has(ref.toUpperCase())) continue;
          const frLabel = mat.labels?.fr || ref;
          if (compByName.has(normalizeColorName(frLabel))) continue;
          if (mappingSet.has(`composition::${frLabel.toLowerCase()}`)) continue;
          if (mappingSet.has(`composition::${ref.toLowerCase()}`)) continue;
          missingCompositions.set(ref, {
            pfsName: frLabel,
            pfsReference: ref,
            suggestedName: frLabel,
            usedBy: 1,
            pfsLabels: mat.labels || {},
          });
        }

        // Country
        if (p.country_of_manufacture) {
          const iso = p.country_of_manufacture.trim().toUpperCase();
          if (!missingCountries.has(iso)) {
            const isMapped =
              countryByRef.has(iso) ||
              countryByIso.has(iso) ||
              countryByName.has(iso) ||
              mappingSet.has(`country::${iso.toLowerCase()}`);
            if (!isMapped) {
              missingCountries.set(iso, {
                pfsReference: iso,
                suggestedName: ISO_COUNTRY_FR[iso] ?? iso,
                pfsLabels: {},
              });
            }
          }
        }

        // Season / Collection
        if (p.collection?.reference) {
          const ref = p.collection.reference;
          const refUp = ref.toUpperCase();
          if (!missingSeasons.has(refUp)) {
            const frLabel = p.collection.labels?.fr || ref;
            const isMapped =
              seasonByRef.has(refUp) ||
              seasonByName.has(frLabel.toLowerCase()) ||
              mappingSet.has(`season::${ref.toLowerCase()}`);
            if (!isMapped) {
              missingSeasons.set(refUp, {
                pfsReference: ref,
                suggestedName: frLabel,
                pfsLabels: p.collection.labels || {},
              });
            }
          }
        }
      }

      const done = Math.min(i + REFCHECK_CONCURRENCY, scannedRefs.length);
      addLog(
        `checkReference ${done}/${scannedRefs.length} (${refCheckOk} OK, ${refCheckFail} échec) — ${missingCompositions.size} compos, ${missingCountries.size} pays, ${missingSeasons.size} saisons manquants`,
      );
      await updateJob({});

      if (i + REFCHECK_CONCURRENCY < scannedRefs.length) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    // ── 4. Build final result ──
    const missingEntities = {
      categories: Array.from(missingCategories.values()).sort((a, b) => b.usedBy - a.usedBy),
      colors: Array.from(missingColors.values()).sort((a, b) => b.usedBy - a.usedBy),
      compositions: Array.from(missingCompositions.values()),
      countries: Array.from(missingCountries.values()),
      seasons: Array.from(missingSeasons.values()),
      sizes: Array.from(missingSizesInternal.values())
        .map((s) => ({ name: s.name, usedBy: s.usedBy, pfsCategoryIds: Array.from(s.catIds) }))
        .sort((a, b) => b.usedBy - a.usedBy),
    };

    const existingEntities = {
      categories: dbCategories.map((c) => ({ id: c.id, name: c.name, pfsCategoryId: c.pfsCategoryId })),
      colors: dbColors.map((c) => ({ id: c.id, name: c.name, hex: c.hex, patternImage: c.patternImage })),
      compositions: dbCompositions.map((c) => ({ id: c.id, name: c.name })),
      countries: dbCountries.map((c) => ({ id: c.id, name: c.name, isoCode: c.isoCode })),
      seasons: dbSeasons.map((c) => ({ id: c.id, name: c.name })),
    };

    const totalMissing =
      missingEntities.categories.length +
      missingEntities.colors.length +
      missingEntities.compositions.length +
      missingEntities.countries.length +
      missingEntities.seasons.length +
      missingEntities.sizes.length;

    addLog(
      `Analyse terminée — ${totalScanned} scannés, ${totalNewProducts} nouveaux, ${totalMissing} entité(s) manquante(s)`,
    );

    const analyzeResult = {
      totalScanned,
      totalNewProducts,
      totalExistingSkipped,
      missingEntities,
      existingMappings: pfsMappings.length,
      existingEntities,
      limit: maxProducts > 0 ? maxProducts : undefined,
    };

    // Always go to NEEDS_VALIDATION so the user can review before prepare starts
    if (totalMissing === 0) {
      addLog("Aucune entité manquante — prêt à lancer la préparation.");
    }

    await prisma.pfsPrepareJob.update({
      where: { id: jobId },
      data: {
        status: "NEEDS_VALIDATION",
        totalProducts: totalNewProducts,
        analyzeResult,
        logs: { analyzeLogs },
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur interne lors de l'analyse";
    logger.error("[PFS Analyze] Fatal error", { error: err instanceof Error ? err.message : String(err) });
    try {
      await prisma.pfsPrepareJob.update({
        where: { id: jobId },
        data: {
          status: "FAILED",
          errorMessage: message,
          logs: { analyzeLogs },
        },
      });
    } catch {
      // DB write failed — nothing more to do
    }
  }
}

// ─────────────────────────────────────────────
// Filter: keep only products not in DB
// ─────────────────────────────────────────────

async function filterNewProducts(products: PfsProduct[]): Promise<PfsProduct[]> {
  if (products.length === 0) return [];

  // Deduplicate and normalize refs
  const refMap = new Map<string, PfsProduct[]>();
  for (const p of products) {
    const bjRef = stripVersionSuffix(p.reference.trim().toUpperCase());
    if (!refMap.has(bjRef)) refMap.set(bjRef, []);
    refMap.get(bjRef)!.push(p);
  }

  // Batch query existing refs
  const refs = Array.from(refMap.keys());
  const existingProducts = await prisma.product.findMany({
    where: { reference: { in: refs } },
    select: { reference: true },
  });
  const existingRefSet = new Set(existingProducts.map((p) => p.reference));

  // Return only products whose ref doesn't exist, keeping first per ref (dedup VS1/VS2)
  const result: PfsProduct[] = [];
  const seen = new Set<string>();
  for (const p of products) {
    const bjRef = stripVersionSuffix(p.reference.trim().toUpperCase());
    if (existingRefSet.has(bjRef)) continue;
    if (seen.has(bjRef)) continue;
    seen.add(bjRef);
    result.push(p);
  }

  return result;
}

// ─────────────────────────────────────────────
// Analysis helpers (same logic as old analyze/route.ts)
// ─────────────────────────────────────────────

function analyzeCategory(
  product: PfsProduct,
  missing: Map<string, MissingCategory>,
  categorySlugs: Set<string>,
  categoryNames: Set<string>,
  mappingSet: Set<string>,
  categoryPfsIds: Set<string>,
) {
  const categoryFr = product.category?.labels?.fr;
  if (!categoryFr) return;

  const slug = slugify(categoryFr);
  const nameLower = categoryFr.toLowerCase();
  if (categorySlugs.has(slug) || categoryNames.has(nameLower)) return;
  if (mappingSet.has(`category::${nameLower}`)) return;
  if (product.category?.id && categoryPfsIds.has(product.category.id)) return;

  const key = nameLower;
  const existing = missing.get(key);
  if (existing) {
    existing.usedBy++;
  } else {
    missing.set(key, {
      pfsName: categoryFr,
      pfsCategoryId: product.category.id,
      pfsGender: product.gender || "WOMAN",
      pfsFamilyId: product.family || "",
      suggestedName: categoryFr,
      usedBy: 1,
      pfsLabels: product.category.labels || {},
    });
  }
}

function analyzeColors(
  product: PfsProduct,
  missing: Map<string, MissingColor>,
  colorNormalized: Set<string>,
  mappingSet: Set<string>,
  colorPfsRefs: Set<string>,
) {
  if (!product.variants) return;

  const seenColors = new Set<string>();

  for (const v of product.variants) {
    let colorInfo: { reference: string; value: string; labels: Record<string, string> } | null = null;

    if (v.type === "ITEM" && v.item?.color) {
      colorInfo = v.item.color;
    } else if (v.type === "PACK" && v.packs && v.packs.length > 0) {
      colorInfo = v.packs[0].color;
    }

    if (!colorInfo) continue;

    const frLabel = colorInfo.labels?.fr || colorInfo.reference;
    const normalized = normalizeColorName(frLabel);

    if (seenColors.has(normalized)) continue;
    seenColors.add(normalized);

    if (colorNormalized.has(normalized)) continue;
    if (mappingSet.has(`color::${frLabel.toLowerCase()}`)) continue;
    if (mappingSet.has(`color::${normalized}`)) continue;
    if (colorInfo.reference && colorPfsRefs.has(colorInfo.reference.toUpperCase())) continue;

    const existingEntry = missing.get(normalized);
    if (existingEntry) {
      existingEntry.usedBy++;
    } else {
      missing.set(normalized, {
        pfsName: frLabel,
        pfsReference: colorInfo.reference,
        suggestedName: frLabel,
        hex: colorInfo.value || null,
        usedBy: 1,
        pfsLabels: colorInfo.labels || {},
      });
    }
  }
}

function analyzeSizes(
  product: PfsProduct,
  missing: Map<string, { name: string; usedBy: number; catIds: Set<string> }>,
  bjSizeNames: Set<string>,
) {
  if (!product.sizes) return;
  const pfsCatId = product.category?.id ?? "";
  for (const sz of product.sizes.split(";")) {
    const s = sz.trim();
    if (!s) continue;
    const sLow = s.toLowerCase();
    if (!bjSizeNames.has(sLow)) {
      const existing = missing.get(sLow);
      if (existing) {
        existing.usedBy++;
        if (pfsCatId) existing.catIds.add(pfsCatId);
      } else {
        missing.set(sLow, { name: s, usedBy: 1, catIds: new Set(pfsCatId ? [pfsCatId] : []) });
      }
    }
  }
}
