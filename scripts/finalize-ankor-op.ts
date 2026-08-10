/**
 * Force la finalize d'une AnkorstoreOperation PENDING dont le webhook a
 * échoué à trouver la ligne (op créée par un script avec tenantId=null).
 * Le tenantId doit avoir été patché en BDD avant d'appeler ce script.
 */

import "dotenv/config";
import { tenantALS } from "@/lib/tenant-als";
import { prisma } from "@/lib/prisma";
import { ankorstoreFinalizePublish } from "@/lib/ankorstore-publish";
import { primeAnkorstoreToken, primeAnkorstoreCredentials } from "@/lib/ankorstore-auth";
import { decryptIfSensitive } from "@/lib/encryption";

const OP_ID = process.argv[2];
if (!OP_ID) {
  console.error("Usage: finalize-ankor-op.ts <operationId>");
  process.exit(1);
}

async function bootstrapAuth(tenantId: string) {
  const rows = await prisma.siteConfig.findMany({
    where: { tenantId, key: { in: ["ankors_client_id", "ankors_client_secret"] } },
  });
  const map = new Map(rows.map((r) => [r.key, decryptIfSensitive(r.key, r.value)?.trim() ?? null]));
  const clientId = map.get("ankors_client_id");
  const clientSecret = map.get("ankors_client_secret");
  if (!clientId || !clientSecret) throw new Error("no ankor credentials");
  primeAnkorstoreCredentials(clientId, clientSecret);
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "*",
  });
  const res = await fetch("https://www.ankorstore.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  });
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("no token");
  primeAnkorstoreToken(data.access_token, data.expires_in ?? 3600);
}

async function main() {
  const op = await prisma.ankorstoreOperation.findFirst({ where: { id: OP_ID } });
  if (!op) throw new Error(`op ${OP_ID} introuvable`);
  if (!op.tenantId) throw new Error(`op ${OP_ID} sans tenantId — patch-la d'abord en BDD`);
  console.log(`Op trouvée : ${op.id} status=${op.status} type=${op.type} tenantId=${op.tenantId}`);
  await tenantALS.run(op.tenantId, async () => {
    await bootstrapAuth(op.tenantId!);
    console.log("Token amorcé, appel finalize…");
    // Fake callback payload "succeeded" (le vrai a été perdu au webhook)
    const fakePayload = {
      data: { attributes: { status: "succeeded", operationType: op.type.toLowerCase() } },
    };
    await ankorstoreFinalizePublish(op as any, fakePayload);
  });
  const final = await prisma.ankorstoreOperation.findFirst({ where: { id: OP_ID } });
  console.log(`Statut final : ${final?.status}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
