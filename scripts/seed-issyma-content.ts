/**
 * Seed les textes visibles côté visiteurs pour le tenant ISSYMA :
 *   - Hero de la page d'accueil (surtitre, titre, description, bouton 2)
 *   - Baseline SEO (title <title>)
 *   - Accroche courte en haut du catalogue
 *
 * Ces textes vivent dans SiteConfig (scopés par tenant) et écrasent les
 * valeurs génériques i18n. On les édite via /admin/parametres > Contenus,
 * ou via ce script pour un premier remplissage.
 *
 * Usage : `npx tsx scripts/seed-issyma-content.ts`
 * (Aucun effet si le tenant "issyma" n'existe pas.)
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ISSYMA_TENANT_SLUG = "issyma";

const CONFIG: Record<string, string> = {
  home_hero_eyebrow: "Grossiste en prêt-à-porter féminin B2B · CIFA Aubervilliers",
  home_hero_title_line1: "Des produits tendance",
  home_hero_title_line2: "pour votre boutique",
  home_hero_description:
    "Plus de 600 références disponibles pour les boutiques et revendeurs professionnels. Nouveautés régulières, tarifs grossiste et livraison en France et en Europe.",
  home_hero_cta_secondary_label: "Créer un compte professionnel",
  home_hero_cta_secondary_href: "/inscription",

  seo_tagline: "Grossiste en prêt-à-porter féminin B2B",

  produits_seo_intro:
    "Découvrez plus de 600 références de prêt-à-porter féminin réservées aux boutiques et revendeurs professionnels. Créez votre compte pour accéder aux tarifs grossiste.",
};

async function main() {
  const tenant = await prisma.tenant.findUnique({
    where: { slug: ISSYMA_TENANT_SLUG },
    select: { id: true, name: true },
  });

  if (!tenant) {
    console.error(`[seed-issyma-content] Tenant "${ISSYMA_TENANT_SLUG}" introuvable. Rien à faire.`);
    process.exit(1);
  }

  console.log(`[seed-issyma-content] Tenant ${tenant.name} (${tenant.id})`);
  for (const [key, value] of Object.entries(CONFIG)) {
    await prisma.siteConfig.upsert({
      where: { tenantId_key: { tenantId: tenant.id, key } },
      update: { value },
      create: { tenantId: tenant.id, key, value },
    });
    console.log(`  ✔ ${key}`);
  }
  console.log("[seed-issyma-content] Terminé. Pensez à vider le cache si vous avez déjà chargé le site (redémarrez `npm run dev` si besoin).");
}

main()
  .catch((e) => {
    console.error("[seed-issyma-content] Erreur :", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
