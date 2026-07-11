/**
 * Test rigoureux post-fix C6+C7 :
 *  1. Récupère un produit de demo et un produit de beli-jolie via un client bypass
 *  2. Depuis Host=beli-jolie tente delete, update, upsert sur le produit de demo
 *     → tous les 3 doivent échouer AVEC data intacte en BDD
 *  3. Idem pour une commande cross-tenant (ship, cancel)
 *
 * Doit être lancé APRÈS avoir redémarré le dev server avec le fix.
 */
import { PrismaClient } from "@prisma/client";

// Client raw : bypass extension. Utilisé pour vérifier l'état BDD réel.
const rawPrisma = new PrismaClient();

const DEV_URL = "http://127.0.0.1:3000";
const HOST_BELI = "beliandjolie.com";
const HOST_DEMO = "demo.beliandjolie.com";

import * as http from "node:http";

async function apiCall(host: string, op: string, extra: Record<string, unknown>): Promise<{
  ok: boolean;
  error?: string;
  tenant?: { slug: string };
  [k: string]: unknown;
}> {
  // Utilise http.request pour pouvoir surcharger le header Host (fetch undici refuse).
  const body = JSON.stringify({ op, ...extra });
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: 3000,
        path: "/api/dev/cross-tenant-test",
        method: "POST",
        headers: {
          Host: host,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body).toString(),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Bad response: ${data.slice(0, 200)}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const beliTenant = await rawPrisma.tenant.findUnique({ where: { slug: "beli-jolie" } });
  const demoTenant = await rawPrisma.tenant.findUnique({ where: { slug: "demo" } });
  if (!beliTenant || !demoTenant) throw new Error("Tenants introuvables");

  const demoProduct = await rawPrisma.product.findFirst({ where: { tenantId: demoTenant.id } });
  const beliProduct = await rawPrisma.product.findFirst({ where: { tenantId: beliTenant.id } });
  const beliOrder = await rawPrisma.order.findFirst({ where: { tenantId: beliTenant.id } });
  if (!demoProduct || !beliProduct || !beliOrder) {
    throw new Error("Données de test manquantes");
  }

  console.log(`Cibles :`);
  console.log(`  demoProduct ${demoProduct.reference} (id=${demoProduct.id}) name="${demoProduct.name}"`);
  console.log(`  beliProduct ${beliProduct.reference} (id=${beliProduct.id})`);
  console.log(`  beliOrder ${beliOrder.orderNumber} status=${beliOrder.status}\n`);

  // === TEST 1 : Beli tente delete du produit DEMO ===
  console.log(`--- Test 1 : Host=beli tente delete du produit demo ---`);
  const r1 = await apiCall(HOST_BELI, "deleteProductCrossTenant", { targetProductId: demoProduct.id });
  const after1 = await rawPrisma.product.findUnique({ where: { id: demoProduct.id } });
  console.log(`  API : ok=${r1.ok} error="${r1.error ?? "-"}"`);
  console.log(`  BDD : produit ${after1 ? "TOUJOURS PRÉSENT" : "SUPPRIMÉ"} (name="${after1?.name}")`);
  const test1Pass = !r1.ok && after1 !== null && after1.name === demoProduct.name;
  console.log(`  ${test1Pass ? "✅ ISOLATION OK" : "❌ FUITE"}\n`);

  // === TEST 2 : Beli tente update du produit DEMO (renommage) ===
  console.log(`--- Test 2 : Host=beli tente update du produit demo ---`);
  const r2 = await apiCall(HOST_BELI, "updateProductCrossTenant", { targetProductId: demoProduct.id });
  const after2 = await rawPrisma.product.findUnique({ where: { id: demoProduct.id } });
  console.log(`  API : ok=${r2.ok} error="${r2.error ?? "-"}"`);
  console.log(`  BDD : name="${after2?.name}"`);
  const test2Pass = !r2.ok && after2?.name === demoProduct.name;
  console.log(`  ${test2Pass ? "✅ ISOLATION OK" : "❌ FUITE"}\n`);

  // === TEST 3 : Demo tente valider (SHIPPED) une commande de BELI ===
  console.log(`--- Test 3 : Host=demo tente valider (SHIPPED) une commande beli ---`);
  const r3 = await apiCall(HOST_DEMO, "shipOrderCrossTenant", { targetOrderId: beliOrder.id });
  const after3 = await rawPrisma.order.findUnique({ where: { id: beliOrder.id } });
  console.log(`  API : ok=${r3.ok} error="${r3.error ?? "-"}"`);
  console.log(`  BDD : status=${after3?.status}`);
  const test3Pass = !r3.ok && after3?.status === beliOrder.status;
  console.log(`  ${test3Pass ? "✅ ISOLATION OK" : "❌ FUITE"}\n`);

  // === TEST 4 : Demo tente annuler (CANCELLED) une commande de BELI ===
  console.log(`--- Test 4 : Host=demo tente annuler une commande beli ---`);
  const r4 = await apiCall(HOST_DEMO, "cancelOrderCrossTenant", { targetOrderId: beliOrder.id });
  const after4 = await rawPrisma.order.findUnique({ where: { id: beliOrder.id } });
  console.log(`  API : ok=${r4.ok} error="${r4.error ?? "-"}"`);
  console.log(`  BDD : status=${after4?.status}`);
  const test4Pass = !r4.ok && after4?.status === beliOrder.status;
  console.log(`  ${test4Pass ? "✅ ISOLATION OK" : "❌ FUITE"}\n`);

  // === TEST 5 : Beli tente upsert sur la référence d'un produit DEMO ===
  console.log(`--- Test 5 : Host=beli tente upsert sur réf ${demoProduct.reference} (produit demo) ---`);
  const r5 = await apiCall(HOST_BELI, "upsertProductCrossTenant", {
    targetProductReference: demoProduct.reference,
  });
  const after5 = await rawPrisma.product.findUnique({ where: { id: demoProduct.id } });
  console.log(`  API : ok=${r5.ok} error="${r5.error ?? "-"}"`);
  console.log(`  BDD : name="${after5?.name}" tenantId=${after5?.tenantId}`);
  const test5Pass = !r5.ok && after5?.name === demoProduct.name && after5?.tenantId === demoTenant.id;
  console.log(`  ${test5Pass ? "✅ ISOLATION OK" : "❌ FUITE"}\n`);

  const passed = [test1Pass, test2Pass, test3Pass, test4Pass, test5Pass].filter(Boolean).length;
  console.log(`\n===================================================`);
  console.log(`RÉSULTAT : ${passed}/5 tests passent`);
  console.log(`===================================================`);
  if (passed !== 5) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => rawPrisma.$disconnect());
