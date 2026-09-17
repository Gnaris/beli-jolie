/**
 * Seed un faux avis client APPROVED sur le tenant ISSYMA — usage local
 * uniquement (aperçu / démo de la section « Paroles de boutiques » sur la
 * page d'accueil Issyma).
 *
 * Le script est idempotent : ré-exécuter ne crée pas de doublon, il met à
 * jour l'avis existant. On utilise un email dédié `avis-demo@issyma.local`
 * pour bien isoler ce compte des vrais clients.
 *
 * Usage : `npx tsx scripts/seed-issyma-fake-review.ts`
 *   options optionnelles :
 *     --clean    Supprime l'avis démo et le user associé (nettoyage)
 *
 * Ne PAS lancer en prod : cet avis est purement décoratif pour l'aperçu
 * local de la refonte visuelle du 2026-09-17.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// Cible privilégiée : le tenant `issyma` (prod). En local, ce tenant
// n'existe pas — la cliente prévisualise le layout Issyma via le
// HomeLayoutDevSwitcher sur son tenant local (`beli-jolie`). Le script
// détecte automatiquement quel tenant utiliser dans l'ordre suivant :
//   1. Flag CLI `--tenant=<slug>`
//   2. Slug "issyma" si présent en BDD
//   3. Slug "beli-jolie" (fallback local)
//   4. Premier tenant trouvé
const PREFERRED_TENANT_SLUG = "issyma";
const LOCAL_FALLBACK_TENANT_SLUG = "beli-jolie";
const DEMO_EMAIL = "avis-demo@issyma.local";
const DEMO_FIRSTNAME = "Sophie";
const DEMO_LASTNAME = "Lambert"; // → « Sophie L. » via formatReviewerName
const DEMO_COMPANY = "Boutique Éclat";
const DEMO_PHONE = "0000000000";
const DEMO_REVIEW_TEXT =
  "Une sélection tendance renouvelée régulièrement et un service irréprochable. Mes clientes adorent, mes commandes arrivent toujours en 48 h.";
const DEMO_REVIEW_RATING = 5;

async function resolveTenant() {
  // 1. Flag CLI explicite
  const flag = process.argv.find((a) => a.startsWith("--tenant="));
  if (flag) {
    const slug = flag.slice("--tenant=".length);
    const t = await prisma.tenant.findUnique({ where: { slug }, select: { id: true, name: true, slug: true } });
    if (!t) {
      console.error(`[seed-issyma-fake-review] Tenant "--tenant=${slug}" introuvable.`);
      process.exit(1);
    }
    return t;
  }
  // 2. Tenant Issyma s'il existe (prod)
  const issyma = await prisma.tenant.findUnique({
    where: { slug: PREFERRED_TENANT_SLUG },
    select: { id: true, name: true, slug: true },
  });
  if (issyma) return issyma;
  // 3. Fallback local beli-jolie
  const local = await prisma.tenant.findUnique({
    where: { slug: LOCAL_FALLBACK_TENANT_SLUG },
    select: { id: true, name: true, slug: true },
  });
  if (local) return local;
  // 4. Ultime : premier tenant venu
  const any = await prisma.tenant.findFirst({ select: { id: true, name: true, slug: true } });
  return any;
}

async function main() {
  const clean = process.argv.includes("--clean");

  const tenant = await resolveTenant();
  if (!tenant) {
    console.error("[seed-issyma-fake-review] Aucun tenant dans la BDD. Rien à faire.");
    process.exit(1);
  }
  console.log(`[seed-issyma-fake-review] Tenant cible : ${tenant.name} (${tenant.slug})`);

  if (clean) {
    const user = await prisma.user.findFirst({
      where: { tenantId: tenant.id, email: DEMO_EMAIL },
      select: { id: true },
    });
    if (!user) {
      console.log("[seed-issyma-fake-review] Aucun compte démo à supprimer.");
      return;
    }
    await prisma.customerReview.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
    console.log(`[seed-issyma-fake-review] Avis + compte démo supprimés (tenant ${tenant.name}).`);
    return;
  }

  // 1. Upsert du user démo (email unique par tenant).
  const existing = await prisma.user.findFirst({
    where: { tenantId: tenant.id, email: DEMO_EMAIL },
    select: { id: true },
  });

  let userId: string;
  if (existing) {
    userId = existing.id;
    // Garantir l'état APPROVED / role CLIENT même si quelqu'un a rétrogradé.
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        firstName: DEMO_FIRSTNAME,
        lastName: DEMO_LASTNAME,
        company: DEMO_COMPANY,
        role: "CLIENT",
        status: "APPROVED",
      },
    });
    console.log(`[seed-issyma-fake-review] Compte démo existant réutilisé (${DEMO_EMAIL}).`);
  } else {
    const hashedPassword = await bcrypt.hash("demo-review-not-loginable", 12);
    const created = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: DEMO_EMAIL,
        password: hashedPassword,
        firstName: DEMO_FIRSTNAME,
        lastName: DEMO_LASTNAME,
        company: DEMO_COMPANY,
        phone: DEMO_PHONE,
        role: "CLIENT",
        status: "APPROVED",
      },
      select: { id: true },
    });
    userId = created.id;
    console.log(`[seed-issyma-fake-review] Compte démo créé (${DEMO_EMAIL}).`);
  }

  // 2. Upsert de l'avis APPROVED lié à ce user (userId @unique).
  const now = new Date();
  const existingReview = await prisma.customerReview.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (existingReview) {
    await prisma.customerReview.update({
      where: { id: existingReview.id },
      data: {
        rating: DEMO_REVIEW_RATING,
        text: DEMO_REVIEW_TEXT,
        status: "APPROVED",
        moderatedAt: now,
      },
    });
    console.log("[seed-issyma-fake-review] Avis démo mis à jour (APPROVED).");
  } else {
    await prisma.customerReview.create({
      data: {
        tenantId: tenant.id,
        userId,
        rating: DEMO_REVIEW_RATING,
        text: DEMO_REVIEW_TEXT,
        status: "APPROVED",
        moderatedAt: now,
      },
    });
    console.log("[seed-issyma-fake-review] Avis démo créé (APPROVED).");
  }

  console.log(
    "[seed-issyma-fake-review] Terminé. Rechargez la home Issyma en local (localhost:3000) pour voir la section « Paroles de boutiques ».",
  );
}

main()
  .catch((e) => {
    console.error("[seed-issyma-fake-review] Erreur :", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
