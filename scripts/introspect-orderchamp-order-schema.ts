/**
 * One-shot : introspecte les types Order / Address / OrderProduct du schéma
 * Orderchamp pour lister les vrais noms des champs et reconstruire le fragment.
 *
 * Usage :
 *   npx tsx scripts/introspect-orderchamp-order-schema.ts <tenantId>
 */

import { prisma } from "@/lib/prisma";
import { tenantALS } from "@/lib/tenant-als";
import { ORDERCHAMP_BASE_URL, primeOrderchampApiKey } from "@/lib/orderchamp-auth";
import { decryptIfSensitive } from "@/lib/encryption";

const TYPES = ["Customer", "RetailerOrder", "OrderProductConnection", "OrderProductEdge"];

async function loadKey(tenantId: string): Promise<string> {
  const row = await prisma.siteConfig.findFirst({
    where: { tenantId, key: "orderchamp_api_key" },
    select: { value: true },
  });
  if (!row?.value) throw new Error("Pas de clé Orderchamp pour ce tenant");
  return decryptIfSensitive("orderchamp_api_key", row.value);
}

async function introspectType(typeName: string, apiKey: string): Promise<void> {
  const query = `
    query IntrospectType($name: String!) {
      __type(name: $name) {
        name
        fields {
          name
          type { kind name ofType { kind name ofType { kind name } } }
        }
      }
    }
  `;
  const res = await fetch(ORDERCHAMP_BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query, variables: { name: typeName } }),
  });
  const json = (await res.json()) as {
    data?: {
      __type?: {
        name: string;
        fields: {
          name: string;
          type: { kind: string; name: string | null; ofType?: unknown };
        }[];
      } | null;
    };
    errors?: unknown[];
  };
  if (json.errors) {
    console.log(`\n=== ${typeName} ===`);
    console.log("ERRORS:", JSON.stringify(json.errors, null, 2));
    return;
  }
  const t = json.data?.__type;
  if (!t) {
    console.log(`\n=== ${typeName} : introuvable ===`);
    return;
  }
  console.log(`\n=== ${t.name} ===`);
  for (const f of t.fields) {
    const typeStr = describeType(f.type);
    console.log(`  ${f.name.padEnd(28)} ${typeStr}`);
  }
}

function describeType(t: unknown): string {
  const anyT = t as { kind?: string; name?: string | null; ofType?: unknown };
  if (!anyT) return "?";
  if (anyT.name) return `${anyT.kind}:${anyT.name}`;
  if (anyT.ofType) return `${anyT.kind}<${describeType(anyT.ofType)}>`;
  return anyT.kind ?? "?";
}

async function main() {
  const tenantId = process.argv[2];
  if (!tenantId) throw new Error("Usage: <tenantId>");
  const key = await loadKey(tenantId);
  primeOrderchampApiKey(tenantId, key);
  await tenantALS.run(tenantId, async () => {
    for (const t of TYPES) await introspectType(t, key);
  });
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
