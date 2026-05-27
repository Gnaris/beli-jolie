/**
 * Nettoyage Ankorstore : supprime les produits en trop + les doublons en
 * surplus, en protégeant les produits déjà liés au site (ankorsProductId BJ).
 *
 * Règles de sélection :
 *  1) JAMAIS supprimer un produit AS dont l'ID est dans Product.ankorsProductId (BJ).
 *  2) Produits AS "en trop" (= aucun match local, ni par lien ni par référence)
 *     → tous supprimés.
 *  3) Doublons par préfixe SKU :
 *     - groupe avec ≥ 1 officiel (lié au site) → garder l'officiel, supprimer
 *       tous les autres (non liés).
 *     - groupe sans officiel → garder le plus ancien (ID alphabétique le plus
 *       petit = créé en premier) et supprimer les autres.
 *  4) Pour supprimer, l'API Ankorstore exige external_id ET au moins un SKU
 *     de variante non vide. Sinon → SKIP avec raison "missing_external_id" /
 *     "missing_skus".
 *
 * Pacing : concurrence 3 kickoffs simultanés (les suppressions sont async côté
 * AS — un kickoff renvoie un operationId, le webhook confirme plus tard).
 * Avec retry/backoff sur 429 déjà géré par ankorstoreFetchJson.
 *
 * Usage (sur le VPS) :
 *   cd /var/www/beliandjolie && npx tsx scripts/ankorstore-cleanup.ts
 *
 * Sortie : /var/www/beliandjolie/ankorstore-cleanup-YYYY-MM-DD-HHMM.xlsx
 * (3 onglets : Récapitulatif, Supprimés OK, Ignorés/Échecs)
 *
 * Lecture seule côté BDD : aucune table locale n'est modifiée.
 * Côté AS : kickoff de suppressions. Note — comme les produits ciblés n'ont
 * pas de Product local correspondant, on N'écrit PAS de ligne AnkorstoreOperation
 * (FK Product). Le webhook AS ignorera ces callbacks (route déjà tolérante).
 */
import "dotenv/config";
import path from "path";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import {
  primeAnkorstoreToken,
  primeAnkorstoreCredentials,
} from "@/lib/ankorstore-auth";
import { decryptIfSensitive } from "@/lib/encryption";
import {
  ankorstoreListAllProducts,
  type AnkorstoreProduct,
} from "@/lib/ankorstore-api";
import { ankorstoreKickoffDelete } from "@/lib/ankorstore-api-write";
import { extractReference } from "@/lib/ankorstore-match";

const ANKORSTORE_TOKEN_URL = "https://www.ankorstore.com/oauth/token";
const OUTPUT_DIR = "/var/www/beliandjolie";
const CONCURRENCY = 3;

async function bootstrapAnkorstoreAuth(): Promise<void> {
  const rows = await prisma.siteConfig.findMany({
    where: { key: { in: ["ankors_client_id", "ankors_client_secret"] } },
  });
  const map = new Map(
    rows.map((r) => [r.key, decryptIfSensitive(r.key, r.value)?.trim() ?? null]),
  );
  const clientId = map.get("ankors_client_id");
  const clientSecret = map.get("ankors_client_secret");
  if (!clientId || !clientSecret) {
    throw new Error("Identifiants Ankorstore manquants.");
  }
  primeAnkorstoreCredentials(clientId, clientSecret);
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });
  const resp = await fetch(ANKORSTORE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!resp.ok) throw new Error(`OAuth Ankorstore HTTP ${resp.status}`);
  const json = (await resp.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token || !json.expires_in) throw new Error("Réponse OAuth invalide");
  primeAnkorstoreToken(json.access_token, Math.floor(Date.now() / 1000) + json.expires_in);
}

function skuReferenceKey(p: AnkorstoreProduct): string | null {
  const counts = new Map<string, number>();
  for (const v of p.variants ?? []) {
    const sku = v.sku?.trim();
    if (!sku) continue;
    const segment = sku.split("_")[0]?.trim();
    if (!segment || segment.length < 2) continue;
    counts.set(segment, (counts.get(segment) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  let bestKey: string | null = null;
  let bestCount = 0;
  for (const [k, c] of counts) {
    if (c > bestCount) {
      bestKey = k;
      bestCount = c;
    }
  }
  return bestKey;
}

type Candidate = {
  as: AnkorstoreProduct;
  reason: "EN_TROP" | "DOUBLON_SURPLUS" | "DOUBLON_ORPHELIN_SURPLUS";
  groupRef: string | null;
};

type ResultRow = {
  ankorsProductId: string;
  externalId: string;
  reference: string;
  productName: string;
  firstSku: string;
  variantsCount: number;
  reason: string;
  outcome: "SUPPRIMÉ" | "IGNORÉ" | "ÉCHEC";
  operationId: string;
  errorMessage: string;
};

async function processWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners: Promise<void>[] = [];
  for (let i = 0; i < concurrency; i++) {
    runners.push(
      (async () => {
        while (true) {
          const idx = cursor++;
          if (idx >= items.length) return;
          await worker(items[idx], idx);
        }
      })(),
    );
  }
  await Promise.all(runners);
}

async function main() {
  console.log("[Ankorstore Cleanup] Démarrage...\n");
  await bootstrapAnkorstoreAuth();
  console.log("✓ Authentification Ankorstore OK\n");

  // 1) Charge index local : ankorsProductId déjà liés + références locales
  const bjProducts = await prisma.product.findMany({
    select: { reference: true, ankorsProductId: true },
  });
  const bjLinkedAnkorsIds = new Set(
    bjProducts.map((p) => p.ankorsProductId).filter((x): x is string => Boolean(x)),
  );
  const bjRefs = new Set(
    bjProducts.map((p) => p.reference.toLowerCase().trim()).filter(Boolean),
  );
  console.log(`✓ Produits locaux : ${bjProducts.length}`);
  console.log(`  dont liés à AS (intouchables) : ${bjLinkedAnkorsIds.size}\n`);

  // 2) Liste TOUS les produits AS non-archivés
  console.log("Récupération du catalogue Ankorstore (10 min env.)...");
  const asProducts = await ankorstoreListAllProducts({
    pageSize: 50,
    onPage: (_page, pageIndex, totalSoFar) => {
      if ((pageIndex + 1) % 10 === 0) {
        console.log(`  page ${pageIndex + 1} → ${totalSoFar} produits`);
      }
    },
  });
  console.log(`✓ ${asProducts.length} produits Ankorstore chargés\n`);

  // 3) Identifie les candidats à supprimer
  const candidates: Candidate[] = [];

  // 3a) Index AS par préfixe SKU pour la détection de doublons
  const asBySku = new Map<string, AnkorstoreProduct[]>();
  for (const as of asProducts) {
    const k = skuReferenceKey(as);
    if (!k) continue;
    const arr = asBySku.get(k.toLowerCase()) ?? [];
    arr.push(as);
    asBySku.set(k.toLowerCase(), arr);
  }

  // 3b) Pour chaque groupe de doublons, marquer les "à supprimer"
  // Set des IDs AS déjà classés comme "doublon à supprimer" — pour éviter
  // double-classification quand on passera ensuite sur les "en trop".
  const dupesToDelete = new Set<string>();
  for (const [skuKey, group] of asBySku) {
    if (group.length < 2) continue;
    // Cherche un officiel dans le groupe
    const officials = group.filter((g) => bjLinkedAnkorsIds.has(g.id));
    if (officials.length >= 1) {
      // Cas A : on a au moins un officiel → supprimer tous les non-officiels
      for (const as of group) {
        if (bjLinkedAnkorsIds.has(as.id)) continue; // PROTECTION
        candidates.push({ as, reason: "DOUBLON_SURPLUS", groupRef: skuKey.toUpperCase() });
        dupesToDelete.add(as.id);
      }
    } else {
      // Cas B : aucun officiel → on garde le plus ancien (ID lexicographique le
      // plus petit = créé en premier côté AS). Supprime les autres.
      const sorted = [...group].sort((a, b) => a.id.localeCompare(b.id));
      // sorted[0] = à garder, le reste = à supprimer
      for (let i = 1; i < sorted.length; i++) {
        const as = sorted[i];
        if (bjLinkedAnkorsIds.has(as.id)) continue; // double-sécurité
        candidates.push({
          as,
          reason: "DOUBLON_ORPHELIN_SURPLUS",
          groupRef: skuKey.toUpperCase(),
        });
        dupesToDelete.add(as.id);
      }
    }
  }

  // 3c) Ajoute les "en trop" purs : aucun match local + pas déjà classés en doublon
  for (const as of asProducts) {
    if (bjLinkedAnkorsIds.has(as.id)) continue; // PROTECTION : déjà lié
    if (dupesToDelete.has(as.id)) continue; // déjà compté côté doublons

    const ref = extractReference(as);
    const refLower = ref?.toLowerCase().trim() ?? "";
    const refMatchesLocal = !!refLower && bjRefs.has(refLower);
    if (refMatchesLocal) continue; // référence connue côté site → on ne touche pas

    candidates.push({ as, reason: "EN_TROP", groupRef: null });
  }

  // Stats par catégorie
  const stats = {
    EN_TROP: candidates.filter((c) => c.reason === "EN_TROP").length,
    DOUBLON_SURPLUS: candidates.filter((c) => c.reason === "DOUBLON_SURPLUS").length,
    DOUBLON_ORPHELIN_SURPLUS: candidates.filter(
      (c) => c.reason === "DOUBLON_ORPHELIN_SURPLUS",
    ).length,
  };

  console.log("=== Plan de suppression ===");
  console.log(`En trop (aucun match)                   : ${stats.EN_TROP}`);
  console.log(`Doublons surplus (groupe avec officiel) : ${stats.DOUBLON_SURPLUS}`);
  console.log(`Doublons orphelins surplus              : ${stats.DOUBLON_ORPHELIN_SURPLUS}`);
  console.log(`TOTAL à supprimer                        : ${candidates.length}\n`);

  // 4) Triple-check de sécurité : aucun candidat ne doit être lié
  const violations = candidates.filter((c) => bjLinkedAnkorsIds.has(c.as.id));
  if (violations.length > 0) {
    console.error(
      `⚠  ${violations.length} candidats sont liés au site — abandon par sécurité.`,
    );
    process.exit(2);
  }
  console.log(`✓ Sécurité OK : 0 produit lié dans la liste de suppression\n`);

  // 5) Exécute les suppressions avec concurrence limitée
  const results: ResultRow[] = [];
  let done = 0;
  const startedAt = Date.now();

  await processWithConcurrency(candidates, CONCURRENCY, async (cand) => {
    const as = cand.as;
    const ref = extractReference(as) ?? "";
    const firstSku = as.variants?.[0]?.sku ?? "";

    // Vérif finale au moment de la suppression
    const externalId = as.externalId?.trim() ?? "";
    const skus = (as.variants ?? [])
      .map((v) => v.sku?.trim())
      .filter((s): s is string => !!s && s.length > 0);

    const row: ResultRow = {
      ankorsProductId: as.id,
      externalId: as.externalId ?? "",
      reference: ref,
      productName: as.name ?? "",
      firstSku,
      variantsCount: as.variants?.length ?? 0,
      reason: cand.reason,
      outcome: "IGNORÉ",
      operationId: "",
      errorMessage: "",
    };

    if (!externalId) {
      row.outcome = "IGNORÉ";
      row.errorMessage = "missing_external_id";
      results.push(row);
      done++;
      return;
    }
    if (skus.length === 0) {
      row.outcome = "IGNORÉ";
      row.errorMessage = "missing_skus";
      results.push(row);
      done++;
      return;
    }

    try {
      const { operationId } = await ankorstoreKickoffDelete(externalId, skus);
      row.outcome = "SUPPRIMÉ";
      row.operationId = operationId;
      results.push(row);
    } catch (err) {
      row.outcome = "ÉCHEC";
      row.errorMessage = err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200);
      results.push(row);
    }
    done++;
    if (done % 50 === 0 || done === candidates.length) {
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      console.log(`  ${done}/${candidates.length} traités (${elapsed}s)`);
    }
  });

  const okCount = results.filter((r) => r.outcome === "SUPPRIMÉ").length;
  const ignoredCount = results.filter((r) => r.outcome === "IGNORÉ").length;
  const failedCount = results.filter((r) => r.outcome === "ÉCHEC").length;

  console.log("\n=== Bilan final ===");
  console.log(`Kickoffs envoyés à Ankorstore : ${okCount}`);
  console.log(`Ignorés (données manquantes)  : ${ignoredCount}`);
  console.log(`Échecs (erreur API)            : ${failedCount}`);

  // 6) Excel
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Beli & Jolie";
  workbook.created = new Date();

  const recap = workbook.addWorksheet("Récapitulatif");
  recap.columns = [
    { header: "Catégorie", key: "label", width: 60 },
    { header: "Nombre", key: "count", width: 12 },
  ];
  recap.getRow(1).font = { bold: true };
  recap.addRows([
    { label: "Produits AS au total", count: asProducts.length },
    { label: "Produits liés (intouchables)", count: bjLinkedAnkorsIds.size },
    { label: "Candidats à supprimer", count: candidates.length },
    { label: "  → En trop (aucun match)", count: stats.EN_TROP },
    { label: "  → Doublons surplus", count: stats.DOUBLON_SURPLUS },
    { label: "  → Doublons orphelins surplus", count: stats.DOUBLON_ORPHELIN_SURPLUS },
    { label: "", count: 0 },
    { label: "Kickoffs envoyés (SUPPRIMÉ)", count: okCount },
    { label: "Ignorés (données manquantes)", count: ignoredCount },
    { label: "Échecs (erreur API)", count: failedCount },
  ]);

  const detail = workbook.addWorksheet("Détail");
  detail.columns = [
    { header: "Résultat", key: "outcome", width: 14 },
    { header: "Raison de suppression", key: "reason", width: 28 },
    { header: "Référence", key: "reference", width: 16 },
    { header: "Nom produit AS", key: "productName", width: 50 },
    { header: "1er SKU variante", key: "firstSku", width: 22 },
    { header: "Nb variantes", key: "variantsCount", width: 12 },
    { header: "ID Ankorstore", key: "ankorsProductId", width: 38 },
    { header: "externalId", key: "externalId", width: 22 },
    { header: "operationId AS", key: "operationId", width: 38 },
    { header: "Erreur / motif", key: "errorMessage", width: 50 },
  ];
  detail.getRow(1).font = { bold: true };
  detail.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE0E0E0" },
  };
  // Tri : échecs en premier, puis ignorés, puis OK
  results.sort((a, b) => {
    const order = { ÉCHEC: 0, IGNORÉ: 1, SUPPRIMÉ: 2 } as const;
    return order[a.outcome] - order[b.outcome];
  });
  detail.addRows(results);
  detail.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: detail.columns.length },
  };

  const stamp = new Date()
    .toISOString()
    .slice(0, 16)
    .replace("T", "-")
    .replace(":", "");
  const outPath = path.join(OUTPUT_DIR, `ankorstore-cleanup-${stamp}.xlsx`);
  await workbook.xlsx.writeFile(outPath);

  console.log(`\n✓ Fichier de bilan : ${outPath}`);
}

main()
  .catch((err) => {
    console.error("[Ankorstore Cleanup] Échec :", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
