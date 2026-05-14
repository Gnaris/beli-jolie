/**
 * Liaison en masse des produits locaux aux produits Ankorstore correspondants.
 *
 * Comportement par mode :
 *   - simulation       Aucune écriture. Affiche le compte-rendu du matching.
 *   - un-seul [<ref>]  Pose le lien pour UN seul produit (par défaut le premier
 *                      match trouvé). Si <ref> est fournie, cible cette référence.
 *   - tout             Pose le lien pour TOUS les matchs non ambigus.
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
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  ankorstoreListAllProducts,
  type AnkorstoreProduct,
} from "@/lib/ankorstore-api";
import { primeAnkorstoreToken } from "@/lib/ankorstore-auth";
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

export type Mode = "simulation" | "un-seul" | "tout";

export function parseMode(raw: string | undefined): Mode | null {
  if (raw === "simulation" || raw === "un-seul" || raw === "tout") return raw;
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
  console.log(`OK : ${all.length} produits Ankorstore recuperes.`);
  return all;
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
}

export function buildMatchedRows(results: MatchResult[]): MatchedRow[] {
  return results
    .filter((r) => r.status === "matched")
    .map((r) => ({
      bjId: r.bjProductIds[0],
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
    }));
}

export function pickRowsForUnSeul(
  rows: MatchedRow[],
  refArg: string | undefined,
): { rows: MatchedRow[]; refNotFound: boolean } {
  if (!refArg) {
    return { rows: rows.slice(0, 1), refNotFound: false };
  }
  const normalized = refArg.toLowerCase().trim();
  const filtered = rows.filter(
    (r) => r.bjReference.toLowerCase().trim() === normalized,
  );
  return { rows: filtered.slice(0, 1), refNotFound: filtered.length === 0 };
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
    console.error("Usage : npx tsx scripts/link-ankorstore-bulk.ts <simulation|un-seul [REF]|tout>");
    process.exit(1);
  }
  const refArg = argv[1];

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

  const matchedRows = buildMatchedRows(report.results);

  console.log("");
  console.log("=== Recapitulatif du matching ===");
  console.log(`Matchs uniques (a lier)             : ${matchedRows.length}`);
  console.log(`Ambigus (plusieurs candidats locaux): ${ambiguousResults.length}`);
  console.log(`Vos produits sans equivalent AS     : ${orphanBj.length}`);
  console.log("");

  if (mode === "simulation") {
    console.log("MODE SIMULATION — aucune ecriture.");
    console.log("");
    console.log("--- Liaisons qui seraient posees ---");
    for (const r of matchedRows) {
      const partial = r.variantPairs.length < r.totalAkVariants
        ? ` (${r.variantPairs.length}/${r.totalAkVariants} variantes appariees auto)`
        : "";
      console.log(`  ${r.bjReference}  |  ${r.bjName}  →  "${r.akName}"${partial}`);
    }

    if (ambiguousResults.length > 0) {
      console.log("");
      console.log("--- Cas ambigus (ignores) ---");
      for (const r of ambiguousResults) {
        console.log(`  ref "${r.extractedRef}" matche ${r.bjProductIds.length} produits locaux : ${r.bjProductNames.join(" / ")}`);
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

  // Mode ecriture : filtrer si "un-seul"
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
  }

  console.log(
    mode === "un-seul"
      ? `MODE UN-SEUL — pose d'1 liaison de test...`
      : `MODE TOUT — pose de ${toProcess.length} liaisons...`,
  );
  console.log("");

  let okCount = 0;
  let errCount = 0;
  for (const row of toProcess) {
    const result = await poseLink(row);
    if (result.ok) {
      console.log(`  OK   ${row.bjReference}  |  ${row.bjName}  →  "${row.akName}"`);
      okCount++;
    } else {
      console.error(`  ECHEC ${row.bjReference}  |  ${row.bjName} : ${result.error}`);
      errCount++;
    }
  }

  console.log("");
  console.log(`Termine : ${okCount} liaison(s) posee(s), ${errCount} echec(s).`);
  console.log("");
  console.log("Les mises a jour Ankorstore arriveront par webhook dans les minutes qui viennent.");
  console.log("Vous pouvez verifier dans Admin > Produits que les produits affichent maintenant le badge Ankorstore.");
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
