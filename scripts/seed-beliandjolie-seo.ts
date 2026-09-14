/**
 * Seed les 4 textes SEO principaux pour le tenant BELIANDJOLIE :
 *   - seo_tagline         (baseline courte affichée dans <title> et Google)
 *   - home_seo_text       (paragraphe long en bas de la page d'accueil)
 *   - produits_seo_intro  (accroche courte au-dessus des filtres /produits)
 *   - produits_seo_text   (paragraphe long en bas de /produits)
 *
 * Contenu validé par la cliente le 2026-09-14 — orienté « grossiste bijoux
 * acier inoxydable 304 & fantaisie femme, Aubervilliers, 10 000 références,
 * livraison monde ». Sourcing tendances Instagram/TikTok/Pinterest.
 *
 * Usage : `npx tsx scripts/seed-beliandjolie-seo.ts`
 * (Aucun effet si le tenant "beliandjolie" n'existe pas.)
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const BJ_TENANT_SLUG = "beliandjolie";

const TAGLINE = "Grossiste bijoux acier inoxydable 304 & fantaisie — Aubervilliers";

const HOME_TEXT = `Beli & Jolie, grossiste français en bijoux fantaisie femme installé à Aubervilliers, accompagne les boutiques indépendantes, corners, créatrices, e-shops et revendeurs professionnels qui cherchent un fournisseur fiable, réactif et toujours en phase avec les tendances repérées sur les réseaux sociaux.

Notre spécialité : le bijou en acier inoxydable 304, de qualité chirurgicale — hypoallergénique, sans nickel libre, inaltérable, résistant à l'eau, à la sueur, aux parfums et au temps. C'est la matière qui rassure vos clientes finales, qui explique le taux de retour proche de zéro et qui fait la réputation de nos best-sellers. Nous travaillons également le laiton doré et argenté pour les pièces plus habillées, ainsi que l'émail, la résine, les pierres naturelles et le zircon pour la touche tendance qui déclenche la vente en boutique.

Avec plus de 10 000 références en stock permanent, notre catalogue couvre tous les besoins de votre linéaire bijou : classiques essentiels (bagues, colliers, sautoirs, bracelets, boucles d'oreilles créoles et pendantes) et pièces plus pointues qu'on ne trouve pas ailleurs (chaînes de taille, chaînes de corps, bagues d'orteil, broches, chaînes de cheville, sets et coffrets prêts à revendre). Nous suivons chaque jour les tendances Instagram, TikTok et Pinterest pour intégrer au catalogue les pièces qui vont marcher — pas celles qui ont déjà saturé le marché.

Notre showroom se trouve au 90 rue de la Haie Coq, 93300 Aubervilliers, au cœur du plus grand quartier de grossistes d'Île-de-France. Les acheteuses professionnelles y sont accueillies sur rendez-vous pour voir, toucher et sélectionner les pièces avant commande. Pour les autres, tout se pilote en ligne, avec un service client francophone joignable par chat, par ticket support ou par WhatsApp au 06 26 82 48 58 — réponse rapide pendant les horaires d'ouverture.

Grâce au contrat négocié avec notre transitaire principal, les frais de livraison restent parmi les plus compétitifs du marché, et l'expédition part sous 24 à 48 h ouvrées depuis notre entrepôt d'Aubervilliers. Nous livrons dans toute la France métropolitaine, en Belgique, en Suisse, dans les DOM-TOM et à l'international — chaque recoin du globe, tout est possible.

L'accès aux tarifs de gros est réservé aux professionnels titulaires d'un SIRET. Création de compte gratuite, validation sous 24 h, puis accès complet : prix dégressifs, stock temps réel, réassort en un clic, favoris, historique de commandes et alertes de retour en stock.`;

const PRODUITS_INTRO = `Plus de 10 000 références de bijoux fantaisie femme en stock à Aubervilliers : bagues, colliers, bracelets, boucles d'oreilles, chaînes de taille, chaînes de corps, bagues d'orteil, broches. Notre spécialité : l'acier inoxydable 304 chirurgical, hypoallergénique et durable, plus le laiton doré et argenté. Catalogue réservé aux pros — créez votre compte pour voir les tarifs.`;

const PRODUITS_TEXT = `Notre catalogue rassemble plus de 10 000 références de bijoux fantaisie femme, sélectionnées et stockées dans notre entrepôt d'Aubervilliers pour couvrir aussi bien les essentiels indémodables que les pièces plus originales qui font sortir votre boutique du lot.

Côté classiques : bagues fines et bagues d'ensemble, colliers ras-de-cou et sautoirs à superposer, bracelets thaïlandais et joncs émaillés, créoles de toutes tailles, boucles d'oreilles pendantes ou puces, sets assortis prêts à revendre. Côté pièces différenciantes : chaînes de taille, chaînes de corps, bagues d'orteil, broches, chaînes de cheville et bijoux de plage — la catégorie qui explose sur Instagram et TikTok depuis deux saisons et qui manque cruellement dans la plupart des catalogues grossistes.

Notre spécialité reste l'acier inoxydable 304 de qualité chirurgicale : hypoallergénique, sans nickel libre, résistant à l'eau, à la sueur, aux parfums et au temps. C'est la matière qui rassure vos clientes finales et qui fait chuter les retours SAV côté boutique. Nous travaillons aussi le laiton doré et argenté pour les pièces plus habillées, l'émail, la résine, le zircon et la pierre naturelle pour les collections plus créatives.

Le sourcing est piloté par les tendances repérées sur les réseaux sociaux : nos équipes suivent chaque jour Instagram, TikTok et Pinterest pour anticiper ce qui va se vendre en vitrine dans les prochaines semaines. Les nouveautés rejoignent le catalogue en continu — pas à date fixe, dès que la tendance émerge.

Toutes les fiches produit affichent le stock temps réel, la référence, les variantes de couleur et de taille, la matière (acier inoxydable 304, laiton doré, argenté, résine, émail, pierre naturelle) et le prix de gros dégressif. Les commandes passées avant 14 h partent le jour même depuis Aubervilliers, les autres sous 48 h ouvrées maximum. Grâce à notre contrat transitaire, les frais de port sont plus compétitifs que la moyenne du marché, et nous livrons dans le monde entier — France métropolitaine, DOM-TOM, Europe, Amérique, Asie, Afrique, Océanie.

Une question avant de commander ? Le service client répond par chat en ligne, par ticket support ou par WhatsApp au 06 26 82 48 58 pendant les horaires d'ouverture. Vous préférez venir voir sur place ? Le showroom d'Aubervilliers, au 90 rue de la Haie Coq (93300), accueille les acheteuses professionnelles sur rendez-vous — au cœur du plus grand quartier grossiste d'Île-de-France.`;

const CONFIG: Record<string, string> = {
  seo_tagline: TAGLINE,
  home_seo_text: HOME_TEXT,
  produits_seo_intro: PRODUITS_INTRO,
  produits_seo_text: PRODUITS_TEXT,
};

async function main() {
  const tenant = await prisma.tenant.findUnique({
    where: { slug: BJ_TENANT_SLUG },
    select: { id: true, name: true },
  });

  if (!tenant) {
    console.error(`[seed-beliandjolie-seo] Tenant "${BJ_TENANT_SLUG}" introuvable. Rien à faire.`);
    process.exit(1);
  }

  console.log(`[seed-beliandjolie-seo] Tenant ${tenant.name} (${tenant.id})`);
  for (const [key, value] of Object.entries(CONFIG)) {
    await prisma.siteConfig.upsert({
      where: { tenantId_key: { tenantId: tenant.id, key } },
      update: { value },
      create: { tenantId: tenant.id, key, value },
    });
    console.log(`  ✔ ${key}  (${value.length} caractères)`);
  }
  console.log("[seed-beliandjolie-seo] Terminé. Cache SiteConfig ~5 min — redémarrez `npm run dev` pour un effet immédiat, ou attendez le TTL.");
}

main()
  .catch((e) => {
    console.error("[seed-beliandjolie-seo] Erreur :", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
