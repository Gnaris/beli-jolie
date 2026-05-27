/**
 * Audit des produits "en trop" sur Ankorstore.
 *
 * Stratégie :
 *  1. Liste tous les produits Ankorstore non-archivés via /products
 *     (pagination cursor, jusqu'à 20 000 produits — safety cap).
 *  2. Charge en BDD locale tous les Product (id, reference, name, ankorsProductId, status).
 *  3. Pour chaque produit AS, vérifie s'il a un équivalent local :
 *       - lien direct  : ankorsProductId == AS.id
 *       - par référence: extractReference(AS) trouve une Product.reference (case-insensitive)
 *  4. Tout ce qui n'a aucun match = candidat à supprimer côté AS.
 *  5. Génère un Excel listant ces produits en trop + récap par catégorie.
 *
 * Usage (sur le VPS) :
 *   cd /var/www/beliandjolie && npx tsx scripts/ankorstore-extras-audit.ts
 *
 * Sortie :
 *   /var/www/beliandjolie/ankorstore-extras-YYYY-MM-DD-HHMM.xlsx
 *   (déposé dans la racine du repo → visible immédiatement via le lecteur V:)
 *
 * Lecture seule : ne modifie rien en BDD ni côté Ankorstore.
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
import { ankorstoreListAllProducts } from "@/lib/ankorstore-api";
import { extractReference } from "@/lib/ankorstore-match";

const ANKORSTORE_TOKEN_URL = "https://www.ankorstore.com/oauth/token";
const OUTPUT_DIR = "/var/www/beliandjolie";

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
    throw new Error(
      "Identifiants Ankorstore manquants — Admin > Paramètres > Marketplaces.",
    );
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

type ExtraRow = {
  ankorsProductId: string;
  externalId: string;
  extractedRef: string;
  productName: string;
  variantSkuFirst: string;
  variantsCount: number;
  retailPrice: number;
  wholesalePrice: number;
  active: string;
  reason: string;
};

async function main() {
  console.log("[Ankorstore Extras Audit] Démarrage...\n");
  await bootstrapAnkorstoreAuth();
  console.log("✓ Authentification Ankorstore OK\n");

  // 1) Charge tous les Product locaux (peu importe le statut — un ARCHIVED
  //    local reste un "équivalent" qui justifie la présence côté AS).
  const bjProducts = await prisma.product.findMany({
    select: { id: true, reference: true, name: true, ankorsProductId: true, status: true },
  });
  console.log(`✓ Produits locaux chargés : ${bjProducts.length}`);

  // Lookup maps
  const bjByAnkorsId = new Map<string, (typeof bjProducts)[number]>();
  const bjByRef = new Map<string, (typeof bjProducts)[number][]>();
  for (const p of bjProducts) {
    if (p.ankorsProductId) bjByAnkorsId.set(p.ankorsProductId, p);
    const key = p.reference.toLowerCase().trim();
    if (!key) continue;
    const arr = bjByRef.get(key) ?? [];
    arr.push(p);
    bjByRef.set(key, arr);
  }
  const linkedCount = bjByAnkorsId.size;
  console.log(`  dont liés à Ankorstore (ankorsProductId) : ${linkedCount}\n`);

  // 2) Liste TOUS les produits Ankorstore non archivés
  console.log("Récupération du catalogue Ankorstore (peut prendre 5-10 min)...");
  let totalFetched = 0;
  const asProducts = await ankorstoreListAllProducts({
    pageSize: 50,
    onPage: (_page, pageIndex, totalSoFar) => {
      totalFetched = totalSoFar;
      if ((pageIndex + 1) % 10 === 0) {
        console.log(`  page ${pageIndex + 1} → ${totalSoFar} produits chargés`);
      }
    },
  });
  console.log(`✓ ${asProducts.length} produits Ankorstore chargés\n`);

  // 3) Pour chaque produit AS, cherche un équivalent local
  const extras: ExtraRow[] = [];
  let matchedByLink = 0;
  let matchedByRef = 0;
  let extraNoRef = 0;
  let extraWithRef = 0;

  for (const as of asProducts) {
    // a) Lien direct via ankorsProductId
    if (bjByAnkorsId.has(as.id)) {
      matchedByLink++;
      continue;
    }
    // b) Match par référence extraite
    const ref = extractReference(as);
    const refLower = ref?.toLowerCase().trim() ?? "";
    if (refLower && bjByRef.has(refLower)) {
      matchedByRef++;
      continue;
    }
    // c) En trop
    const firstSku = as.variants?.[0]?.sku ?? "";
    extras.push({
      ankorsProductId: as.id,
      externalId: as.externalId ?? "",
      extractedRef: ref ?? "",
      productName: as.name ?? "",
      variantSkuFirst: firstSku,
      variantsCount: as.variants?.length ?? 0,
      retailPrice: as.retailPrice ?? 0,
      wholesalePrice: as.wholesalePrice ?? 0,
      active: as.active ? "oui" : "non",
      reason: ref ? "Référence inconnue côté site" : "Aucune référence détectable",
    });
    if (ref) extraWithRef++; else extraNoRef++;
  }

  console.log("=== Résultat du diagnostic ===");
  console.log(`Total produits Ankorstore  : ${asProducts.length}`);
  console.log(`  Liés via ankorsProductId  : ${matchedByLink}`);
  console.log(`  Trouvés par référence     : ${matchedByRef}`);
  console.log(`  EN TROP (aucun match)     : ${extras.length}`);
  console.log(`     dont avec une référence détectable mais inconnue : ${extraWithRef}`);
  console.log(`     dont sans référence détectable                   : ${extraNoRef}\n`);

  // 4) Excel
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Beli & Jolie";
  workbook.created = new Date();

  // Feuille 1 : récap
  const recap = workbook.addWorksheet("Récapitulatif");
  recap.columns = [
    { header: "Catégorie", key: "label", width: 60 },
    { header: "Nombre", key: "count", width: 12 },
  ];
  recap.getRow(1).font = { bold: true };
  recap.addRows([
    { label: "Total produits sur Ankorstore (non archivés)", count: asProducts.length },
    { label: "Produits liés directement à votre site", count: matchedByLink },
    { label: "Produits retrouvés par référence", count: matchedByRef },
    { label: "Produits EN TROP (à examiner)", count: extras.length },
    { label: "  → avec une référence détectable mais inconnue", count: extraWithRef },
    { label: "  → sans référence détectable", count: extraNoRef },
  ]);

  // Feuille 2 : détail des produits en trop
  const detail = workbook.addWorksheet("Produits en trop");
  detail.columns = [
    { header: "Référence détectée", key: "extractedRef", width: 18 },
    { header: "Nom produit Ankorstore", key: "productName", width: 50 },
    { header: "1er SKU variante", key: "variantSkuFirst", width: 22 },
    { header: "Nb variantes", key: "variantsCount", width: 12 },
    { header: "Prix détail", key: "retailPrice", width: 12 },
    { header: "Prix gros", key: "wholesalePrice", width: 12 },
    { header: "Actif AS", key: "active", width: 10 },
    { header: "ID Ankorstore", key: "ankorsProductId", width: 38 },
    { header: "externalId", key: "externalId", width: 22 },
    { header: "Raison", key: "reason", width: 38 },
  ];
  detail.getRow(1).font = { bold: true };
  detail.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE0E0E0" },
  };
  // Tri : d'abord ceux avec référence détectée (plus faciles à inspecter), puis les autres
  extras.sort((a, b) => {
    if (a.extractedRef && !b.extractedRef) return -1;
    if (!a.extractedRef && b.extractedRef) return 1;
    return a.extractedRef.localeCompare(b.extractedRef);
  });
  detail.addRows(extras);
  detail.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: detail.columns.length },
  };

  const stamp = new Date()
    .toISOString()
    .slice(0, 16)
    .replace("T", "-")
    .replace(":", "");
  const outPath = path.join(OUTPUT_DIR, `ankorstore-extras-${stamp}.xlsx`);
  await workbook.xlsx.writeFile(outPath);

  console.log(`✓ Fichier généré : ${outPath}`);
  console.log(`  (visible immédiatement via le lecteur V: à la racine)`);
}

main()
  .catch((err) => {
    console.error("[Ankorstore Extras Audit] Échec :", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
