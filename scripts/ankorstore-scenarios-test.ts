/**
 * Test bout-en-bout de tous les scénarios que la cliente veut valider.
 *
 * On appelle les VRAIES server actions utilisées par l'UI (bypass le worker
 * background qui ne recharge pas les fixes en dev). Après chaque modification,
 * on relit le produit chez Ankor via readProductById pour valider le résultat.
 *
 * Usage : npx tsx scripts/ankorstore-scenarios-test.ts
 */

// L'extension tenantScope essaie d'injecter tenantId dans les mutations dès que l'ALS
// est populée — ce qui rentre en conflit avec les `tenant: { connect }` explicites qu'on
// utilise dans le script. On désactive l'extension pour les writes de setup.
process.env.MULTI_TENANT_SCOPE = "off";

import { prisma } from "@/lib/prisma";
import { tenantALS } from "@/lib/tenant-als";
import { readProductByIdWithRetry } from "@/lib/ankorstore-bo";

const REFERENCE = "PRODUCTTESTANKORSTORE";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

function line(title: string) {
  console.log("\n" + "─".repeat(72));
  console.log("  " + title);
  console.log("─".repeat(72));
}
function ok(msg: string) { console.log("  ✅ " + msg); }
function ko(msg: string) { console.log("  ❌ " + msg); }
function info(msg: string) { console.log("  ℹ️  " + msg); }
async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function reloadAnkorProduct(ankorId: number) {
  await sleep(2000); // laisser index Ankor rafraîchir
  return readProductByIdWithRetry(ankorId, { attempts: 4, delayMs: 1500 });
}

async function publish(productId: string): Promise<{ ok: boolean; error?: string; ankorId?: number }> {
  const { publishProductToAnkorstoreBo } = await import(
    "@/app/actions/admin/ankorstore-bo"
  );
  const res = await publishProductToAnkorstoreBo(productId);
  return { ok: res.success, error: res.error, ankorId: res.ankorProductId };
}

async function main() {
  const p = await prisma.product.findFirst({
    where: { reference: REFERENCE },
    select: {
      id: true, tenantId: true, ankorsProductId: true,
      colors: {
        where: { saleType: "UNIT" },
        select: { id: true, color: { select: { name: true } } },
      },
    },
  });
  if (!p) throw new Error(`Produit ${REFERENCE} introuvable — lance d'abord ankorstore-test-e2e-publish.ts`);
  const productId = p.id;

  await tenantALS.run(p.tenantId, async () => {
    const results: Array<{ scenario: string; passed: boolean; detail?: string }> = [];

    // ─── Scénario 1 : PUBLISH initial (assurer lien) ───────────────────────
    line("Scénario 1 — Publish initial pour s'assurer d'un lien à jour");
    let ankorId = p.ankorsProductId && /^\d+$/.test(p.ankorsProductId)
      ? Number(p.ankorsProductId)
      : null;
    if (!ankorId) {
      const r = await publish(productId);
      if (!r.ok) {
        ko(`Publish initial échoué : ${r.error}`);
        results.push({ scenario: "Publish initial", passed: false, detail: r.error });
        return;
      }
      ankorId = r.ankorId!;
    } else {
      info(`Produit déjà lié à Ankor #${ankorId}`);
    }
    ok(`Ankor productId : ${ankorId}`);
    results.push({ scenario: "Publish initial", passed: true });

    // ─── Scénario 2 : Modifier le nom BJ, push, vérifier ─────────────────
    line("Scénario 2 — Modifier le nom");
    const newName = "Produit test modifié " + new Date().toISOString().slice(11, 19);
    await prisma.product.update({ where: { id: productId }, data: { name: newName } });
    info(`nouveau nom BJ : "${newName}"`);
    const r2 = await publish(productId);
    if (!r2.ok) {
      ko(`push échoué : ${r2.error}`);
      results.push({ scenario: "Modif nom", passed: false, detail: r2.error });
    } else {
      const ankor = await reloadAnkorProduct(ankorId);
      if (ankor?.name === newName) {
        ok(`nom Ankor correspond : "${ankor.name}"`);
        results.push({ scenario: "Modif nom", passed: true });
      } else {
        ko(`nom Ankor DIFFÉRENT : reçu "${ankor?.name}" attendu "${newName}"`);
        results.push({ scenario: "Modif nom", passed: false, detail: `Ankor.name = ${ankor?.name}` });
      }
    }

    // ─── Scénario 3 : Modifier description ─────────────────────────────────
    line("Scénario 3 — Modifier la description");
    const newDesc = "Description modifiée à " + new Date().toISOString();
    await prisma.product.update({ where: { id: productId }, data: { description: newDesc } });
    info("nouvelle description enregistrée en base");
    const r3 = await publish(productId);
    if (!r3.ok) {
      ko(`push échoué : ${r3.error}`);
      results.push({ scenario: "Modif description", passed: false, detail: r3.error });
    } else {
      const ankor = await reloadAnkorProduct(ankorId) as unknown as Any;
      const gotDesc = ankor?.description ?? "";
      if (gotDesc.includes("Description modifiée à")) {
        ok(`description Ankor mise à jour`);
        results.push({ scenario: "Modif description", passed: true });
      } else {
        ko(`description Ankor DIFFÉRENTE : "${gotDesc.slice(0, 80)}"`);
        results.push({ scenario: "Modif description", passed: false, detail: `Ankor.description = ${gotDesc.slice(0, 60)}` });
      }
    }

    // ─── Scénario 4 : Modifier composition ─────────────────────────────────
    line("Scénario 4 — Modifier la composition matière");
    // Trouve ou crée une Composition "Coton test"
    let compo = await prisma.composition.findFirst({
      where: { tenantId: p.tenantId, name: "Coton test" }, select: { id: true },
    });
    if (!compo) {
      compo = await prisma.composition.create({
        data: { name: "Coton test" } as Any,
        select: { id: true },
      });
    }
    // Efface les anciennes compos et attache la nouvelle (via SQL raw pour bypass la contrainte tenantId)
    await prisma.productComposition.deleteMany({ where: { productId } });
    await prisma.$executeRaw`
      INSERT INTO ProductComposition (id, tenantId, productId, compositionId, percentage)
      VALUES (${"cmp_" + Date.now()}, ${p.tenantId}, ${productId}, ${compo.id}, 100)
    `;
    info("composition BJ : 100% Coton test");
    const r4 = await publish(productId);
    if (!r4.ok) {
      ko(`push échoué : ${r4.error}`);
      results.push({ scenario: "Modif composition", passed: false, detail: r4.error });
    } else {
      const ankor = await reloadAnkorProduct(ankorId) as unknown as Any;
      const compoProp = (ankor?.properties ?? []).find((p: Any) => p.key === "fashion_composition");
      const compoValue = compoProp?.value ?? "";
      if (compoValue.includes("100% Coton test")) {
        ok(`composition Ankor correcte : "${compoValue}"`);
        results.push({ scenario: "Modif composition", passed: true });
      } else {
        ko(`composition Ankor DIFFÉRENTE : "${compoValue}"`);
        results.push({ scenario: "Modif composition", passed: false, detail: `Ankor.composition = ${compoValue}` });
      }
    }

    // ─── Scénario 5 : Modifier pays d'origine ──────────────────────────────
    line("Scénario 5 — Modifier le pays d'origine (CN → IT)");
    await prisma.product.update({ where: { id: productId }, data: { countryIsoCode: "IT" } });
    info("pays BJ : IT (Italie)");
    const r5 = await publish(productId);
    if (!r5.ok) {
      ko(`push échoué : ${r5.error}`);
      results.push({ scenario: "Modif pays", passed: false, detail: r5.error });
    } else {
      const ankor = await reloadAnkorProduct(ankorId);
      const iso = ankor?.made_in?.iso_code;
      if (iso === "IT") {
        ok(`pays Ankor correct : ${iso}`);
        results.push({ scenario: "Modif pays", passed: true });
      } else {
        ko(`pays Ankor DIFFÉRENT : ${iso}`);
        results.push({ scenario: "Modif pays", passed: false, detail: `Ankor.made_in.iso_code = ${iso}` });
      }
    }

    // ─── Scénario 6 : OFFLINE → doit disable chez Ankor ─────────────────────
    line("Scénario 6 — BJ → OFFLINE, doit être Désactivé chez Ankor");
    await prisma.product.update({ where: { id: productId }, data: { status: "OFFLINE" } });
    info("statut BJ : OFFLINE");
    const r6 = await publish(productId);
    if (!r6.ok) {
      ko(`push échoué : ${r6.error}`);
      results.push({ scenario: "OFFLINE→disable Ankor", passed: false, detail: r6.error });
    } else {
      const ankor = await reloadAnkorProduct(ankorId);
      if (ankor?.active === false) {
        ok("produit désactivé côté Ankor ✓");
        results.push({ scenario: "OFFLINE→disable Ankor", passed: true });
      } else {
        ko(`produit toujours actif chez Ankor (active=${ankor?.active})`);
        results.push({ scenario: "OFFLINE→disable Ankor", passed: false, detail: `Ankor.active = ${ankor?.active}` });
      }
    }

    // ─── Scénario 7 : ONLINE → doit enable chez Ankor ──────────────────────
    line("Scénario 7 — BJ → ONLINE, doit être Actif chez Ankor");
    await prisma.product.update({ where: { id: productId }, data: { status: "ONLINE" } });
    info("statut BJ : ONLINE");
    const r7 = await publish(productId);
    if (!r7.ok) {
      ko(`push échoué : ${r7.error}`);
      results.push({ scenario: "ONLINE→enable Ankor", passed: false, detail: r7.error });
    } else {
      const ankor = await reloadAnkorProduct(ankorId);
      if (ankor?.active === true) {
        ok("produit actif côté Ankor ✓");
        results.push({ scenario: "ONLINE→enable Ankor", passed: true });
      } else {
        ko(`produit toujours inactif chez Ankor (active=${ankor?.active})`);
        results.push({ scenario: "ONLINE→enable Ankor", passed: false, detail: `Ankor.active = ${ankor?.active}` });
      }
    }

    // ─── Bilan ─────────────────────────────────────────────────────────────
    console.log("\n" + "═".repeat(72));
    console.log("  BILAN DES TESTS");
    console.log("═".repeat(72));
    for (const r of results) {
      const icon = r.passed ? "✅" : "❌";
      console.log(`  ${icon}  ${r.scenario}${r.detail && !r.passed ? "  — " + r.detail : ""}`);
    }
    const passed = results.filter((r) => r.passed).length;
    console.log(`\n  ${passed}/${results.length} scénarios OK`);
    if (passed < results.length) process.exitCode = 1;
  });
}

main()
  .catch((err) => {
    console.error("\n❌ Exception :", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
