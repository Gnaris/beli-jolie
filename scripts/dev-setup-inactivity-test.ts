/**
 * Prépare un environnement local pour tester la relance inactivité.
 *
 * 1. Supprime tous les clients du tenant `beliandjolie` SAUF
 *    `borischen91@gmail.com`. Nettoie commandes / paniers / favoris / conv /
 *    réclamations / avoirs / logs auth. Préserve les admins et Issyma.
 * 2. Réinitialise les stades inactivité : wipe les stades existants + crée
 *    3 nouveaux stades (5 min / 10 min / 15 min) avec les designs par défaut
 *    différenciés (`inactiveClientStageDefault(1/2/3)`).
 * 3. Active l'automation (SiteConfig `inactive_client_automation_enabled`).
 *
 * Sécurité : refuse de tourner si DATABASE_URL ne pointe pas sur localhost.
 *
 * Usage :
 *   npx tsx scripts/dev-setup-inactivity-test.ts --go
 */
import { PrismaClient } from "@prisma/client";
import { inactiveClientStageDefault } from "@/lib/mail-scenario-defaults";

const prisma = new PrismaClient();

const url = process.env.DATABASE_URL ?? "";
if (!/@localhost|@127\.0\.0\.1/.test(url)) {
  console.error(`Refus : DATABASE_URL n'est pas local (${url.replace(/:[^@]+@/, ":***@")}).`);
  process.exit(1);
}
if (!process.argv.includes("--go")) {
  console.error("Passe --go pour exécuter (aucun dry-run pour ce script).");
  process.exit(1);
}

const TENANT_SLUG = "beliandjolie";
const KEEP_EMAIL = "borischen91@gmail.com";

async function main() {
  const tenant = await prisma.tenant.findFirst({
    where: { slug: TENANT_SLUG },
    select: { id: true, name: true },
  });
  if (!tenant) throw new Error(`Tenant ${TENANT_SLUG} introuvable en local.`);
  console.log(`\n═══ Tenant ${tenant.name} (${tenant.id}) ═══\n`);

  // ─── 1. Trouve les clients à supprimer ────────────────────────────────
  const toDelete = await prisma.user.findMany({
    where: {
      tenantId: tenant.id,
      role: "CLIENT",
      email: { not: KEEP_EMAIL },
    },
    select: { id: true, email: true },
  });
  console.log(`Clients à supprimer : ${toDelete.length}`);
  if (toDelete.length > 0) {
    console.log(`  (${toDelete.slice(0, 5).map((u) => u.email).join(", ")}${toDelete.length > 5 ? " …" : ""})`);
  }
  const ids = toDelete.map((u) => u.id);

  if (ids.length > 0) {
    // Marketplace orders liées aux Order de la boutique (via FK userId sur Order).
    // On supprime uniquement les orders qui appartiennent aux users ciblés.
    console.log("\n  → Suppression commandes/paniers/favoris…");
    await prisma.promotionUsage.deleteMany({ where: { userId: { in: ids } } });
    await prisma.stockMovement.updateMany({
      where: { order: { userId: { in: ids } } },
      data: { orderId: null },
    });
    await prisma.orderItemModification.deleteMany({
      where: { order: { userId: { in: ids } } },
    });
    await prisma.orderItem.deleteMany({
      where: { order: { userId: { in: ids } } },
    });
    await prisma.order.deleteMany({ where: { userId: { in: ids } } });

    await prisma.claim.deleteMany({ where: { userId: { in: ids } } });
    await prisma.creditUsage.deleteMany({
      where: { credit: { userId: { in: ids } } },
    });
    await prisma.credit.deleteMany({ where: { userId: { in: ids } } });

    await prisma.messageAttachment.deleteMany({
      where: { message: { conversation: { userId: { in: ids } } } },
    });
    await prisma.message.deleteMany({
      where: { conversation: { userId: { in: ids } } },
    });
    await prisma.conversation.deleteMany({ where: { userId: { in: ids } } });

    await prisma.favorite.deleteMany({ where: { userId: { in: ids } } });
    await prisma.cartItem.deleteMany({ where: { cart: { userId: { in: ids } } } });
    await prisma.cart.deleteMany({ where: { userId: { in: ids } } });
    await prisma.shippingAddress.deleteMany({ where: { userId: { in: ids } } });

    // Tables auth : indexées par `email` (pas `userId`).
    const emails = toDelete.map((u) => u.email);
    await prisma.loginAttempt.deleteMany({ where: { email: { in: emails } } });
    await prisma.loginOtp.deleteMany({ where: { email: { in: emails } } });
    await prisma.accountLockout.deleteMany({ where: { email: { in: emails } } });
    await prisma.passwordResetToken.deleteMany({ where: { email: { in: emails } } });
    // RegistrationLog n'a pas de userId ni email fiable → laissé tel quel.

    // Jobs marketing liés
    await prisma.abandonedCartJob.deleteMany({ where: { userId: { in: ids } } });
    await prisma.inactiveClientJob.deleteMany({ where: { userId: { in: ids } } });

    // Emails envoyés (userId nullable → SetNull, mais on peut aussi nettoyer)
    await prisma.emailSend.updateMany({
      where: { userId: { in: ids } },
      data: { userId: null },
    });

    const del = await prisma.user.deleteMany({ where: { id: { in: ids } } });
    console.log(`  ✓ ${del.count} clients supprimés`);
  }

  const kept = await prisma.user.findFirst({
    where: { tenantId: tenant.id, email: KEEP_EMAIL },
    select: { id: true, email: true, status: true },
  });
  console.log(
    kept
      ? `  ✓ Client préservé : ${kept.email} (status ${kept.status})`
      : `  ⚠ ATTENTION : ${KEEP_EMAIL} INTROUVABLE sur le tenant — vérifiez que le compte existe.`,
  );

  // ─── 2. Reset stades inactivité ───────────────────────────────────────
  console.log("\n  → Reset des stades inactivité…");
  const existing = await prisma.inactiveClientStage.findMany({
    where: { tenantId: tenant.id },
    select: { id: true, templateId: true },
  });
  if (existing.length > 0) {
    await prisma.inactiveClientStage.deleteMany({
      where: { tenantId: tenant.id },
    });
    await prisma.newsletterTemplate.deleteMany({
      where: { id: { in: existing.map((s) => s.templateId) } },
    });
    console.log(`  ✓ ${existing.length} stades existants supprimés`);
  }
  // Clean the scenarioKey slot on any orphan INACTIVE_CLIENT template pointer.
  await prisma.newsletterTemplate.deleteMany({
    where: { tenantId: tenant.id, scenarioKey: "INACTIVE_CLIENT" },
  });

  // ─── 3. Crée 3 stades (5 min / 10 min / 15 min) avec designs différents ─
  const delays = [5 * 60, 10 * 60, 15 * 60];
  for (let i = 0; i < 3; i++) {
    const stageIndex = i + 1;
    const def = inactiveClientStageDefault(stageIndex);
    const template = await prisma.newsletterTemplate.create({
      data: {
        tenantId: tenant.id,
        name: def.name,
        subject: def.subject,
        blocks: def.blocks as unknown as object,
        // Stage 1 porte le scenarioKey officiel, 2 et 3 restent null (comme le
        // panier abandonné). Le pointer scenarioKey ne sert que pour la tuile
        // « Voir la page dédiée » côté /admin/marketing/mails.
        scenarioKey: stageIndex === 1 ? "INACTIVE_CLIENT" : null,
      },
    });
    await prisma.inactiveClientStage.create({
      data: {
        tenantId: tenant.id,
        stageIndex,
        delaySeconds: delays[i],
        templateId: template.id,
      },
    });
    console.log(
      `  ✓ Stade ${stageIndex} créé : ${Math.floor(delays[i] / 60)} min, sujet « ${def.subject} »`,
    );
  }

  // ─── 4. Active l'automation ───────────────────────────────────────────
  await prisma.siteConfig.upsert({
    where: {
      tenantId_key: { tenantId: tenant.id, key: "inactive_client_automation_enabled" },
    },
    create: {
      tenantId: tenant.id,
      key: "inactive_client_automation_enabled",
      value: "true",
    },
    update: { value: "true" },
  });
  console.log("  ✓ Automation activée (SiteConfig inactive_client_automation_enabled=true)");

  console.log("\n═══ Terminé ═══");
  console.log("Le worker inactivité tourne toutes les 10 minutes.");
  console.log(`Le premier mail partira dès que ${KEEP_EMAIL} sera resté 5 min sans visite du site.`);
}

main()
  .catch((err) => {
    console.error("\n❌ Erreur :", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
