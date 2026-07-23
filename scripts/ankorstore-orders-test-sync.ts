/**
 * Test direct de syncRecentAnkorstoreOrders / importAllAnkorstoreOrdersFor
 * sans passer par la fire-and-forget UI. Aide à isoler si le bug est côté
 * pipeline sync ou côté fire-and-forget.
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { tenantALS } from "@/lib/tenant-als";
import {
  syncRecentAnkorstoreOrders,
  importAllAnkorstoreOrdersFor,
} from "@/lib/ankorstore-orders-sync";

async function main() {
  const tenants = await prisma.tenant.findMany({ where: { isActive: true } });
  const beliJolie = tenants.find((t) => t.slug === "beli-jolie") ?? tenants[0];
  if (!beliJolie) throw new Error("Aucun tenant actif");

  console.log(`[test] Tenant : ${beliJolie.name} (id=${beliJolie.id})`);

  const mode = process.argv[2] === "import" ? "import" : "sync";
  console.log(`[test] Mode : ${mode}\n`);

  await tenantALS.run(beliJolie.id, async () => {
    if (mode === "sync") {
      const t0 = Date.now();
      console.log("[test] Appel syncRecentAnkorstoreOrders...");
      const res = await syncRecentAnkorstoreOrders(beliJolie.id);
      console.log(`[test] Terminé en ${Date.now() - t0}ms`);
      console.log("[test] Résultat :", res);
    } else {
      console.log("[test] Appel importAllAnkorstoreOrdersFor...");
      const res = await importAllAnkorstoreOrdersFor(
        beliJolie.id,
        async (p) => {
          console.log(
            `[progress] page ${p.currentPage} · ${p.processedOrders} traitées · ${p.currentOrders.length} en cours`,
          );
        },
        {
          onEvent: async (e) => {
            const tag =
              e.result === "imported" ? "✓" : e.result === "unchanged" ? "=" : "✗";
            console.log(
              `  ${tag} ${e.reference} · ${e.customerName} · ${e.totalTTC}€${e.errorMessage ? ` — ${e.errorMessage}` : ""}`,
            );
          },
        },
      );
      console.log("[test] Résultat final :", res);
    }
  });
}

main()
  .catch((err) => {
    console.error("[test] ÉCHEC :", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
