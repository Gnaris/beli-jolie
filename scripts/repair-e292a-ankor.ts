/**
 * Répare E292A côté Ankorstore.
 *
 * Constat : le produit AS lié (UUID 1f15389c-2319-6a06-9d8f-268facf92db9) a
 * son `external_id` à null. Notre garde-fou "external_id incohérent" bloque
 * tout push. Il n'existe pas d'endpoint API AS pour juste corriger
 * `external_id` — la seule voie propre est de délier le produit côté BJ et de
 * le republier comme un nouveau produit AS (avec `external_id=E292A` posé
 * correctement à la création).
 *
 * Après ce script :
 *   - Nouveau produit AS créé avec external_id=E292A (nouveau UUID).
 *   - 10 nouvelles variantes AS liées aux 10 couleurs BJ.
 *   - L'ancien produit AS (UUID 1f15389c…) reste orphelin dans le dashboard
 *     Ankorstore. Elle doit le supprimer À LA MAIN (dashboard AS →
 *     rechercher les SKU E292A_NOIR_UNIT_1..._MULTICOLORE_UNIT_10 →
 *     supprimer le produit qui les contient).
 *
 * Usage :
 *   npx tsx scripts/repair-e292a-ankor.ts            (dry-run)
 *   npx tsx scripts/repair-e292a-ankor.ts --apply    (exécute)
 */

import "dotenv/config";
import { Prisma } from "@prisma/client";
import { tenantALS } from "@/lib/tenant-als";
import { prisma } from "@/lib/prisma";
import { buildPublishProductInput } from "@/lib/ankorstore-publish";
import {
  ankorstoreCreateCatalogOperation,
  ankorstoreAddProductsToOperation,
  ankorstoreStartOperation,
} from "@/lib/ankorstore-api-write";
import { persistAnkorstoreOperation } from "@/lib/ankorstore-persist";
import { primeAnkorstoreToken, primeAnkorstoreCredentials } from "@/lib/ankorstore-auth";
import { decryptIfSensitive } from "@/lib/encryption";

const ANKORSTORE_TOKEN_URL = "https://www.ankorstore.com/oauth/token";

async function bootstrapAnkorstoreAuth(tenantId: string): Promise<void> {
  const rows = await prisma.siteConfig.findMany({
    where: { tenantId, key: { in: ["ankors_client_id", "ankors_client_secret"] } },
  });
  const map = new Map(
    rows.map((r) => [r.key, decryptIfSensitive(r.key, r.value)?.trim() ?? null]),
  );
  const clientId = map.get("ankors_client_id");
  const clientSecret = map.get("ankors_client_secret");
  if (!clientId || !clientSecret) throw new Error("Identifiants Ankor absents");
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
  console.log("✓ Token Ankor amorcé");
}

const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(`=== Repair E292A / Ankor — ${APPLY ? "APPLY" : "DRY-RUN"} ===\n`);

  const tenant = await prisma.tenant.findFirst({ where: { slug: "beliandjolie" } });
  if (!tenant) throw new Error("tenant introuvable");

  await tenantALS.run(tenant.id, async () => {
    const p = await prisma.product.findFirst({
      where: { reference: "E292A" },
      include: { colors: { include: { color: true } } },
    });
    if (!p) throw new Error("E292A introuvable");

    console.log(`Produit BJ  : ${p.reference} (${p.name})`);
    console.log(`ID BJ       : ${p.id}`);
    console.log(`Ankor actuel: ${p.ankorsProductId ?? "(déjà délié)"}`);
    const linked = p.colors.filter((c) => c.ankorsVariantId).length;
    console.log(`Variantes AS liées : ${linked}/${p.colors.length}\n`);

    if (!APPLY) {
      console.log("Plan :");
      console.log("  1. UPDATE Product : ankorsProductId=null, ankorsLastSyncSnapshot=null, ankorsSyncRequired=false");
      console.log("  2. UPDATE ProductColor (x10) : ankorsVariantId=null");
      console.log("  3. ankorstoreKickoffPublish(productId) → crée nouveau produit AS + 10 variantes");
      console.log("  4. Callback AS met à jour ankorsProductId + les 10 ankorsVariantId (via webhook)");
      console.log("\n⚠ Après apply, l'ancien produit AS reste orphelin dans le dashboard Ankor.");
      console.log("   La cliente devra le supprimer à la main.");
      console.log("\n=== DRY-RUN — rien n'a été modifié ===");
      return;
    }

    console.log("=== APPLY ===");

    // 1. Unlink DB
    await prisma.$transaction([
      prisma.product.update({
        where: { id: p.id },
        data: {
          ankorsProductId: null,
          ankorsLastSyncSnapshot: Prisma.DbNull,
          ankorsSyncRequired: false,
        },
      }),
      prisma.productColor.updateMany({
        where: { productId: p.id },
        data: { ankorsVariantId: null },
      }),
    ]);
    console.log("✓ Ankor unlink DB fait (produit + 10 variantes)");

    // 2. Amorce token OAuth (killswitch de kickoffPublish bypasse par ce chemin)
    await bootstrapAnkorstoreAuth(tenant.id);

    // 3. Build payload publish
    const built = await buildPublishProductInput(p.id);
    if (!built.ok) {
      console.error(`✗ Build payload échoué : ${built.error}`);
      process.exit(1);
    }
    console.log("✓ Payload construit");

    // 4. Créer op catalog "import" + ajouter produit + persister PENDING + start
    const { operationId } = await ankorstoreCreateCatalogOperation("import");
    console.log(`✓ Opération catalog créée — operationId=${operationId}`);
    const addResp = await ankorstoreAddProductsToOperation(operationId, [built.input]);
    if (addResp.totalProductsCount === 0) {
      console.error("✗ Ankor a rejeté le produit silencieusement");
      process.exit(1);
    }
    console.log(`✓ Produit ajouté à l'op (${addResp.totalProductsCount})`);

    await persistAnkorstoreOperation({
      id: operationId,
      productId: p.id,
      type: "PUBLISH",
      payload: built.payload as unknown as Prisma.InputJsonValue,
      context: "Ankorstore Publish (script)",
    });
    console.log("✓ Op persistée en BDD (PENDING)");

    await ankorstoreStartOperation(operationId);
    console.log(`✓ Op démarrée`);

    console.log("");
    console.log("⏳ Ankor traite en async. Callback attendu dans quelques minutes.");
    console.log(`   Suivre : mysql beliandjolie -e "SELECT status FROM AnkorstoreOperation WHERE id='${operationId}';"`);
  });

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
