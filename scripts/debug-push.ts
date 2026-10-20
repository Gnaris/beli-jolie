/**
 * Diagnostic one-shot pour les notifications push PWA.
 *
 * Usage :
 *   npx tsx scripts/debug-push.ts
 *
 * Vérifie :
 *   1. La table `PushSubscription` existe-t-elle ?
 *   2. Combien d'abonnements enregistrés, par tenant, par utilisateur ?
 *   3. Les clés VAPID sont-elles bien dans l'env ?
 *   4. Essai d'envoi d'un push test à CHAQUE abonnement — avec le code
 *      d'erreur réel du service push (410 = endpoint mort, 404 = pareil,
 *      401/403 = clés VAPID invalides, 200 = tout va bien).
 */

/* eslint-disable no-console */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("\n═══ Diagnostic notifications push ═══\n");

  // 1. ENV vars
  console.log("── 1) Variables d'environnement ───────────────────────");
  const vpub = process.env.VAPID_PUBLIC_KEY;
  const vpriv = process.env.VAPID_PRIVATE_KEY;
  const vsub = process.env.VAPID_SUBJECT;
  console.log(`  VAPID_PUBLIC_KEY  : ${vpub ? "OK (" + vpub.length + " chars)" : "❌ MANQUANT"}`);
  console.log(`  VAPID_PRIVATE_KEY : ${vpriv ? "OK (" + vpriv.length + " chars)" : "❌ MANQUANT"}`);
  console.log(`  VAPID_SUBJECT     : ${vsub ?? "❌ MANQUANT"}`);
  console.log(`  NEXT_PUBLIC_VAPID : ${process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ? "OK" : "❌ MANQUANT"}`);

  // 2. Table exists?
  console.log("\n── 2) Table PushSubscription ──────────────────────────");
  let total = 0;
  try {
    total = await prisma.pushSubscription.count();
    console.log(`  Table OK — ${total} abonnement${total > 1 ? "s" : ""} enregistré${total > 1 ? "s" : ""}`);
  } catch (err) {
    console.log("  ❌ Table introuvable ou BDD inaccessible :", (err as Error).message);
    console.log("  → Lancez `npx prisma db push` pour créer la table.");
    await prisma.$disconnect();
    process.exit(1);
  }

  if (total === 0) {
    console.log("\n⚠️  Aucun abonnement en base. Causes possibles :");
    console.log("    - L'activation sur l'iPhone a échoué (regardez la console browser)");
    console.log("    - Le service worker ne s'est pas enregistré");
    console.log("    - L'appel subscribeToPush() a renvoyé une erreur silencieuse");
    await prisma.$disconnect();
    return;
  }

  // 3. List subscriptions with context
  console.log("\n── 3) Détail des abonnements ──────────────────────────");
  const subs = await prisma.pushSubscription.findMany({
    include: {
      user: { select: { email: true, role: true, firstName: true, lastName: true } },
      tenant: { select: { slug: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  for (const s of subs) {
    console.log(`  • ID         : ${s.id}`);
    console.log(`    User       : ${s.user.email} (${s.user.role}) — ${s.user.firstName} ${s.user.lastName}`);
    console.log(`    Tenant     : ${s.tenant?.slug ?? "⚠️ aucun"} (${s.tenant?.name ?? "—"})`);
    console.log(`    Label      : ${s.label ?? "—"}`);
    console.log(`    UA         : ${(s.userAgent ?? "").slice(0, 80)}`);
    console.log(`    Endpoint   : ${s.endpoint.slice(0, 70)}…`);
    console.log(`    Créé       : ${s.createdAt.toISOString()}`);
    console.log(`    Dernier use: ${s.lastUsedAt.toISOString()}`);
    console.log("");
  }

  // 4. Test send to each endpoint
  console.log("── 4) Envoi test à chaque abonnement ──────────────────");
  if (!vpub || !vpriv) {
    console.log("  Clés VAPID manquantes — envoi impossible.");
    await prisma.$disconnect();
    return;
  }

  // web-push est CommonJS → les fonctions sont sous `.default` en ESM.
  const mod = await import("web-push");
  const webpush = ((mod as unknown as { default?: typeof mod }).default ?? mod) as {
    setVapidDetails: (s: string, p: string, k: string) => void;
    sendNotification: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, body: string, opts?: { TTL?: number }) => Promise<unknown>;
  };
  webpush.setVapidDetails(vsub ?? "mailto:test@example.com", vpub, vpriv);

  for (const s of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: s.endpoint,
          keys: { p256dh: s.p256dh, auth: s.authKey },
        },
        JSON.stringify({
          title: "Test diagnostic",
          body: "Si vous voyez ce message, les push fonctionnent !",
          url: "/admin",
          tag: "debug-test",
        }),
        { TTL: 60 },
      );
      console.log(`  ✅ ${s.id} (${s.user.email}) — envoi OK`);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; body?: string; message?: string };
      console.log(`  ❌ ${s.id} (${s.user.email}) — HTTP ${e.statusCode ?? "?"} : ${e.body ?? e.message}`);
      if (e.statusCode === 410 || e.statusCode === 404) {
        console.log(`     → endpoint mort, à supprimer. ID : ${s.id}`);
      }
    }
  }

  // 5. List tenants + admins (pour cross-ref)
  console.log("\n── 5) Admins par tenant ───────────────────────────────");
  const tenants = await prisma.tenant.findMany({
    select: { id: true, slug: true, name: true },
  });
  for (const t of tenants) {
    const admins = await prisma.user.findMany({
      where: { tenantId: t.id, role: "ADMIN" },
      select: { email: true },
    });
    console.log(`  ${t.slug} (${t.name}) : ${admins.length} admin(s) → ${admins.map((a) => a.email).join(", ")}`);
  }

  console.log("\n═══ Fin du diagnostic ═══\n");
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Erreur fatale :", err);
  await prisma.$disconnect();
  process.exit(1);
});
