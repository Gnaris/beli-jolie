/**
 * PFS Sync Analyze Endpoint (SSE streaming)
 *
 * Dry-run analysis of PFS products to detect missing categories, colors,
 * compositions, countries (pays de fabrication), seasons (collections),
 * and sizes ONLY for the products being scanned.
 *
 * - Colors / Categories / Sizes: from listProducts (fast, no extra calls)
 * - Compositions / Countries / Seasons: from checkReference per product
 *   (batched, deduped by reference)
 *
 * POST /api/admin/pfs-sync/analyze
 * Body: { limit?: number }  (10 for test, 0 or omitted for full scan)
 */

import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  pfsListProducts,
  pfsCheckReference,
  type PfsProduct,
} from "@/lib/pfs-api";
import { normalizeColorName } from "@/lib/import-processor";

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
  pfsReference: string; // ISO code (CN, TR, FR…)
  suggestedName: string;
  pfsLabels: Record<string, string>;
}

interface MissingSeason {
  pfsReference: string; // PE2026, AH2025…
  suggestedName: string;
  pfsLabels: Record<string, string>;
}

interface MissingSize {
  name: string;
  usedBy: number;
  pfsCategoryIds: string[]; // PFS category IDs that use this size (for SizeCategoryLink)
}

// ─────────────────────────────────────────────
// POST handler — SSE streaming
// ─────────────────────────────────────────────

const REFCHECK_CONCURRENCY = 15;

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return new Response(JSON.stringify({ error: "Non autorise" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let limit = 0;
  try {
    const body = await req.json();
    limit = typeof body.limit === "number" ? body.limit : 0;
  } catch {
    // No body or invalid JSON — unlimited
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        send({ type: "progress", message: "Chargement des données existantes..." });

        // ── 1. Load existing DB entities ──
        const [dbCategories, dbColors, dbCompositions, dbCountries, dbSeasons, dbSizes, pfsMappings] = await Promise.all([
          prisma.category.findMany({ select: { id: true, name: true, slug: true, pfsCategoryId: true } }),
          prisma.color.findMany({ select: { id: true, name: true, hex: true, patternImage: true, pfsColorRef: true } }),
          prisma.composition.findMany({ select: { id: true, name: true, pfsCompositionRef: true } }),
          prisma.manufacturingCountry.findMany({ select: { id: true, name: true, isoCode: true, pfsCountryRef: true } }),
          prisma.season.findMany({ select: { id: true, name: true, pfsRefs: { select: { pfsRef: true } } } }),
          prisma.size.findMany({ select: { id: true, name: true } }),
          prisma.pfsMapping.findMany({ select: { type: true, pfsName: true, bjName: true } }),
        ]);

        // Sets for fast lookup
        const categorySlugs = new Set<string>(dbCategories.map((c) => slugify(c.name)));
        const categoryNames = new Set<string>(dbCategories.map((c) => c.name.toLowerCase()));
        const categoryPfsIds = new Set<string>(dbCategories.filter((c) => c.pfsCategoryId).map((c) => c.pfsCategoryId!));
        const colorNormalized = new Set<string>(dbColors.map((c) => normalizeColorName(c.name)));
        const colorPfsRefs = new Set<string>(dbColors.filter((c) => c.pfsColorRef).map((c) => c.pfsColorRef!.toUpperCase()));
        const bjSizeNames = new Set<string>(dbSizes.map((s) => s.name.toLowerCase()));

        // Composition sets
        const compByRef = new Set<string>(
          dbCompositions.filter((c) => c.pfsCompositionRef).map((c) => c.pfsCompositionRef!.toUpperCase()),
        );
        const compByName = new Set<string>(dbCompositions.map((c) => normalizeColorName(c.name)));

        // Country sets
        const countryByRef = new Set<string>(
          dbCountries.filter((c) => c.pfsCountryRef).map((c) => c.pfsCountryRef!.toUpperCase()),
        );
        const countryByIso = new Set<string>(
          dbCountries.filter((c) => c.isoCode).map((c) => c.isoCode!.toUpperCase()),
        );
        const countryByName = new Set<string>(dbCountries.map((c) => c.name.toUpperCase()));

        // Season sets
        const seasonByRef = new Set<string>(
          dbSeasons.flatMap((s) => s.pfsRefs.map((r) => r.pfsRef.toUpperCase())),
        );
        const seasonByName = new Set<string>(dbSeasons.map((s) => s.name.toLowerCase()));

        // Build PfsMapping set (orphan-safe: skip mappings pointing to deleted entities)
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
            // Only valid if the BJ composition still exists in DB
            if (compByName.has(normalizeColorName(m.bjName))) {
              mappingSet.add(key);
            }
          } else if (m.type === "country") {
            // Only valid if the BJ country still exists in DB
            if (countryByName.has(m.bjName.toUpperCase())) {
              mappingSet.add(key);
            }
          } else if (m.type === "season") {
            // Only valid if the BJ season still exists in DB
            if (seasonByName.has(m.bjName.toLowerCase())) {
              mappingSet.add(key);
            }
          } else {
            mappingSet.add(key); // size, etc. — no orphan check needed
          }
        }

        send({
          type: "progress",
          message: `${dbCategories.length} catégories, ${dbColors.length} couleurs, ${dbCompositions.length} compositions, ${dbCountries.length} pays, ${dbSeasons.length} saisons, ${dbSizes.length} tailles chargés`,
        });

        // ── 2. Phase 1 — Paginate PFS products ──
        const missingCategories = new Map<string, MissingCategory>();
        const missingColors = new Map<string, MissingColor>();
        // Internal: use Set<string> for pfsCategoryIds to deduplicate
        const missingSizesInternal = new Map<string, { name: string; usedBy: number; catIds: Set<string> }>();
        const scannedRefs: string[] = []; // product refs for checkReference phase
        const seenRefs = new Set<string>(); // dedup

        let totalScanned = 0;
        let page = 1;
        let lastPage = Infinity;
        const PAGE_CONCURRENCY = 10;
        let errorPages = 0;

        const processProduct = (product: PfsProduct) => {
          analyzeColors(product, missingColors, colorNormalized, mappingSet, colorPfsRefs);
          analyzeCategory(product, missingCategories, categorySlugs, categoryNames, mappingSet, categoryPfsIds);
          analyzeSizes(product, missingSizesInternal, bjSizeNames);

          // Collect unique refs for checkReference phase
          const ref = product.reference;
          if (ref && !seenRefs.has(ref)) {
            seenRefs.add(ref);
            scannedRefs.push(ref);
          }
          totalScanned++;
        };

        // First page
        try {
          const firstResponse = await pfsListProducts(1, 100);
          if (firstResponse.meta?.last_page) {
            lastPage = firstResponse.meta.last_page;
          }
          if (firstResponse.data?.length > 0) {
            let firstPageProducts = firstResponse.data;
            if (limit > 0) firstPageProducts = firstPageProducts.slice(0, limit);
            for (const product of firstPageProducts) processProduct(product);
          }
          send({
            type: "progress",
            page: 1,
            lastPage: lastPage < Infinity ? lastPage : null,
            totalScanned,
            missingColors: missingColors.size,
            missingCategories: missingCategories.size,
            message: `Page 1/${lastPage < Infinity ? lastPage : "?"} — ${totalScanned} produits analysés`,
          });
          page = 2;
        } catch (err) {
          send({ type: "error", message: err instanceof Error ? err.message : "Erreur page 1" });
          controller.close();
          return;
        }

        // Remaining pages
        while (page <= lastPage) {
          if (limit > 0 && totalScanned >= limit) break;

          const batchEnd = Math.min(page + PAGE_CONCURRENCY - 1, lastPage);
          const pageNumbers: number[] = [];
          for (let p = page; p <= batchEnd; p++) pageNumbers.push(p);

          send({
            type: "progress",
            page,
            lastPage,
            totalScanned,
            missingColors: missingColors.size,
            missingCategories: missingCategories.size,
            message: `Pages ${page}-${batchEnd}/${lastPage} en parallèle — ${totalScanned} produits analysés...`,
          });

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
            let pageProducts = response.data;
            if (limit > 0) {
              const remaining = limit - totalScanned;
              if (remaining <= 0) break;
              pageProducts = pageProducts.slice(0, remaining);
            }
            for (const product of pageProducts) processProduct(product);
          }

          if (batchEmpty && results.every((r) => r.status === "fulfilled")) break;
          page = batchEnd + 1;
          await new Promise((r) => setTimeout(r, 200));
        }

        if (errorPages > 0) {
          send({
            type: "progress",
            totalScanned,
            message: `⚠️ ${errorPages} page(s) en erreur — résultats partiels`,
          });
        }

        // ── 3. Phase 2 — checkReference for each unique scanned product ──
        send({
          type: "progress",
          message: `Vérification compositions/pays/saisons pour ${scannedRefs.length} produit(s) unique(s)...`,
        });

        const missingCompositions = new Map<string, MissingComposition>(); // PFS ref → entry
        const missingCountries = new Map<string, MissingCountry>();        // ISO code → entry
        const missingSeasons = new Map<string, MissingSeason>();           // PFS ref → entry
        let refCheckOk = 0;
        let refCheckFail = 0;

        for (let i = 0; i < scannedRefs.length; i += REFCHECK_CONCURRENCY) {
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
                continue; // already flagged — increment count and skip
              }
              if (compByRef.has(ref.toUpperCase())) continue; // mapped by ref
              const frLabel = mat.labels?.fr || ref;
              if (compByName.has(normalizeColorName(frLabel))) continue; // matched by name
              if (mappingSet.has(`composition::${frLabel.toLowerCase()}`)) continue;
              if (mappingSet.has(`composition::${ref.toLowerCase()}`)) continue;
              missingCompositions.set(ref, {
                pfsName: frLabel,
                pfsReference: ref,
                suggestedName: frLabel,
                usedBy: 0,
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

          // Progress update every batch
          const done = Math.min(i + REFCHECK_CONCURRENCY, scannedRefs.length);
          send({
            type: "progress",
            message: `checkReference ${done}/${scannedRefs.length} (${refCheckOk} OK, ${refCheckFail} échec) — ${missingCompositions.size} compos, ${missingCountries.size} pays, ${missingSeasons.size} saisons manquants`,
          });
          if (i + REFCHECK_CONCURRENCY < scannedRefs.length) {
            await new Promise((r) => setTimeout(r, 100));
          }
        }

        // ── 4. Send final result ──
        send({
          type: "done",
          totalScanned,
          pagesScanned: page - 1,
          missingEntities: {
            categories: Array.from(missingCategories.values()).sort((a, b) => b.usedBy - a.usedBy),
            colors: Array.from(missingColors.values()).sort((a, b) => b.usedBy - a.usedBy),
            compositions: Array.from(missingCompositions.values()),
            countries: Array.from(missingCountries.values()),
            seasons: Array.from(missingSeasons.values()),
            sizes: Array.from(missingSizesInternal.values())
              .map((s) => ({ name: s.name, usedBy: s.usedBy, pfsCategoryIds: Array.from(s.catIds) }))
              .sort((a, b) => b.usedBy - a.usedBy),
          },
          existingMappings: pfsMappings.length,
          existingEntities: {
            categories: dbCategories.map((c) => ({ id: c.id, name: c.name, pfsCategoryId: c.pfsCategoryId })),
            colors: dbColors.map((c) => ({ id: c.id, name: c.name, hex: c.hex, patternImage: c.patternImage })),
            compositions: dbCompositions.map((c) => ({ id: c.id, name: c.name })),
            countries: dbCountries.map((c) => ({ id: c.id, name: c.name, isoCode: c.isoCode })),
            seasons: dbSeasons.map((c) => ({ id: c.id, name: c.name })),
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Erreur interne";
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// ─────────────────────────────────────────────
// Analysis helpers
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
  // Also check by pfsCategoryId — the category may already exist with a different name
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
    // Also check by pfsColorRef — the color may already exist with a different name
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
