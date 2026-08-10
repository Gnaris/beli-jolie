/**
 * Scan Issyma : détecte les produits liés à Ankorstore dont l'external_id
 * côté AS est vide, incohérent, ou introuvable.
 *
 * Read-only, aucune modification. Génère un rapport texte lisible.
 *
 * Usage :
 *   npx tsx scripts/scan-ankor-external-id-issyma.ts
 */

import "dotenv/config";
import { tenantALS } from "@/lib/tenant-als";
import { prisma } from "@/lib/prisma";
import { ankorstoreGetProduct } from "@/lib/ankorstore-api";
import { primeAnkorstoreToken, primeAnkorstoreCredentials } from "@/lib/ankorstore-auth";
import { decryptIfSensitive } from "@/lib/encryption";

const ANKORSTORE_TOKEN_URL = "https://www.ankorstore.com/oauth/token";
const CONCURRENCY = 3;

async function bootstrapAnkorstoreAuth(tenantId: string): Promise<void> {
  const rows = await prisma.siteConfig.findMany({
    where: { tenantId, key: { in: ["ankors_client_id", "ankors_client_secret"] } },
  });
  const map = new Map(
    rows.map((r) => [r.key, decryptIfSensitive(r.key, r.value)?.trim() ?? null]),
  );
  const clientId = map.get("ankors_client_id");
  const clientSecret = map.get("ankors_client_secret");
  if (!clientId || !clientSecret) throw new Error("Identifiants Ankor absents pour tenant " + tenantId);
  primeAnkorstoreCredentials(clientId, clientSecret);
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "*",
  });
  const res = await fetch(ANKORSTORE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Ankor auth failed ${res.status}`);
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("No access_token");
  primeAnkorstoreToken(data.access_token, data.expires_in ?? 3600);
}

type Finding =
  | { kind: "empty"; reference: string; ankorsProductId: string }
  | { kind: "mismatch"; reference: string; ankorsProductId: string; asExternalId: string }
  | { kind: "notfound"; reference: string; ankorsProductId: string }
  | { kind: "error"; reference: string; ankorsProductId: string; error: string };

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { slug: "issyma" } });
  if (!tenant) throw new Error("tenant issyma introuvable");
  console.log(`Tenant Issyma : ${tenant.id}`);

  await bootstrapAnkorstoreAuth(tenant.id);
  console.log("✓ Token Ankor amorcé\n");

  await tenantALS.run(tenant.id, async () => {
    const products = await prisma.product.findMany({
      where: {
        ankorsProductId: { not: null },
        status: { in: ["ONLINE", "OFFLINE"] },
      },
      select: { reference: true, ankorsProductId: true, status: true },
      orderBy: { reference: "asc" },
    });

    console.log(`Produits Issyma liés à Ankor : ${products.length}\n`);
    console.log("Scan en cours (peut prendre ~2-3 min)...\n");

    const findings: Finding[] = [];
    let okCount = 0;
    let done = 0;

    const queue = [...products];
    async function worker() {
      while (queue.length > 0) {
        const p = queue.shift();
        if (!p) return;
        const ref = p.reference;
        const uuid = p.ankorsProductId!;
        try {
          const asProduct = await ankorstoreGetProduct(uuid);
          if (!asProduct) {
            findings.push({ kind: "notfound", reference: ref, ankorsProductId: uuid });
          } else {
            const ext = (asProduct.externalId ?? "").trim();
            if (!ext) {
              findings.push({ kind: "empty", reference: ref, ankorsProductId: uuid });
            } else if (ext.toUpperCase() !== ref.trim().toUpperCase()) {
              findings.push({
                kind: "mismatch",
                reference: ref,
                ankorsProductId: uuid,
                asExternalId: ext,
              });
            } else {
              okCount++;
            }
          }
        } catch (err) {
          findings.push({
            kind: "error",
            reference: ref,
            ankorsProductId: uuid,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        done++;
        if (done % 25 === 0) {
          console.log(`  ${done}/${products.length}...`);
        }
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

    console.log(`\n=== Rapport ===`);
    console.log(`Total scannés     : ${products.length}`);
    console.log(`✓ OK (ext ok)     : ${okCount}`);
    console.log(`⚠ External vide   : ${findings.filter((f) => f.kind === "empty").length}`);
    console.log(`⚠ Ext différent   : ${findings.filter((f) => f.kind === "mismatch").length}`);
    console.log(`✗ Produit AS 404  : ${findings.filter((f) => f.kind === "notfound").length}`);
    console.log(`✗ Erreur réseau   : ${findings.filter((f) => f.kind === "error").length}`);

    const empties = findings.filter((f) => f.kind === "empty");
    if (empties.length > 0) {
      console.log(`\n--- ${empties.length} produits avec external_id VIDE côté Ankor ---`);
      for (const f of empties) {
        console.log(`  ${f.reference}   ankor-uuid: ${f.ankorsProductId}`);
      }
    }

    const mismatches = findings.filter((f) => f.kind === "mismatch");
    if (mismatches.length > 0) {
      console.log(`\n--- ${mismatches.length} produits avec external_id DIFFÉRENT ---`);
      for (const f of mismatches) {
        if (f.kind === "mismatch") {
          console.log(`  ${f.reference}   ext Ankor: "${f.asExternalId}"   ankor-uuid: ${f.ankorsProductId}`);
        }
      }
    }

    const notfounds = findings.filter((f) => f.kind === "notfound");
    if (notfounds.length > 0) {
      console.log(`\n--- ${notfounds.length} produits INTROUVABLES chez Ankor (produit supprimé côté AS ?) ---`);
      for (const f of notfounds) {
        console.log(`  ${f.reference}   ankor-uuid: ${f.ankorsProductId}`);
      }
    }

    const errors = findings.filter((f) => f.kind === "error");
    if (errors.length > 0) {
      console.log(`\n--- ${errors.length} erreurs réseau (à re-scanner) ---`);
      for (const f of errors) {
        if (f.kind === "error") {
          console.log(`  ${f.reference}   ${f.error.slice(0, 120)}`);
        }
      }
    }
  });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("FATAL:", err);
    process.exit(1);
  });
