/**
 * 1) Tente de poser external_id="A1720" sur le produit Ankor lié à A1720 BJ.
 * 2) Vérifie via GET.
 * 3) Si OK, kickoff sync BJ→Ankor pour pousser la couleur Bleu ajoutée.
 *
 * À exécuter sur le VPS pour que les callbacks Ankor arrivent bien.
 */

import "dotenv/config";
import { tenantALS } from "@/lib/tenant-als";
import { prisma } from "@/lib/prisma";
import { decryptIfSensitive } from "@/lib/encryption";
import {
  primeAnkorstoreCredentials,
  primeAnkorstoreToken,
} from "@/lib/ankorstore-auth";
import { ankorstoreKickoffUpdate } from "@/lib/ankorstore-update";

const UUID = "1f06faba-2a4f-6c7c-ad07-024ba929e6ad";
const REF = "A1720";

async function bootstrap(tenantId: string): Promise<string> {
  const rows = await prisma.siteConfig.findMany({
    where: { tenantId, key: { in: ["ankors_client_id", "ankors_client_secret"] } },
  });
  const m = new Map(rows.map((r) => [r.key, decryptIfSensitive(r.key, r.value)?.trim() ?? null]));
  const clientId = m.get("ankors_client_id")!;
  const clientSecret = m.get("ankors_client_secret")!;
  primeAnkorstoreCredentials(clientId, clientSecret);
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "*",
  });
  const r = await fetch("https://www.ankorstore.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  });
  const j = (await r.json()) as { access_token: string; expires_in: number };
  primeAnkorstoreToken(j.access_token, j.expires_in);
  return j.access_token;
}

async function getExternalId(token: string): Promise<string | null> {
  const r = await fetch(`https://www.ankorstore.com/api/v1/products/${UUID}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.api+json" },
  });
  const j = (await r.json()) as any;
  return j.data?.attributes?.externalId ?? j.data?.attributes?.external_id ?? null;
}

async function tryPatch(token: string, fieldName: "external_id" | "externalId"): Promise<{ ok: boolean; status: number; body: string }> {
  const r = await fetch(`https://www.ankorstore.com/api/v1/products/${UUID}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.api+json",
      "Content-Type": "application/vnd.api+json",
    },
    body: JSON.stringify({
      data: {
        type: "products",
        id: UUID,
        attributes: { [fieldName]: REF },
      },
    }),
  });
  const t = await r.text();
  return { ok: r.ok, status: r.status, body: t.substring(0, 800) };
}

async function main() {
  const t = await prisma.tenant.findFirst({ where: { slug: "beliandjolie" } });
  if (!t) throw new Error("no tenant");
  const token = await bootstrap(t.id);
  console.log("✓ Auth OK");

  console.log("\n[Avant] external_id =", await getExternalId(token));

  console.log("\n--- Essai 1 : PATCH avec attribute 'external_id' ---");
  const a = await tryPatch(token, "external_id");
  console.log("status:", a.status, "\nbody:", a.body);

  console.log("\n[Après essai 1] external_id =", await getExternalId(token));

  if ((await getExternalId(token)) !== REF) {
    console.log("\n--- Essai 2 : PATCH avec attribute 'externalId' (camelCase) ---");
    const b = await tryPatch(token, "externalId");
    console.log("status:", b.status, "\nbody:", b.body);
    console.log("\n[Après essai 2] external_id =", await getExternalId(token));
  }

  const finalExt = await getExternalId(token);
  if (finalExt !== REF) {
    console.log(`\n❌ Impossible de poser external_id via PATCH direct. Reste : ${JSON.stringify(finalExt)}`);
    console.log("On arrête ici (on ne veut pas risquer un doublon).");
    return;
  }
  console.log(`\n✅ external_id = "${REF}" posé côté Ankorstore.`);

  console.log("\n--- Kickoff sync BJ→Ankor pour pousser les variantes ---");
  await tenantALS.run(t.id, async () => {
    const bjProduct = await prisma.product.findFirst({
      where: { reference: REF, tenantId: t.id },
      select: { id: true },
    });
    if (!bjProduct) throw new Error("A1720 introuvable en BDD BJ");
    const res = await ankorstoreKickoffUpdate(bjProduct.id, { forceFullSync: true });
    console.log("kickoff result:", JSON.stringify(res, null, 2));
  });
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
