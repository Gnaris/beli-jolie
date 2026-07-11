/**
 * Test d'isolation des LECTURES multi-tenant.
 *
 * Trois blocs :
 *   A) Vérifie que /api/admin/tenant-echo renvoie le bon tenant selon Host.
 *   B) Compare, via Prisma direct en mode "scope off" (contexte CLI), la
 *      somme des rows par tenant vs le total global. Vérifie aussi qu'aucune
 *      row multi-tenant ne porte tenantId=null (backfill complet).
 *   C) End-to-end : appelle /api/admin/tenant-stats avec Host=beliandjolie.com
 *      puis Host=demo.beliandjolie.com et vérifie que les counts diffèrent
 *      et correspondent aux stats attendues (~500 products pour Beli, 3 pour Demo).
 *
 * Usage :
 *   MULTI_TENANT_SCOPE=off npx tsx scripts/dev/test-read-isolation.ts
 *
 * (Le `MULTI_TENANT_SCOPE=off` sert au bloc B qui utilise directement Prisma
 * dans un contexte sans headers ; sans le flag, le scoping est déjà bypass
 * naturellement — donc c'est facultatif, mais on force la clarté.)
 */

import * as http from "node:http";

const HOST_IP = "127.0.0.1";
const PORT = 3000;

const BELI_HOST = "beliandjolie.com";
const DEMO_HOST = "demo.beliandjolie.com";
const UNKNOWN_HOST = "does-not-exist.local";

const BELI_TENANT = "cmrgfr0380000ikm3d0a94n6z";
const DEMO_TENANT = "cmrgiq09s000011sdxr81wn2l";

type Json = Record<string, unknown>;

/**
 * On utilise `http.request` bas niveau car fetch/undici écrase le Host header.
 */
async function get(host: string, path: string): Promise<{ status: number; json: Json }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: HOST_IP,
        port: PORT,
        path,
        method: "GET",
        headers: { Host: host },
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          let json: Json = {};
          try {
            json = JSON.parse(raw);
          } catch {
            json = { raw };
          }
          resolve({ status: res.statusCode ?? 0, json });
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

const results: { name: string; pass: boolean; detail: string }[] = [];
function record(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
  const icon = pass ? "OK  " : "FAIL";
  console.log(`[${icon}] ${name} — ${detail}`);
}

async function main() {
  console.log("═════════════════════════════════════════════════════════════════");
  console.log("A) Résolution tenant via Host header (/api/admin/tenant-echo)");
  console.log("═════════════════════════════════════════════════════════════════");

  const echoBeli = await get(BELI_HOST, "/api/admin/tenant-echo");
  const echoBeliTenant = (echoBeli.json.tenant as { id?: string } | null)?.id;
  record(
    "Host=beliandjolie.com → tenant=beli-jolie",
    echoBeli.status === 200 && echoBeliTenant === BELI_TENANT,
    `status=${echoBeli.status} id=${echoBeliTenant ?? "null"}`
  );

  const echoDemo = await get(DEMO_HOST, "/api/admin/tenant-echo");
  const echoDemoTenant = (echoDemo.json.tenant as { id?: string } | null)?.id;
  record(
    "Host=demo.beliandjolie.com → tenant=demo",
    echoDemo.status === 200 && echoDemoTenant === DEMO_TENANT,
    `status=${echoDemo.status} id=${echoDemoTenant ?? "null"}`
  );

  const echoUnknown = await get(UNKNOWN_HOST, "/api/admin/tenant-echo");
  const echoUnknownTenant = (echoUnknown.json.tenant as { id?: string } | null)?.id;
  record(
    "Host=inconnu → tenant=null (pas de header injecté)",
    echoUnknown.status === 200 && !echoUnknownTenant,
    `status=${echoUnknown.status} id=${echoUnknownTenant ?? "null"}`
  );

  console.log("\n═════════════════════════════════════════════════════════════════");
  console.log("B) Cohérence BDD (Prisma direct, contexte CLI = scope bypass)");
  console.log("═════════════════════════════════════════════════════════════════");

  // Import dynamique : garanti bypass car pas de headers, mais on met
  // aussi MULTI_TENANT_SCOPE=off dans l'ENV pour double-sûreté.
  const { prisma } = await import("../../lib/prisma");

  // Total global vs somme par tenant, sur les tables scopées principales.
  const tables = [
    { name: "Product", global: () => prisma.product.count(), byTenant: (tenantId: string) => prisma.product.count({ where: { tenantId } }), nullCount: () => prisma.product.count({ where: { tenantId: null as unknown as string } }) },
    { name: "User", global: () => prisma.user.count(), byTenant: (tenantId: string) => prisma.user.count({ where: { tenantId } }), nullCount: () => prisma.user.count({ where: { tenantId: null as unknown as string } }) },
    { name: "Order", global: () => prisma.order.count(), byTenant: (tenantId: string) => prisma.order.count({ where: { tenantId } }), nullCount: () => prisma.order.count({ where: { tenantId: null as unknown as string } }) },
    { name: "CompanyInfo", global: () => prisma.companyInfo.count(), byTenant: (tenantId: string) => prisma.companyInfo.count({ where: { tenantId } }), nullCount: () => prisma.companyInfo.count({ where: { tenantId: null as unknown as string } }) },
    { name: "SiteConfig", global: () => prisma.siteConfig.count(), byTenant: (tenantId: string) => prisma.siteConfig.count({ where: { tenantId } }), nullCount: () => prisma.siteConfig.count({ where: { tenantId: null as unknown as string } }) },
    { name: "ProductColor", global: () => prisma.productColor.count(), byTenant: (tenantId: string) => prisma.productColor.count({ where: { tenantId } }), nullCount: () => prisma.productColor.count({ where: { tenantId: null as unknown as string } }) },
    { name: "OrderItem", global: () => prisma.orderItem.count(), byTenant: (tenantId: string) => prisma.orderItem.count({ where: { tenantId } }), nullCount: () => prisma.orderItem.count({ where: { tenantId: null as unknown as string } }) },
  ] as const;

  const stats: Record<string, { global: number; beli: number; demo: number; nulls: number }> = {};

  for (const t of tables) {
    const [g, b, d, n] = await Promise.all([t.global(), t.byTenant(BELI_TENANT), t.byTenant(DEMO_TENANT), t.nullCount()]);
    stats[t.name] = { global: g, beli: b, demo: d, nulls: n };
    const sumOk = b + d + n === g;
    const nullOk = n === 0;
    record(
      `${t.name} — somme(beli=${b}, demo=${d}, nulls=${n}) == global(${g})`,
      sumOk,
      sumOk ? "OK" : `écart de ${g - (b + d + n)}`
    );
    record(
      `${t.name} — aucune row multi-tenant orpheline (tenantId=null)`,
      nullOk,
      nullOk ? "0 orpheline" : `${n} row(s) sans tenantId`
    );
  }

  console.log("\n─── Récap chiffré ──────────────────────────────────────────────");
  console.log("Table         | Global | Beli | Demo | null");
  console.log("--------------|--------|------|------|-----");
  for (const [name, s] of Object.entries(stats)) {
    console.log(`${name.padEnd(13)} | ${String(s.global).padStart(6)} | ${String(s.beli).padStart(4)} | ${String(s.demo).padStart(4)} | ${String(s.nulls).padStart(4)}`);
  }

  console.log("\n═════════════════════════════════════════════════════════════════");
  console.log("C) End-to-end HTTP (/api/admin/tenant-stats via Host header)");
  console.log("═════════════════════════════════════════════════════════════════");

  const statsBeli = await get(BELI_HOST, "/api/admin/tenant-stats");
  const statsDemo = await get(DEMO_HOST, "/api/admin/tenant-stats");

  const countsBeli = statsBeli.json.counts as Record<string, number> | undefined;
  const countsDemo = statsDemo.json.counts as Record<string, number> | undefined;

  console.log("\nBeli via HTTP  :", JSON.stringify(countsBeli));
  console.log("Demo via HTTP  :", JSON.stringify(countsDemo));

  // Cas critique #1 : Beli via HTTP doit correspondre aux stats BDD Beli
  const beliMatchesBdd =
    !!countsBeli &&
    countsBeli.products === stats.Product.beli &&
    countsBeli.users === stats.User.beli &&
    countsBeli.orders === stats.Order.beli &&
    countsBeli.companyInfos === stats.CompanyInfo.beli &&
    countsBeli.siteConfigs === stats.SiteConfig.beli;
  record(
    "HTTP Beli — counts == stats BDD Beli",
    beliMatchesBdd,
    `products http=${countsBeli?.products ?? "?"} bdd=${stats.Product.beli} | users http=${countsBeli?.users ?? "?"} bdd=${stats.User.beli}`
  );

  // Cas critique #2 : Demo via HTTP doit correspondre aux stats BDD Demo
  const demoMatchesBdd =
    !!countsDemo &&
    countsDemo.products === stats.Product.demo &&
    countsDemo.users === stats.User.demo &&
    countsDemo.orders === stats.Order.demo &&
    countsDemo.companyInfos === stats.CompanyInfo.demo &&
    countsDemo.siteConfigs === stats.SiteConfig.demo;
  record(
    "HTTP Demo — counts == stats BDD Demo",
    demoMatchesBdd,
    `products http=${countsDemo?.products ?? "?"} bdd=${stats.Product.demo} | users http=${countsDemo?.users ?? "?"} bdd=${stats.User.demo}`
  );

  // Cas critique #3 : les deux réponses DOIVENT différer (sinon extension KO)
  const differ =
    !!countsBeli &&
    !!countsDemo &&
    (countsBeli.products !== countsDemo.products ||
      countsBeli.users !== countsDemo.users);
  record(
    "HTTP Beli ≠ HTTP Demo (les 2 hosts renvoient des chiffres distincts)",
    differ,
    `beli.products=${countsBeli?.products} demo.products=${countsDemo?.products}`
  );

  // Cas critique #4 : Demo ne doit PAS voir 500 products (fuite Beli)
  const noBeliLeakInDemo =
    !!countsDemo && countsDemo.products < 10 && countsDemo.users < 5;
  record(
    "HTTP Demo — pas de fuite données Beli (products<10, users<5)",
    noBeliLeakInDemo,
    `demo.products=${countsDemo?.products} demo.users=${countsDemo?.users}`
  );

  // Cas critique #5 : Beli ne doit PAS voir les 3 produits DEMO-* en plus des siens
  const noDemoLeakInBeli =
    !!countsBeli && countsBeli.products === stats.Product.beli;
  record(
    "HTTP Beli — pas de fuite données Demo (products == BDD Beli exact)",
    noDemoLeakInBeli,
    `http.products=${countsBeli?.products} bdd.beli=${stats.Product.beli}`
  );

  // ── Récap ────────────────────────────────────────────────────────────────
  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  console.log(`\n═════════════════════════════════════════════════════════════════`);
  console.log(`Résultat : ${passed}/${results.length} tests OK, ${failed} échec(s)`);
  console.log(`═════════════════════════════════════════════════════════════════`);

  if (failed > 0) {
    console.log("\nÉchecs détaillés :");
    for (const r of results.filter((r) => !r.pass)) {
      console.log(`  ✗ ${r.name} → ${r.detail}`);
    }
  }

  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
