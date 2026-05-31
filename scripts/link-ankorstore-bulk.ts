/**
 * Liaison en masse des produits locaux aux produits Ankorstore correspondants.
 *
 * **Mode strict 100 % ou rien** : on ne pose un lien que si la fiche
 * Ankorstore et la fiche BJ ont exactement le meme nombre de variantes ET
 * que chaque variante trouve son equivalent exact (pas de fuzzy, pas de
 * doublon, pas de variante orpheline d'un cote ou de l'autre).
 *
 * Comportement par mode :
 *   - simulation       Aucune écriture. Affiche le compte-rendu du matching
 *                      + le détail des produits refusés par le filtre strict.
 *   - un-seul [<ref>]  Pose le lien pour UN seul produit (par défaut le premier
 *                      match trouvé). Si <ref> est fournie, cible cette référence.
 *   - tout             Pose le lien pour TOUS les matchs strictement surs.
 *
 * Le matching se fait via runAutoMatch (lib/ankorstore-match.ts) sur la
 * référence produit. Pour chaque match unique :
 *   1. Pose `ankorsProductId` sur le Product
 *   2. Pose `ankorsVariantId` sur les ProductColor selon les variantes matchées
 *      par couleur
 *   3. Filet de sécurité via autoLinkAnkorstoreVariants pour les variantes non
 *      mappées (match SKU/couleur)
 *   4. Lance le kickoff `ankorstoreKickoffUpdate(forceFullSync)` qui écrasera
 *      les données AS avec nos SKU/taille/stock/prix (résultat reçu plus tard
 *      par webhook)
 *
 * Usage :
 *   npx tsx scripts/link-ankorstore-bulk.ts simulation
 *   npx tsx scripts/link-ankorstore-bulk.ts un-seul [REFERENCE]
 *   npx tsx scripts/link-ankorstore-bulk.ts tout
 *
 * Les produits ARCHIVED et ceux déjà liés sont ignorés.
 */

import "dotenv/config";
import fs from "fs";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  ankorstoreListAllProducts,
  type AnkorstoreProduct,
} from "@/lib/ankorstore-api";
import { primeAnkorstoreToken, primeAnkorstoreCredentials } from "@/lib/ankorstore-auth";
import { decryptIfSensitive } from "@/lib/encryption";
import {
  runAutoMatch,
  type BjProductForMatch,
  type MatchResult,
} from "@/lib/ankorstore-match";
import { autoLinkAnkorstoreVariants } from "@/lib/ankorstore-variant-link";
import { ankorstoreKickoffUpdate } from "@/lib/ankorstore-update";

const ANKORSTORE_TOKEN_URL = "https://www.ankorstore.com/oauth/token";

/**
 * Amorce le token Ankorstore depuis un script CLI (hors contexte Next.js).
 * Lit les credentials chiffres dans SiteConfig, fait l'OAuth, puis appelle
 * primeAnkorstoreToken pour que les libs aval (getAnkorstoreToken) court-
 * circuitent le helper cache qui depend de unstable_cache.
 */
async function bootstrapAnkorstoreAuth(): Promise<void> {
  const rows = await prisma.siteConfig.findMany({
    where: { key: { in: ["ankors_client_id", "ankors_client_secret"] } },
  });
  const map = new Map(
    rows.map((r) => [
      r.key,
      decryptIfSensitive(r.key, r.value)?.trim() ?? null,
    ]),
  );
  const clientId = map.get("ankors_client_id");
  const clientSecret = map.get("ankors_client_secret");
  if (!clientId || !clientSecret) {
    throw new Error(
      "Identifiants Ankorstore manquants — configurez-les dans Admin > Parametres > Marketplaces.",
    );
  }

  // Amorce aussi les credentials en mémoire : si le token expire en cours
  // de script, `getAnkorstoreToken` peut se ré-authentifier seul sans
  // dépendre de `unstable_cache` (qui plante en CLI).
  primeAnkorstoreCredentials(clientId, clientSecret);

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "*",
  });
  const res = await fetch(ANKORSTORE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Ankorstore auth a echoue (${res.status}) : ${txt.slice(0, 200)}`);
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new Error("Reponse OAuth Ankorstore sans access_token.");
  }
  primeAnkorstoreToken(data.access_token, data.expires_in ?? 3600);
  console.log("Token Ankorstore amorce avec succes.");
}

export type Mode = "simulation" | "un-seul" | "tout" | "limite";

export function parseMode(raw: string | undefined): Mode | null {
  if (raw === "simulation" || raw === "un-seul" || raw === "tout" || raw === "limite") return raw;
  return null;
}

async function loadLocalProducts(): Promise<BjProductForMatch[]> {
  const rows = await prisma.product.findMany({
    where: {
      ankorsProductId: null,
      status: { not: "ARCHIVED" },
    },
    select: {
      id: true,
      name: true,
      reference: true,
      colors: {
        where: { saleType: "UNIT" },
        select: {
          colorId: true,
          color: { select: { name: true } },
        },
      },
    },
  });

  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    reference: p.reference,
    colors: p.colors
      .filter((c) => c.colorId && c.color)
      .map((c) => ({ id: c.colorId as string, name: c.color!.name })),
  }));
}

async function loadAnkorstoreProducts(): Promise<AnkorstoreProduct[]> {
  console.log("Telechargement des produits Ankorstore (page par page, max 50/page)...");
  const all = await ankorstoreListAllProducts({
    onPage: (_, idx, total) => {
      console.log(`  page ${idx + 1} → ${total} produits cumules`);
    },
  });
  // Garde-fou : exclut les produits archives (= supprimes pour nous).
  // L'API filtre deja via filter[archived]=false, mais on re-applique cote
  // client pour etre certain.
  const active = all.filter((p) => !p.archived);
  const skipped = all.length - active.length;
  console.log(`OK : ${all.length} produits recus, ${active.length} actifs${skipped > 0 ? ` (${skipped} archives ignores)` : ""}.`);
  return active;
}

export interface MatchedRow {
  bjId: string;
  bjName: string;
  bjReference: string;
  akId: string;
  akName: string;
  extractedRef: string;
  variantPairs: { localColorId: string; ankorstoreVariantId: string }[];
  totalAkVariants: number;
  bjUnitColorCount: number;
  hasFuzzyMatch: boolean;
}

export function buildMatchedRows(
  results: MatchResult[],
  bjProducts: BjProductForMatch[] = [],
): MatchedRow[] {
  const bjById = new Map(bjProducts.map((p) => [p.id, p]));
  return results
    .filter((r) => r.status === "matched")
    .map((r) => {
      const bjId = r.bjProductIds[0];
      const bjUnitColorCount = bjById.get(bjId)?.colors.length ?? 0;
      return {
        bjId,
        bjName: r.bjProductNames[0],
        bjReference: r.extractedRef ?? "?",
        akId: r.ankorstoreProduct.id,
        akName: r.ankorstoreProduct.name,
        extractedRef: r.extractedRef ?? "?",
        variantPairs: (r.variantMatches ?? [])
          .filter((vm) => vm.bjColorId !== null)
          .map((vm) => ({
            localColorId: vm.bjColorId as string,
            ankorstoreVariantId: vm.ankorstoreVariant.id,
          })),
        totalAkVariants: r.ankorstoreProduct.variants.length,
        bjUnitColorCount,
        hasFuzzyMatch: (r.variantMatches ?? []).some(
          (vm) => vm.confidence === "fuzzy",
        ),
      };
    });
}

/**
 * Filtre strict « 100 % ou rien ». Refuse de lier des que :
 *   - le nombre de variantes Ankorstore != nombre de variantes BJ UNIT
 *     (variante en plus ou en moins)
 *   - une variante Ankorstore n'a pas trouve son equivalent BJ exact
 *   - 2 variantes Ankorstore pointent sur la meme couleur BJ
 *   - un matching couleur est approximatif (fuzzy "contient")
 */
export interface StrictRejection {
  row: MatchedRow;
  reasons: string[];
}

export function splitStrictRows(rows: MatchedRow[]): {
  safe: MatchedRow[];
  rejected: StrictRejection[];
} {
  const safe: MatchedRow[] = [];
  const rejected: StrictRejection[] = [];
  for (const r of rows) {
    const reasons: string[] = [];
    const akOrphans = r.totalAkVariants - r.variantPairs.length;
    if (akOrphans > 0) {
      reasons.push(
        `${akOrphans} variante(s) Ankorstore sans equivalent couleur chez vous`,
      );
    }
    const bjOrphans = r.bjUnitColorCount - r.variantPairs.length;
    if (bjOrphans > 0) {
      reasons.push(
        `${bjOrphans} couleur(s) chez vous sans equivalent Ankorstore`,
      );
    }
    const uniqueTargets = new Set(r.variantPairs.map((p) => p.localColorId));
    if (uniqueTargets.size !== r.variantPairs.length) {
      reasons.push(
        "Plusieurs variantes Ankorstore pointent sur la meme couleur chez vous",
      );
    }
    if (r.hasFuzzyMatch) {
      reasons.push(
        "Matching couleur approximatif (nom similaire mais pas identique)",
      );
    }
    if (r.bjUnitColorCount === 0) {
      reasons.push("Produit BJ sans variante UNIT");
    }
    if (reasons.length === 0) {
      safe.push(r);
    } else {
      rejected.push({ row: r, reasons });
    }
  }
  return { safe, rejected };
}

export function pickRowsForUnSeul(
  rows: MatchedRow[],
  refArg: string | undefined,
  rng: () => number = Math.random,
): { rows: MatchedRow[]; refNotFound: boolean } {
  if (!refArg) {
    if (rows.length === 0) return { rows: [], refNotFound: false };
    const idx = Math.floor(rng() * rows.length);
    return { rows: [rows[idx]], refNotFound: false };
  }
  const normalized = refArg.toLowerCase().trim();
  const filtered = rows.filter(
    (r) => r.bjReference.toLowerCase().trim() === normalized,
  );
  return { rows: filtered.slice(0, 1), refNotFound: filtered.length === 0 };
}

/**
 * Detecte les cas ou un meme produit local est match par plusieurs produits
 * Ankorstore (doublons cote AS). Retourne 2 listes :
 *   - safe : les bjId qui ont exactement 1 produit AS candidat → on peut lier
 *   - ambiguousAk : les bjId avec 2+ candidats AS → on saute, l'utilisatrice
 *     choisira a la main quel produit AS lier.
 */
export function splitAmbiguousAkSide(rows: MatchedRow[]): {
  safe: MatchedRow[];
  ambiguousAk: { bjId: string; bjName: string; bjReference: string; akCandidates: { id: string; name: string }[] }[];
} {
  const byBjId = new Map<string, MatchedRow[]>();
  for (const r of rows) {
    const list = byBjId.get(r.bjId) ?? [];
    list.push(r);
    byBjId.set(r.bjId, list);
  }
  const safe: MatchedRow[] = [];
  const ambiguousAk: {
    bjId: string;
    bjName: string;
    bjReference: string;
    akCandidates: { id: string; name: string }[];
  }[] = [];
  for (const [bjId, list] of byBjId) {
    if (list.length === 1) {
      safe.push(list[0]);
    } else {
      ambiguousAk.push({
        bjId,
        bjName: list[0].bjName,
        bjReference: list[0].bjReference,
        akCandidates: list.map((r) => ({ id: r.akId, name: r.akName })),
      });
    }
  }
  return { safe, ambiguousAk };
}

async function poseLink(row: MatchedRow): Promise<{ ok: boolean; error?: string }> {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: row.bjId },
        data: {
          ankorsProductId: row.akId,
          ankorsLastSyncSnapshot: Prisma.DbNull,
        },
      });

      await tx.productColor.updateMany({
        where: { productId: row.bjId },
        data: { ankorsVariantId: null },
      });

      for (const m of row.variantPairs) {
        await tx.productColor.updateMany({
          where: {
            productId: row.bjId,
            colorId: m.localColorId,
            saleType: "UNIT",
          },
          data: { ankorsVariantId: m.ankorstoreVariantId },
        });
      }
    });

    try {
      await autoLinkAnkorstoreVariants(row.bjId);
    } catch (err) {
      console.warn(
        `   note : autoLink variantes a echoue (lien pose quand meme) : ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const kickoff = await ankorstoreKickoffUpdate(row.bjId, {
      forceFullSync: true,
      skipRevalidation: true,
    });
    if (!kickoff.success) {
      console.warn(`   note : kickoff overwrite Ankorstore a echoue : ${kickoff.error}`);
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const mode = parseMode(argv[0]);
  if (!mode) {
    console.error("Usage : npx tsx scripts/link-ankorstore-bulk.ts <simulation|un-seul [REF]|limite N|tout>");
    process.exit(1);
  }
  const refArg = argv[1];
  const limitArg = mode === "limite" ? Number(argv[1]) : null;
  if (mode === "limite" && (!limitArg || Number.isNaN(limitArg) || limitArg <= 0)) {
    console.error("En mode `limite`, indiquez un nombre positif. Ex : npx tsx scripts/link-ankorstore-bulk.ts limite 10");
    process.exit(1);
  }

  // 1. Charger les produits locaux non lies
  const bjProducts = await loadLocalProducts();
  console.log(`Produits locaux non lies trouves : ${bjProducts.length}`);

  if (bjProducts.length === 0) {
    console.log("Rien a faire — tous vos produits sont deja lies.");
    process.exit(0);
  }

  // 2. Amorcer le token Ankorstore (hors contexte Next.js)
  await bootstrapAnkorstoreAuth();

  // 3. Charger les produits Ankorstore
  const akProducts = await loadAnkorstoreProducts();

  // 3. Matching
  const report = runAutoMatch(akProducts, bjProducts);
  const matchedResults = report.results.filter((r) => r.status === "matched");
  const ambiguousResults = report.results.filter((r) => r.status === "ambiguous");

  // BJ products qui n'ont matche aucun produit Ankorstore
  const matchedBjIds = new Set(matchedResults.flatMap((r) => r.bjProductIds));
  const orphanBj = bjProducts.filter((p) => !matchedBjIds.has(p.id));

  const allMatchedRows = buildMatchedRows(report.results, bjProducts);
  const split = splitAmbiguousAkSide(allMatchedRows);
  const strict = splitStrictRows(split.safe);
  const matchedRows = strict.safe;

  console.log("");
  console.log("=== Recapitulatif du matching ===");
  console.log(`Matchs surs a 100% (a lier)          : ${matchedRows.length}`);
  console.log(`Refuses (variantes != ou ambigu)     : ${strict.rejected.length}`);
  console.log(`Ambigus cote local (mm ref BJ x N)   : ${ambiguousResults.length}`);
  console.log(`Ambigus cote AS (mm ref AS x N)      : ${split.ambiguousAk.length}`);
  console.log(`Vos produits sans equivalent AS      : ${orphanBj.length}`);
  console.log("");

  // Dump du rapport detaille (toujours, meme en simulation et un-seul)
  const unmatchedAk = report.results.filter((r) => r.status === "unmatched");
  const safeStats = matchedRows.map((r) => ({
    reference: r.bjReference, name: r.bjName, akName: r.akName,
    variantsAppariees: r.variantPairs.length, variantsTotalAk: r.totalAkVariants,
  }));
  const partialMatches = safeStats.filter((r) => r.variantsAppariees < r.variantsTotalAk);
  const reportJson = {
    generatedAt: new Date().toISOString(),
    mode,
    counts: {
      bjProductsToLink: bjProducts.length,
      akProductsActive: akProducts.length,
      safeMatches: matchedRows.length,
      strictRejected: strict.rejected.length,
      partialVariantMatches: partialMatches.length,
      ambiguousLocal: ambiguousResults.length,
      ambiguousAk: split.ambiguousAk.length,
      orphanBj: orphanBj.length,
      unmatchedAk: unmatchedAk.length,
    },
    safe: safeStats,
    strictRejected: strict.rejected.map((rj) => ({
      reference: rj.row.bjReference,
      bjName: rj.row.bjName,
      akName: rj.row.akName,
      variantsBj: rj.row.bjUnitColorCount,
      variantsAk: rj.row.totalAkVariants,
      variantsAppariees: rj.row.variantPairs.length,
      reasons: rj.reasons,
    })),
    ambiguousLocalDetails: ambiguousResults.map((r) => ({
      akName: r.ankorstoreProduct.name, extractedRef: r.extractedRef,
      candidates: r.bjProductIds.map((id, i) => ({ id, name: r.bjProductNames[i] })),
    })),
    ambiguousAkDetails: split.ambiguousAk,
    orphanBjDetails: orphanBj.map((p) => ({ reference: p.reference, name: p.name })),
    partialMatches,
  };
  try {
    fs.writeFileSync("/var/log/ankorstore-link-report.json", JSON.stringify(reportJson, null, 2));
    console.log("Rapport detaille ecrit : /var/log/ankorstore-link-report.json");
  } catch (e) {
    console.warn(`Impossible decrire le rapport : ${e instanceof Error ? e.message : String(e)}`);
  }
  console.log("");

  if (mode === "simulation") {
    console.log("MODE SIMULATION — aucune ecriture.");
    console.log("");
    console.log("--- Liaisons qui seraient posees ---");
    for (const r of matchedRows) {
      console.log(
        `  ${r.bjReference}  |  ${r.bjName}  →  "${r.akName}"  (${r.variantPairs.length}/${r.totalAkVariants} variantes, ok)`,
      );
    }

    if (strict.rejected.length > 0) {
      console.log("");
      console.log("--- Refuses par le mode strict (variantes != ou ambigu) ---");
      const shownRejected = strict.rejected.slice(0, 60);
      for (const rj of shownRejected) {
        const r = rj.row;
        console.log(
          `  ${r.bjReference}  |  ${r.bjName} (BJ ${r.bjUnitColorCount} vs AS ${r.totalAkVariants}) : ${rj.reasons.join(" ; ")}`,
        );
      }
      if (strict.rejected.length > shownRejected.length) {
        console.log(`  ... et ${strict.rejected.length - shownRejected.length} autres`);
      }
    }

    if (ambiguousResults.length > 0) {
      console.log("");
      console.log("--- Ambigus cote local (plusieurs produits BJ pour la mm ref AS) ---");
      for (const r of ambiguousResults) {
        console.log(`  ref "${r.extractedRef}" matche ${r.bjProductIds.length} produits locaux : ${r.bjProductNames.join(" / ")}`);
      }
    }

    if (split.ambiguousAk.length > 0) {
      console.log("");
      console.log("--- Ambigus cote Ankorstore (doublons AS pour la mm ref BJ) ---");
      for (const r of split.ambiguousAk.slice(0, 100)) {
        const names = r.akCandidates.map((c) => `"${c.name}"`).join(" / ");
        console.log(`  ${r.bjReference}  |  ${r.bjName}  →  ${r.akCandidates.length} candidats AS : ${names}`);
      }
      if (split.ambiguousAk.length > 100) {
        console.log(`  ... et ${split.ambiguousAk.length - 100} autres`);
      }
    }

    if (orphanBj.length > 0) {
      console.log("");
      console.log(`--- Vos produits sans equivalent Ankorstore (${orphanBj.length}) ---`);
      const shown = orphanBj.slice(0, 60);
      for (const p of shown) {
        console.log(`  ${p.reference}  |  ${p.name}`);
      }
      if (orphanBj.length > shown.length) {
        console.log(`  ... et ${orphanBj.length - shown.length} autres`);
      }
    }

    console.log("");
    console.log("Simulation terminee — rien n'a ete modifie.");
    process.exit(0);
  }

  // Mode ecriture : filtrer si "un-seul" ou "limite"
  let toProcess = matchedRows;
  if (mode === "un-seul") {
    const picked = pickRowsForUnSeul(matchedRows, refArg);
    if (picked.refNotFound) {
      console.error(`Aucun match trouve pour la reference "${refArg}".`);
      console.log("References disponibles parmi les matchs (premieres 30) :");
      for (const r of matchedRows.slice(0, 30)) {
        console.log(`  ${r.bjReference}`);
      }
      process.exit(1);
    }
    toProcess = picked.rows;
  } else if (mode === "limite" && limitArg) {
    toProcess = matchedRows.slice(0, limitArg);
  }

  console.log(
    mode === "un-seul"
      ? `MODE UN-SEUL — pose d'1 liaison de test...`
      : mode === "limite"
        ? `MODE LIMITE — pose de ${toProcess.length} liaisons (sur ${matchedRows.length} matchs)...`
        : `MODE TOUT — pose de ${toProcess.length} liaisons...`,
  );
  console.log("");

  let okCount = 0;
  let errCount = 0;
  const okList: { reference: string; name: string; akName: string }[] = [];
  const errList: { reference: string; name: string; error: string }[] = [];
  for (const row of toProcess) {
    const result = await poseLink(row);
    if (result.ok) {
      console.log(`  OK   ${row.bjReference}  |  ${row.bjName}  →  "${row.akName}"`);
      okCount++;
      okList.push({ reference: row.bjReference, name: row.bjName, akName: row.akName });
    } else {
      console.error(`  ECHEC ${row.bjReference}  |  ${row.bjName} : ${result.error}`);
      errCount++;
      errList.push({ reference: row.bjReference, name: row.bjName, error: result.error ?? "?" });
    }
  }

  console.log("");
  console.log(`Termine : ${okCount} liaison(s) posee(s), ${errCount} echec(s).`);
  console.log("");
  console.log("Les mises a jour Ankorstore arriveront par webhook dans les minutes qui viennent.");
  console.log("Vous pouvez verifier dans Admin > Produits que les produits affichent maintenant le badge Ankorstore.");

  try {
    const summary = {
      finishedAt: new Date().toISOString(),
      mode, totalAttempted: toProcess.length,
      okCount, errCount,
      ok: okList, errors: errList,
    };
    fs.writeFileSync("/var/log/ankorstore-bulk-link-summary.json", JSON.stringify(summary, null, 2));
    console.log("Resume final ecrit : /var/log/ankorstore-bulk-link-summary.json");
  } catch (e) {
    console.warn(`Impossible decrire le resume : ${e instanceof Error ? e.message : String(e)}`);
  }
}

// Ne lance main() que lorsque le script est execute directement (pas a l'import en test).
if (!process.env.VITEST) {
  main()
    .catch((err) => {
      console.error("Erreur fatale :", err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
