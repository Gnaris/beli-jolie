/**
 * scripts/test-inactivity-warning.ts
 *
 * Script de test rapide pour la désactivation auto :
 *  1. Backdate le user cible pour qu'il soit « inactif depuis 2 ans »
 *     (createdAt + lastOrderAt forcés dans le passé lointain).
 *  2. Clear ses champs de cycle (inactivityWarningAt, deactivatedForInactivityAt,
 *     probationUntil) pour repartir propre.
 *  3. Attend 10 secondes.
 *  4. Déclenche manuellement un tick du worker pour son tenant.
 *     → Le mail d'avertissement part immédiatement.
 *
 * Pré-requis dans l'admin : révocation auto ACTIVÉE + warningDays
 * configuré ≥ 1 jour (sinon le script ne déclenchera rien).
 *
 * Usage :
 *   npx tsx scripts/test-inactivity-warning.ts <email>
 *
 * Exemple :
 *   npx tsx scripts/test-inactivity-warning.ts gnaris88@hotmail.com
 */

import { prisma } from "@/lib/prisma";
import { tenantALS } from "@/lib/tenant-als";
import { notifyClientInactivityWarning } from "@/lib/notifications";

const emailArg = process.argv[2];
if (!emailArg) {
  console.error("❌ Usage : npx tsx scripts/test-inactivity-warning.ts <email>");
  process.exit(1);
}
const email = emailArg.toLowerCase().trim();

async function main() {
  // 1) Trouve le user. Hors ALS tenant, l'extension Prisma est passthrough.
  const user = await prisma.user.findFirst({
    where: { email },
    select: {
      id: true,
      tenantId: true,
      status: true,
      role: true,
      firstName: true,
      lastName: true,
      email: true,
    },
  });

  if (!user) {
    console.error(`❌ Aucun compte trouvé pour l'email : ${email}`);
    process.exit(1);
  }
  if (!user.tenantId) {
    console.error(`❌ Compte sans tenantId — impossible à tester.`);
    process.exit(1);
  }
  if (user.role !== "CLIENT") {
    console.error(`❌ Ce compte n'est pas un CLIENT (role = ${user.role}).`);
    process.exit(1);
  }

  console.log("─────────────────────────────────────────────");
  console.log(`👤 Compte trouvé : ${user.firstName} ${user.lastName} (${user.email})`);
  console.log(`   status actuel : ${user.status}`);
  console.log(`   tenantId      : ${user.tenantId}`);
  console.log("─────────────────────────────────────────────");

  // 2) Backdate — on force une création il y a ~2 ans + clear flags cycle.
  //    On force aussi status APPROVED pour que le worker le prenne.
  const twoYearsAgo = new Date(Date.now() - 730 * 86_400_000);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      status: "APPROVED",
      createdAt: twoYearsAgo,
      inactivityWarningAt: null,
      deactivatedForInactivityAt: null,
      probationUntil: null,
      inactiveClientOptOut: false,
    },
  });
  console.log("✓ Profil backdaté (createdAt = il y a 2 ans) + flags cycle réinitialisés.");
  console.log("✓ Status forcé à APPROVED.");

  // 3) Vérifie la config SiteConfig du tenant pour prévenir si incomplète.
  const configRows = await prisma.siteConfig.findMany({
    where: {
      tenantId: user.tenantId,
      key: {
        in: [
          "inactive_revoke_enabled",
          "inactive_revoke_warning_days",
          "inactive_revoke_grace_days",
        ],
      },
    },
    select: { key: true, value: true },
  });
  const configMap = new Map(configRows.map((r) => [r.key, r.value]));
  const enabled = configMap.get("inactive_revoke_enabled") === "true";
  const warningDays = configMap.get("inactive_revoke_warning_days");
  const graceDays = configMap.get("inactive_revoke_grace_days");

  console.log("─────────────────────────────────────────────");
  console.log(`⚙️  Configuration tenant :`);
  console.log(`   activé           : ${enabled ? "oui" : "NON"}`);
  console.log(`   warning_days     : ${warningDays ?? "(non configuré)"}`);
  console.log(`   grace_days       : ${graceDays ?? "(non configuré)"}`);
  console.log("─────────────────────────────────────────────");

  if (!enabled || !warningDays || !graceDays) {
    console.error("❌ La révocation auto n'est pas pleinement configurée.");
    console.error("   Ouvrez /admin/parametres → Inscription → cochez Activer + renseignez les deux délais.");
    process.exit(1);
  }

  // 4) Attend 10 secondes.
  console.log("⏳ Attente 10 secondes avant déclenchement du worker…");
  for (let i = 10; i > 0; i--) {
    process.stdout.write(`\r   ${i}s…   `);
    await new Promise((r) => setTimeout(r, 1000));
  }
  process.stdout.write("\r             \n");

  // 5) Debug : vérifions que le user matche bien le pré-filtre du worker.
  const warningCutoff = new Date(Date.now() - Number(warningDays) * 86_400_000);
  const match = await prisma.user.findFirst({
    where: {
      id: user.id,
      tenantId: user.tenantId,
      role: "CLIENT",
      status: "APPROVED",
      inactiveClientOptOut: false,
      OR: [
        { createdAt: { lte: warningCutoff } },
        { probationUntil: { not: null } },
      ],
    },
    select: { id: true, createdAt: true, inactivityWarningAt: true },
  });
  console.log(`🔍 Debug — user matche le pré-filtre worker ? ${match ? "oui" : "NON"}`);
  if (match) {
    console.log(`   createdAt=${match.createdAt.toISOString()} (seuil ${warningCutoff.toISOString()})`);
  }

  // 6) Logique inline (shortcut) : on pose directement l'avertissement +
  //    envoie le mail. Permet de court-circuiter le worker complet pour
  //    diagnostiquer facilement.
  console.log("🚀 Envoi direct du mail d'avertissement…");
  const now = new Date();
  try {
    const upd = await prisma.user.updateMany({
      where: {
        id: user.id,
        tenantId: user.tenantId,
      },
      data: { inactivityWarningAt: now },
    });
    console.log(`   update rows: ${upd.count}`);

    await tenantALS.run(user.tenantId, async () => {
      await notifyClientInactivityWarning({
        email: user.email,
        firstName: user.firstName,
        daysInactive: Math.floor(
          (now.getTime() - new Date(Date.now() - 730 * 86_400_000).getTime()) /
            86_400_000,
        ),
        graceDays: Number(graceDays),
      });
    });
    console.log("✓ notifyClientInactivityWarning appelé.");
  } catch (err) {
    console.error("❌ Exception :", err);
  }

  // 6) Vérifie l'état final en BDD.
  const after = await prisma.user.findFirst({
    where: { id: user.id },
    select: {
      status: true,
      inactivityWarningAt: true,
      deactivatedForInactivityAt: true,
    },
  });
  console.log("─────────────────────────────────────────────");
  console.log(`📋 État après tick :`);
  console.log(`   status                     : ${after?.status}`);
  console.log(`   inactivityWarningAt        : ${after?.inactivityWarningAt?.toISOString() ?? "(null)"}`);
  console.log(`   deactivatedForInactivityAt : ${after?.deactivatedForInactivityAt?.toISOString() ?? "(null)"}`);
  console.log("─────────────────────────────────────────────");

  if (after?.inactivityWarningAt) {
    console.log("✅ Mail d'avertissement envoyé — vérifiez votre boîte.");
  } else {
    console.log("⚠️  Rien ne s'est passé. Possibles causes :");
    console.log("    - La fonction d'envoi mail a échoué silencieusement (regardez les logs).");
    console.log("    - La config SMTP du tenant est incomplète.");
  }

  // Important : ferme explicitement Prisma pour que le script quitte sans
  // laisser un pool ouvert (sinon le process reste bloqué 30s).
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("❌ Erreur :", err);
  try {
    await prisma.$disconnect();
  } catch {}
  process.exit(1);
});
