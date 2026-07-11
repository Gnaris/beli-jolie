/**
 * Test d'isolation des écritures multi-tenant.
 *
 * Vérifie que l'extension `tenantScopeExtension` :
 *   1. Injecte le bon tenantId sur `create` (contexte requête Beli & Jolie vs Demo)
 *   2. Injecte le bon tenantId sur `createMany`
 *   3. Isole les rows sur `upsert` (même reference dans 2 tenants → 2 rows si scope permet)
 *   4. Refuse l'`update` cross-tenant (throw)
 *   5. Refuse le `delete` cross-tenant (throw)
 *
 * Usage :
 *   npx tsx scripts/dev/test-write-isolation.ts
 *
 * Nettoyage : les produits WRITE-TEST-* sont supprimés en fin de test via
 *   MULTI_TENANT_SCOPE=off (le script tourne hors contexte requête donc bypass natif).
 */

import * as http from "node:http";

const HOST_IP = "127.0.0.1";
const PORT = 3000;
const BELI_HOST = "beliandjolie.com";
const DEMO_HOST = "demo.beliandjolie.com";
const BELI_TENANT = "cmrgfr0380000ikm3d0a94n6z";
const DEMO_TENANT = "cmrgiq09s000011sdxr81wn2l";

type Json = Record<string, unknown>;

/**
 * On utilise `http.request` bas niveau car `fetch()` (undici) écrase le header
 * Host avec l'URL de destination et empêche donc de simuler un tenant via Host.
 */
async function api(
  method: "POST" | "PATCH" | "DELETE",
  host: string,
  body: Json
): Promise<{ status: number; json: Json }> {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: HOST_IP,
        port: PORT,
        path: "/api/dev/tenant-write-test",
        method,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          Host: host,
        },
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
    req.write(payload);
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
  // On récupère une categoryId par un import direct (script CLI = bypass scope, on voit tout).
  const { prisma } = await import("../../lib/prisma");
  const category = await prisma.category.findFirst({ select: { id: true } });
  if (!category) throw new Error("Aucune catégorie en BDD, impossible de créer un produit test.");
  const categoryId = category.id;

  const ts = Date.now();
  const refBeli = `WRITE-TEST-BELI-${ts}`;
  const refDemo = `WRITE-TEST-DEMO-${ts}`;
  const refUpsert = `WRITE-TEST-UPSERT-${ts}`;
  const refsMany = [
    `WRITE-TEST-MANY-A-${ts}`,
    `WRITE-TEST-MANY-B-${ts}`,
    `WRITE-TEST-MANY-C-${ts}`,
  ];

  // ── 1. Create Beli ────────────────────────────────────────────────────────
  const c1 = await api("POST", BELI_HOST, { op: "create", reference: refBeli, categoryId });
  const p1 = c1.json.product as { id: string; tenantId: string } | undefined;
  record(
    "create via Host=beliandjolie.com → tenantId = beli",
    !!p1 && p1.tenantId === BELI_TENANT,
    `status=${c1.status} tenantId=${p1?.tenantId ?? "?"}`
  );

  // ── 2. Create Demo ────────────────────────────────────────────────────────
  const c2 = await api("POST", DEMO_HOST, { op: "create", reference: refDemo, categoryId });
  const p2 = c2.json.product as { id: string; tenantId: string } | undefined;
  record(
    "create via Host=demo.beliandjolie.com → tenantId = demo",
    !!p2 && p2.tenantId === DEMO_TENANT,
    `status=${c2.status} tenantId=${p2?.tenantId ?? "?"}`
  );

  // ── 3. createMany Beli (3 lignes en une requête) ─────────────────────────
  const cm = await api("POST", BELI_HOST, {
    op: "createMany",
    references: refsMany,
    categoryId,
  });
  const many = (cm.json.products as Array<{ tenantId: string }>) ?? [];
  const allBeli = many.length === 3 && many.every((p) => p.tenantId === BELI_TENANT);
  record(
    "createMany via Host=beli → 3 rows toutes tagguées beli",
    allBeli,
    `count=${cm.json.count} tenantIds=${JSON.stringify(many.map((p) => p.tenantId))}`
  );

  // ── 4. Upsert : même reference dans les 2 tenants ────────────────────────
  // Note : Product.reference est @unique GLOBAL, donc un upsert avec la même
  // référence dans le 2e tenant tombera sur la row existante et sera bloqué
  // par le check post-hoc de l'extension (le tenantId de la row ne correspond
  // pas au tenant courant). C'est le comportement attendu : la clé unique
  // globale empêche le doublon, mais aucune donnée du tenant A n'est écrite
  // au nom du tenant B (le upsert échoue proprement).
  const u1 = await api("POST", BELI_HOST, { op: "upsert", reference: refUpsert, categoryId });
  const u1p = u1.json.product as { tenantId: string } | undefined;
  record(
    "upsert Beli (création initiale) → tenantId = beli",
    !!u1p && u1p.tenantId === BELI_TENANT,
    `tenantId=${u1p?.tenantId ?? "?"}`
  );
  const u2 = await api("POST", DEMO_HOST, { op: "upsert", reference: refUpsert, categoryId });
  const u2Blocked = u2.status === 500 || (u2.json.ok === false);
  record(
    "upsert Demo sur même reference → refusé (unique global + guard tenant)",
    u2Blocked,
    `status=${u2.status} error=${String(u2.json.error).slice(0, 120)}`
  );

  // ── 5. Update cross-tenant : Beli tente de patcher le produit Demo ──────
  const patchCross = await api("PATCH", BELI_HOST, {
    productId: p2?.id,
    data: { name: "HIJACKED" },
  });
  const patchBlocked = patchCross.json.ok === false;
  record(
    "PATCH Beli sur produit Demo → doit ÉCHOUER (cross-tenant refusé)",
    patchBlocked,
    `status=${patchCross.status} error=${String(patchCross.json.error).slice(0, 120)}`
  );

  // Vérif BDD directe : le nom n'a pas été modifié.
  const stillDemo = await prisma.product.findUnique({
    where: { id: p2!.id },
    select: { name: true, tenantId: true },
  });
  record(
    "→ vérif BDD : nom du produit Demo intact",
    stillDemo?.name !== "HIJACKED" && stillDemo?.tenantId === DEMO_TENANT,
    `name=${stillDemo?.name} tenantId=${stillDemo?.tenantId}`
  );

  // ── 6. Delete cross-tenant : Beli tente de supprimer le produit Demo ───
  const delCross = await api("DELETE", BELI_HOST, { productId: p2?.id });
  const delBlocked = delCross.json.ok === false;
  record(
    "DELETE Beli sur produit Demo → doit ÉCHOUER (cross-tenant refusé)",
    delBlocked,
    `status=${delCross.status} error=${String(delCross.json.error).slice(0, 120)}`
  );

  // Vérif BDD : le produit Demo existe toujours.
  const stillAlive = await prisma.product.findUnique({
    where: { id: p2!.id },
    select: { id: true, tenantId: true },
  });
  record(
    "→ vérif BDD : produit Demo toujours présent",
    !!stillAlive && stillAlive.tenantId === DEMO_TENANT,
    `id=${stillAlive?.id ?? "supprimé"}`
  );

  // ── 7. Nettoyage (script CLI = bypass tenantScope, on peut tout supprimer) ─
  const allRefs = [refBeli, refDemo, refUpsert, ...refsMany];
  const cleanup = await prisma.product.deleteMany({
    where: { reference: { in: allRefs } },
  });
  console.log(`\n[cleanup] ${cleanup.count} produit(s) WRITE-TEST-* supprimé(s).`);

  // ── Récap ────────────────────────────────────────────────────────────────
  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  console.log(`\n════════════════════════════════════════`);
  console.log(`Résultat : ${passed}/${results.length} tests OK, ${failed} échec(s)`);
  console.log(`════════════════════════════════════════`);

  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
