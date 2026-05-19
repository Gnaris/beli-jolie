/**
 * Audit des produits en BROUILLON sur Ankorstore.
 *
 * Stratégie :
 *  1. Charge en BDD locale toutes les opérations Ankorstore terminées en échec
 *     (FAILED ou PARTIALLY_FAILED) qui sont susceptibles d'avoir produit un
 *     brouillon côté AS (PUBLISH, REFRESH_CREATE_NEW, UPDATE).
 *  2. Garde uniquement la plus récente opération par produit (les anciennes
 *     ont été remplacées par les nouvelles tentatives).
 *  3. Pour chaque opération retenue, appelle Ankorstore
 *     `/catalog/integrations/operations/{operationId}/results` pour récupérer
 *     les `issues` détaillées (champ + raison + message).
 *  4. Génère un fichier Excel sur le serveur dans /var/log/
 *
 * Usage (sur le VPS) :
 *   cd /var/www/beliandjolie && npx tsx scripts/ankorstore-drafts-audit.ts
 *
 * Sortie :
 *   /var/log/ankorstore-drafts-audit-YYYY-MM-DD-HHMM.xlsx
 *
 * Lecture seule : ne modifie rien en BDD ni côté Ankorstore.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import {
  primeAnkorstoreToken,
  primeAnkorstoreCredentials,
} from "@/lib/ankorstore-auth";
import { decryptIfSensitive } from "@/lib/encryption";
import { ankorstoreFetchOperationResults } from "@/lib/ankorstore-api-write";

const ANKORSTORE_TOKEN_URL = "https://www.ankorstore.com/oauth/token";
const OUTPUT_DIR = "/var/log";

type Issue = {
  field?: string;
  reason?: string;
  message?: string;
};

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

function suggestFix(field: string | undefined, reason: string | undefined): string {
  const f = (field ?? "").toLowerCase();
  const r = (reason ?? "").toLowerCase();
  if (r === "required_field") {
    if (f.includes("sku")) return "Référence (SKU) manquante sur une variante. Vérifiez les couleurs/tailles.";
    if (f.includes("ian") || f.includes("ean") || f.includes("gtin")) return "Code-barres manquant (optionnel — peut être ignoré côté nous).";
    if (f.includes("image")) return "Image manquante. Ajoutez au moins 1 photo pour cette couleur.";
    if (f.includes("weight")) return "Poids manquant. Renseignez le poids de la variante (kg).";
    if (f.includes("price")) return "Prix manquant. Vérifiez prix de gros et prix détail.";
    if (f.includes("description")) return "Description vide.";
    if (f.includes("name")) return "Nom de produit vide.";
    if (f.includes("country")) return "Pays de fabrication manquant.";
    if (f.includes("hscode") || f.includes("hs_code")) return "Code douanier (HS) manquant.";
    return "Champ obligatoire vide.";
  }
  if (r === "invalid_field") {
    if (f.includes("ian") || f.includes("ean")) return "Code-barres invalide (doit faire exactement 13 caractères).";
    if (f.includes("image")) return "URL d'image invalide ou inaccessible.";
    if (f.includes("price")) return "Prix invalide (doit être un nombre positif).";
    return "Format de champ invalide.";
  }
  if (r === "invalid_image") {
    return "Image trop petite (< 500px) ou format non supporté. Refresh devrait régler ça (proxy upscale).";
  }
  if (r === "internal_error") {
    return "Erreur interne Ankorstore — réessayez plus tard, ou contactez leur support.";
  }
  return "À analyser manuellement.";
}

async function main() {
  console.log("[Ankorstore Drafts Audit] Démarrage...\n");
  await bootstrapAnkorstoreAuth();
  console.log("✓ Authentification Ankorstore OK\n");

  // 1) Opérations échouées récentes, par type qui crée un produit/brouillon
  const failedOps = await prisma.ankorstoreOperation.findMany({
    where: {
      status: { in: ["FAILED", "PARTIALLY_FAILED"] },
      type: { in: ["PUBLISH", "REFRESH_CREATE_NEW", "UPDATE"] },
    },
    select: {
      id: true,
      productId: true,
      type: true,
      status: true,
      errorMessage: true,
      createdAt: true,
      completedAt: true,
      product: {
        select: {
          reference: true,
          name: true,
          ankorsProductId: true,
          status: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  console.log(`Opérations en échec trouvées : ${failedOps.length}`);

  // 2) Garde uniquement la plus récente par produit
  const byProduct = new Map<string, (typeof failedOps)[number]>();
  for (const op of failedOps) {
    if (!byProduct.has(op.productId)) byProduct.set(op.productId, op);
  }
  const latestPerProduct = Array.from(byProduct.values());
  console.log(`Produits uniques concernés : ${latestPerProduct.length}\n`);

  // 3) Pour chaque opération, récupère les issues côté Ankorstore
  const rows: {
    reference: string;
    productName: string;
    productStatus: string;
    operationType: string;
    operationDate: string;
    ankorsProductId: string;
    errorMessageLocal: string;
    field: string;
    reason: string;
    message: string;
    suggestion: string;
  }[] = [];

  let processed = 0;
  for (const op of latestPerProduct) {
    processed++;
    const ref = op.product?.reference ?? "?";
    process.stdout.write(
      `[${processed}/${latestPerProduct.length}] ${ref}... `,
    );
    try {
      const results = await ankorstoreFetchOperationResults(op.id);
      const failures = results.filter((r) => r.status === "failure");
      if (failures.length === 0) {
        rows.push({
          reference: ref,
          productName: op.product?.name ?? "",
          productStatus: op.product?.status ?? "",
          operationType: op.type,
          operationDate: op.createdAt.toISOString().slice(0, 16).replace("T", " "),
          ankorsProductId: op.product?.ankorsProductId ?? "",
          errorMessageLocal: op.errorMessage ?? "",
          field: "(aucune issue détaillée)",
          reason: "",
          message: op.errorMessage ?? "Voir message d'erreur local.",
          suggestion: "À analyser manuellement.",
        });
      } else {
        for (const failure of failures) {
          const issues = (failure.issues as Issue[]) ?? [];
          if (issues.length === 0) {
            rows.push({
              reference: ref,
              productName: op.product?.name ?? "",
              productStatus: op.product?.status ?? "",
              operationType: op.type,
              operationDate: op.createdAt.toISOString().slice(0, 16).replace("T", " "),
              ankorsProductId: op.product?.ankorsProductId ?? "",
              errorMessageLocal: op.errorMessage ?? "",
              field: "",
              reason: failure.failureReason ?? "",
              message: failure.failureReason ?? "",
              suggestion: suggestFix(undefined, failure.failureReason ?? undefined),
            });
          } else {
            for (const issue of issues) {
              rows.push({
                reference: ref,
                productName: op.product?.name ?? "",
                productStatus: op.product?.status ?? "",
                operationType: op.type,
                operationDate: op.createdAt.toISOString().slice(0, 16).replace("T", " "),
                ankorsProductId: op.product?.ankorsProductId ?? "",
                errorMessageLocal: op.errorMessage ?? "",
                field: issue.field ?? "",
                reason: issue.reason ?? "",
                message: issue.message ?? "",
                suggestion: suggestFix(issue.field, issue.reason),
              });
            }
          }
        }
      }
      console.log("OK");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      rows.push({
        reference: ref,
        productName: op.product?.name ?? "",
        productStatus: op.product?.status ?? "",
        operationType: op.type,
        operationDate: op.createdAt.toISOString().slice(0, 16).replace("T", " "),
        ankorsProductId: op.product?.ankorsProductId ?? "",
        errorMessageLocal: op.errorMessage ?? "",
        field: "(API Ankorstore inaccessible)",
        reason: "",
        message: msg,
        suggestion: "Lookup Ankorstore failed — utilisez le message d'erreur local.",
      });
      console.log("ECHEC: " + msg.slice(0, 80));
    }
  }

  // 4) Récap par champ
  const byField = new Map<string, number>();
  for (const r of rows) {
    const key = `${r.reason || "?"} → ${r.field || "?"}`;
    byField.set(key, (byField.get(key) ?? 0) + 1);
  }
  const summary = Array.from(byField.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => ({ category: k, count: n }));

  console.log("\n=== Récap par type d'erreur ===");
  for (const s of summary) console.log(`  ${s.count.toString().padStart(4)} × ${s.category}`);

  // 5) Génère l'Excel
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Beli & Jolie";
  workbook.created = new Date();

  // Feuille 1 : récap
  const recap = workbook.addWorksheet("Récapitulatif");
  recap.columns = [
    { header: "Type d'erreur", key: "category", width: 60 },
    { header: "Nombre", key: "count", width: 10 },
  ];
  recap.getRow(1).font = { bold: true };
  recap.addRows(summary);

  // Feuille 2 : détail
  const detail = workbook.addWorksheet("Détail par produit");
  detail.columns = [
    { header: "Référence", key: "reference", width: 12 },
    { header: "Nom produit", key: "productName", width: 40 },
    { header: "Statut local", key: "productStatus", width: 10 },
    { header: "Type op.", key: "operationType", width: 18 },
    { header: "Date op.", key: "operationDate", width: 18 },
    { header: "ID Ankorstore", key: "ankorsProductId", width: 38 },
    { header: "Erreur (local)", key: "errorMessageLocal", width: 50 },
    { header: "Champ en cause", key: "field", width: 25 },
    { header: "Raison", key: "reason", width: 20 },
    { header: "Message Ankorstore", key: "message", width: 50 },
    { header: "Suggestion correction", key: "suggestion", width: 55 },
  ];
  detail.getRow(1).font = { bold: true };
  detail.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE0E0E0" },
  };
  detail.addRows(rows);
  detail.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: detail.columns.length },
  };

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const stamp = new Date()
    .toISOString()
    .slice(0, 16)
    .replace("T", "-")
    .replace(":", "");
  const outPath = path.join(OUTPUT_DIR, `ankorstore-drafts-audit-${stamp}.xlsx`);
  await workbook.xlsx.writeFile(outPath);

  console.log(`\n✓ Fichier généré : ${outPath}`);
  console.log(`  ${rows.length} lignes de détail · ${summary.length} catégories d'erreurs`);
}

main()
  .catch((err) => {
    console.error("[Ankorstore Drafts Audit] Échec :", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
