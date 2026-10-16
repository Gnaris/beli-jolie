/**
 * Lit les 3 clés Stripe en BDD pour chaque tenant et affiche leur préfixe
 * (sk_live / sk_test / pk_live / pk_test / whsec_live / whsec_test) + les
 * 10 premiers caractères, pour détecter si les clés sont réellement en test.
 *
 * Usage : npx tsx scripts/check-stripe-config.ts
 */
import { PrismaClient } from "@prisma/client";
import { decryptIfSensitive } from "../lib/encryption";

const prisma = new PrismaClient();

const KEYS = ["stripe_secret_key", "stripe_publishable_key", "stripe_webhook_secret"] as const;

function describe(raw: string | null): string {
  if (!raw) return "— (absent)";
  const t = raw.trim();
  if (!t) return "— (vide)";
  const prefix = t.slice(0, 10);
  if (t.startsWith("sk_test_")) return `TEST  (${prefix}…)`;
  if (t.startsWith("sk_live_")) return `LIVE  ⚠️  (${prefix}…)`;
  if (t.startsWith("pk_test_")) return `TEST  (${prefix}…)`;
  if (t.startsWith("pk_live_")) return `LIVE  ⚠️  (${prefix}…)`;
  if (t.startsWith("whsec_"))   return `whsec (${prefix}…)`;
  return `??? préfixe inconnu (${prefix}…)`;
}

async function main() {
  const tenants = await prisma.tenant.findMany({
    select: { id: true, slug: true, name: true },
    orderBy: { slug: "asc" },
  });
  for (const t of tenants) {
    const rows = await prisma.siteConfig.findMany({
      where: { tenantId: t.id, key: { in: [...KEYS] } },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    console.log(`\n━━━ Tenant ${t.slug} (${t.name}) ━━━`);
    for (const k of KEYS) {
      const raw = map.get(k) ?? null;
      let decrypted: string | null = null;
      try {
        decrypted = raw ? decryptIfSensitive(k, raw) : null;
      } catch (err) {
        console.log(`  ${k.padEnd(26)} ⚠️  decrypt échoué : ${(err as Error).message}`);
        continue;
      }
      console.log(`  ${k.padEnd(26)} ${describe(decrypted)}`);
    }
  }
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
