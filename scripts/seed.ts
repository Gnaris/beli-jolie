import { PrismaClient, SaleType } from "@prisma/client";

const prisma = new PrismaClient();

// ─── Données de référence ───────────────────────────────────────────────────

const CATEGORIES = [
  { name: "Colliers", slug: "colliers" },
  { name: "Bracelets", slug: "bracelets" },
  { name: "Bagues", slug: "bagues" },
  { name: "Boucles d'oreilles", slug: "boucles-oreilles" },
  { name: "Pendentifs", slug: "pendentifs" },
  { name: "Chevillères", slug: "chevilieres" },
  { name: "Parures", slug: "parures" },
  { name: "Montres", slug: "montres" },
  { name: "Accessoires", slug: "accessoires" },
];

const SUBCATEGORIES: Record<string, string[]> = {
  Colliers: ["Sautoir", "Ras-de-cou", "Choker", "Chaîne fine", "Collier pendentif", "Collier perles", "Multi-rangs"],
  Bracelets: ["Jonc", "Manchette", "Chaîne", "Charm", "Bangle", "Tennisette", "Gourmette"],
  Bagues: ["Solitaire", "Alliance", "Bague multi-pierres", "Chevalière", "Anneau", "Bague réglable", "Bague empilable"],
  "Boucles d'oreilles": ["Puce", "Créole", "Pendant", "Dormeuse", "Ear cuff", "Chandelier", "Clip"],
  Pendentifs: ["Médaille", "Croix", "Étoile", "Cœur", "Animal", "Géométrique", "Lettre"],
  Chevillères: ["Chaîne cheville", "Bracelet de cheville perles", "Charm cheville"],
  Parures: ["Parure 2 pièces", "Parure 3 pièces", "Parure 4 pièces", "Coffret cadeau"],
  Montres: ["Montre classique", "Montre sportive", "Montre fashion", "Montre connectée"],
  Accessoires: ["Épingle à cheveux", "Headband", "Broche", "Porte-clés", "Piercing"],
};

const COLORS = [
  { name: "Argent", hex: "#C0C0C0" },
  { name: "Or", hex: "#FFD700" },
  { name: "Or Rose", hex: "#E8A598" },
  { name: "Noir", hex: "#1A1A1A" },
  { name: "Or Blanc", hex: "#F5F5DC" },
  { name: "Bronze", hex: "#CD7F32" },
  { name: "Cuivre", hex: "#B87333" },
  { name: "Doré Champagne", hex: "#F7E7CE" },
  { name: "Acier", hex: "#708090" },
  { name: "Gunmetal", hex: "#2C3539" },
  { name: "Or Vieilli", hex: "#CFB53B" },
  { name: "Argenté Mat", hex: "#A8A9AD" },
  { name: "Doré Mat", hex: "#C5A028" },
  { name: "Bicolore Argent/Or", hex: "#D4AF37" },
  { name: "Multicolore", hex: "#FF6B9D" },
  { name: "Transparent/Cristal", hex: "#E8F4FD" },
];

const COMPOSITIONS = [
  "Matière première A",
  "Matière première B",
  "Matière première C",
  "Matière première D",
  "Laiton plaqué or",
  "Laiton plaqué argent",
  "Alliage de zinc",
  "Titane",
];

// ─── Templates de noms par catégorie ────────────────────────────────────────

const NAME_TEMPLATES: Record<string, { prefixes: string[]; styles: string[]; suffixes: string[] }> = {
  Colliers: {
    prefixes: ["Collier", "Sautoir", "Ras-de-cou", "Choker", "Collier long", "Collier fin"],
    styles: ["Étoile", "Perle", "Chaîne", "Fleur", "Lune", "Infini", "Serpent", "Vintage", "Bohème", "Élégant", "Minimaliste", "Tendance", "Délicat", "Raffiné", "Moderne", "Romantique", "Chic", "Classique", "Nature", "Géométrique"],
    suffixes: ["doré", "argenté", "fin", "délicat", "orné", "simple", "élégant", "fleuri", "lacé", "tressé"],
  },
  Bracelets: {
    prefixes: ["Bracelet", "Jonc", "Manchette", "Bracelet jonc", "Bracelet charm", "Bracelet chaîne"],
    styles: ["Perle", "Charm", "Étoile", "Cœur", "Fleur", "Vintage", "Bohème", "Tennis", "Infini", "Lune", "Tressé", "Lacé", "Doré", "Fin", "Large", "Délicat", "Brillant", "Mat", "Texturé", "Gravé"],
    suffixes: ["ajustable", "rigide", "souple", "empilable", "réglable", "ouvert", "fermé", "oxydé", "martelé", "lisse"],
  },
  Bagues: {
    prefixes: ["Bague", "Alliance", "Chevalière", "Anneau", "Solitaire", "Bague empilable"],
    styles: ["Solitaire", "Multi-pierres", "Fleur", "Étoile", "Serpent", "Torsade", "Vintage", "Minimaliste", "Art Déco", "Bohème", "Géométrique", "Nature", "Gravée", "Sertie", "Ajourée", "Martelée", "Lisse", "Texturée", "Ouverte", "Double"],
    suffixes: ["réglable", "large", "fine", "ouverte", "fermée", "empilable", "sertie", "gravée", "polie", "brossée"],
  },
  "Boucles d'oreilles": {
    prefixes: ["Boucles d'oreilles", "Créoles", "Puces", "Pendants", "Ear cuff", "Dormeuses"],
    styles: ["Perle", "Fleur", "Étoile", "Cœur", "Lune", "Plume", "Cercle", "Triangle", "Goutte", "Losange", "Vintage", "Bohème", "Minimaliste", "Géométrique", "Nature", "Art Déco", "Moderne", "Classique", "Tendance", "Chic"],
    suffixes: ["pendantes", "courtes", "longues", "légères", "ajourées", "pleines", "martelées", "lisses", "texturées", "ornées"],
  },
  Pendentifs: {
    prefixes: ["Pendentif", "Médaille", "Charm", "Breloque", "Pendentif motif"],
    styles: ["Croix", "Étoile", "Cœur", "Lune", "Soleil", "Fleur", "Plume", "Ancre", "Infini", "Papillon", "Trèfle", "Hirondelle", "Arbre", "Clé", "Couronne", "Bouddha", "Om", "Mandala", "Lotus", "Rose"],
    suffixes: ["gravé", "ajouré", "émaillé", "serti", "poli", "brossé", "nacré", "texturé", "délicat", "orné"],
  },
  Chevillères: {
    prefixes: ["Chevillère", "Bracelet de cheville", "Chaîne de cheville", "Chevillère charm"],
    styles: ["Perle", "Charm", "Étoile", "Cœur", "Fleur", "Bohème", "Vintage", "Minimaliste", "Délicat", "Fin", "Tressé", "Lacé", "Brillant", "Mat", "Coloré", "Simple", "Orné", "Réglable", "Tissé", "Câblé"],
    suffixes: ["ajustable", "réglable", "fin", "délicat", "orné", "simple", "bohème", "estival", "léger", "coloré"],
  },
  Parures: {
    prefixes: ["Parure", "Set produits", "Ensemble produits", "Coffret parure"],
    styles: ["Élégante", "Romantique", "Vintage", "Bohème", "Classique", "Moderne", "Art Déco", "Minimaliste", "Luxe", "Mariage", "Soirée", "Nature", "Floral", "Géométrique", "Perle", "Cristal", "Dorée", "Argentée", "Rosée", "Nuptiale"],
    suffixes: ["complète", "assortie", "harmonieuse", "raffinée", "précieuse", "délicate", "éclatante", "sobre", "tendance", "intemporelle"],
  },
  Montres: {
    prefixes: ["Montre", "Montre bracelet", "Montre femme", "Montre fashion"],
    styles: ["Classique", "Sportive", "Élégante", "Vintage", "Minimaliste", "Bohème", "Art Déco", "Moderne", "Tendance", "Chic", "Raffinée", "Simple", "Ornée", "Bicolore", "Cadran rond", "Cadran carré", "Ultra-fine", "Luxe", "Casual", "Rétro"],
    suffixes: ["dorée", "argentée", "rosée", "noire", "dorée mat", "chromée", "bicolore", "satinée", "polie", "brossée"],
  },
  Accessoires: {
    prefixes: ["Épingle", "Headband", "Broche", "Porte-clés", "Piercing", "Accessoire"],
    styles: ["Fleur", "Étoile", "Cœur", "Papillon", "Perle", "Cristal", "Vintage", "Bohème", "Géométrique", "Nature", "Art Déco", "Minimaliste", "Tendance", "Chic", "Délicat", "Orné", "Doré", "Argenté", "Coloré", "Fantaisie"],
    suffixes: ["doré", "argenté", "émaillé", "orné", "délicat", "tendance", "chic", "fantaisie", "brillant", "mat"],
  },
};

const DESCRIPTIONS: Record<string, string[]> = {
  Colliers: [
    "Un collier élégant qui sublimera toutes vos tenues du quotidien. Finition soignée, résistant à l'usure.",
    "Collier fin et délicat, idéal pour un port en superposition ou seul. Convient à toutes les occasions.",
    "Ce collier tendance allie modernité et élégance pour un résultat raffiné. Fermeture mousqueton sécurisée.",
    "Magnifique collier travaillé avec soin, parfait pour offrir ou se faire plaisir. Qualité premium.",
    "Collier au design intemporel qui s'adapte à tous les styles. Chaîne fine et solide.",
  ],
  Bracelets: [
    "Bracelet au design épuré et moderne, parfait pour toutes les occasions. Très confortable à porter.",
    "Ce bracelet élégant s'adapte à tous les poignets grâce à son système réglable. Finition impeccable.",
    "Bracelet tendance qui se porte seul ou en superposition. Idéal pour créer un look bohème chic.",
    "Un bracelet délicat et raffiné, parfait en cadeau ou pour se faire plaisir. Qualité supérieure.",
    "Bracelet au style vintage revisité, pour un look à la fois rétro et moderne. Matériaux durables.",
  ],
  Bagues: [
    "Bague au design contemporain, parfaite pour toutes les morphologies. S'adapte facilement au doigt.",
    "Cette bague élégante et raffinée sera l'accessoire idéal pour compléter votre look. Finition polie.",
    "Bague tendance au style minimaliste, à porter seule ou empilée avec d'autres. Confort optimal.",
    "Magnifique bague au design intemporel, parfaite pour une occasion spéciale ou au quotidien.",
    "Bague au look glamour et sophistiqué. Conception soignée pour un port confortable toute la journée.",
  ],
  "Boucles d'oreilles": [
    "Boucles d'oreilles légères et élégantes, idéales pour un port quotidien. Design raffiné.",
    "Ces boucles d'oreilles tendance apporteront une touche de sophistication à toutes vos tenues.",
    "Boucles d'oreilles au style bohème chic, parfaites pour les occasions décontractées ou habillées.",
    "Des boucles d'oreilles délicates et féminines, à offrir ou à s'offrir. Système de fermeture sécurisé.",
    "Boucles d'oreilles au design géométrique moderne, pour un look affirmé et tendance.",
  ],
  Pendentifs: [
    "Pendentif au symbolisme fort, idéal à porter seul sur une chaîne fine. Finition soignée.",
    "Ce pendentif délicat et charmant sera l'accessoire parfait pour personnaliser votre collier préféré.",
    "Pendentif au design raffiné, parfait pour créer une composition unique. Détails travaillés à la main.",
    "Un pendentif tendance et polyvalent, à associer avec vos chaînes et colliers préférés.",
    "Pendentif au style vintage inspiré du design classique. Pièce intemporelle et élégante.",
  ],
  Chevillères: [
    "Chevillère légère et délicate, parfaite pour la plage ou les journées estivales. Design bohème.",
    "Cette chevillère tendance s'adapte à toutes les chaussures. Fermeture réglable pour un confort optimal.",
    "Chevillère au style bohème chic, idéale pour la belle saison. Résistante à l'eau et à la transpiration.",
    "Chevillère fine et élégante pour sublimer vos chevilles. Chaîne solide et durable.",
    "Un accessoire de cheville délicat pour affirmer votre style estival. Convient à toutes les morphologies.",
  ],
  Parures: [
    "Parure complète et harmonieuse pour un look élégant et coordonné. Idéale pour les grandes occasions.",
    "Cette parure raffinée est le cadeau idéal pour une occasion spéciale. Présentation en coffret élégant.",
    "Parure au design classique et intemporel, parfaite pour les mariages et soirées habillées.",
    "Un ensemble coordonné pour sublimer votre tenue. Pièces assorties et complémentaires.",
    "Parure élégante et moderne, pour un look sophistiqué et harmonieux.",
  ],
  Montres: [
    "Montre élégante et fonctionnelle, idéale pour toutes les occasions. Mécanisme précis et fiable.",
    "Cette montre fashion allie style et praticité pour un résultat sophistiqué. Résistante à l'eau.",
    "Montre au design intemporel et classique, qui s'adapte à toutes les tenues et occasions.",
    "Une montre tendance et moderne pour marquer les moments importants de votre journée.",
    "Montre au style raffiné et contemporain, parfaite pour compléter un look chic et professionnel.",
  ],
  Accessoires: [
    "Accessoire tendance et polyvalent, idéal pour personnaliser et enrichir vos tenues du quotidien.",
    "Un accessoire délicat et raffiné pour ajouter une touche de fantaisie à votre style.",
    "Accessoire au design moderne et original, parfait pour se démarquer et affirmer sa personnalité.",
    "Accessoire de qualité supérieure, à offrir ou à s'offrir pour se faire plaisir. Finition soignée.",
    "Un accessoire tendance qui complètera parfaitement votre collection.",
  ],
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function rand(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function randInt(min: number, max: number): number {
  return Math.floor(rand(min, max + 1));
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function roundTo2(n: number): number {
  return Math.round(n * 100) / 100;
}

function slugify(str: string): string {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const RING_SIZES = ["49", "50", "51", "52", "53", "54", "55", "56", "57", "58", "60", "62"];
const PACK_QUANTITIES = [3, 5, 6, 10, 12];

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Seeding database…");

  // 1. Catégories
  console.log("Creating categories…");
  const categoryMap: Record<string, string> = {};
  for (const cat of CATEGORIES) {
    const c = await prisma.category.upsert({
      where: { name: cat.name },
      update: { slug: cat.slug },
      create: { name: cat.name, slug: cat.slug },
    });
    categoryMap[cat.name] = c.id;
  }

  // 2. Sous-catégories
  console.log("Creating subcategories…");
  const subCategoryMap: Record<string, string[]> = {}; // catName → [subId, ...]
  for (const [catName, subs] of Object.entries(SUBCATEGORIES)) {
    const catId = categoryMap[catName];
    subCategoryMap[catName] = [];
    for (const subName of subs) {
      const sub = await prisma.subCategory.upsert({
        where: { name_categoryId: { name: subName, categoryId: catId } },
        update: {},
        create: { name: subName, slug: slugify(subName), categoryId: catId },
      });
      subCategoryMap[catName].push(sub.id);
    }
  }

  // 3. Couleurs
  console.log("Creating colors…");
  const colorIds: string[] = [];
  for (const col of COLORS) {
    const c = await prisma.color.upsert({
      where: { name: col.name },
      update: { hex: col.hex },
      create: { name: col.name, hex: col.hex },
    });
    colorIds.push(c.id);
  }

  // 4. Compositions
  console.log("Creating compositions…");
  const compositionIds: string[] = [];
  for (const comp of COMPOSITIONS) {
    const c = await prisma.composition.upsert({
      where: { name: comp },
      update: {},
      create: { name: comp },
    });
    compositionIds.push(c.id);
  }

  // 5. Générer 10 000 produits en lots
  console.log("Generating 10,000 products…");

  const TOTAL = 10000;
  const BATCH_SIZE = 50;

  const catNames = CATEGORIES.map((c) => c.name);

  async function createProduct(idx: number): Promise<void> {
    const ref = `BJ-${String(idx).padStart(5, "0")}`;

    // Catégorie aléatoire
    const catName = pick(catNames);
    const catId = categoryMap[catName];
    const subIds = subCategoryMap[catName];
    const subId = pick(subIds);

    // Nom
    const tpl = NAME_TEMPLATES[catName];
    const productName = `${pick(tpl.prefixes)} ${pick(tpl.styles)} ${pick(tpl.suffixes)}`;

    // Description
    const description = pick(DESCRIPTIONS[catName]);

    // Couleurs (1 à 3) — on s'assure de ne pas dupliquer la même couleur dans un produit
    const numColors = randInt(1, 3);
    const shuffledColors = [...colorIds].sort(() => Math.random() - 0.5).slice(0, numColors);

    const isRing = catName === "Bagues";

    await prisma.product.create({
      data: {
        reference: ref,
        name: productName,
        description,
        categoryId: catId,
        subCategories: { connect: [{ id: subId }] },
        compositions: {
          create: (() => {
            // 1 ou 2 compositions
            const numComps = Math.random() < 0.4 ? 2 : 1;
            const shuffled = [...compositionIds].sort(() => Math.random() - 0.5);
            if (numComps === 1) {
              return [{ compositionId: shuffled[0], percentage: 100 }];
            } else {
              const pct1 = randInt(50, 80);
              return [
                { compositionId: shuffled[0], percentage: pct1 },
                { compositionId: shuffled[1], percentage: 100 - pct1 },
              ];
            }
          })(),
        },
        colors: {
          create: shuffledColors.map((colorId, i) => {
            const unitPrice = roundTo2(rand(4.5, 85.0));
            const weight = roundTo2(rand(0.005, 0.12));
            const stock = randInt(15, 500);
            const hasPack = Math.random() < 0.6;

            const saleOptionsData: {
              saleType: SaleType;
              packQuantity?: number | null;
              size?: string | null;
              discountType: null;
              discountValue: null;
            }[] = [
              {
                saleType: SaleType.UNIT,
                packQuantity: null,
                size: isRing ? pick(RING_SIZES) : "TU",
                discountType: null,
                discountValue: null,
              },
            ];

            if (hasPack) {
              saleOptionsData.push({
                saleType: SaleType.PACK,
                packQuantity: pick(PACK_QUANTITIES),
                size: isRing ? pick(RING_SIZES) : "TU",
                discountType: null,
                discountValue: null,
              });
            }

            return {
              colorId,
              unitPrice,
              weight,
              stock,
              isPrimary: i === 0,
              saleOptions: { create: saleOptionsData },
            };
          }),
        },
      },
    });
  }

  let created = 0;
  for (let i = 0; i < TOTAL; i += BATCH_SIZE) {
    const end = Math.min(i + BATCH_SIZE, TOTAL);
    const batch = Array.from({ length: end - i }, (_, j) => i + j + 1);
    await Promise.all(batch.map((idx) => createProduct(idx)));
    created = end;
    if (created % 500 === 0 || created === TOTAL) {
      console.log(`  ✓ ${created} / ${TOTAL} products created`);
    }
  }

  // 6. Comptes finaux
  const [productCount, colorVariantCount, saleOptionCount, compositionCount] = await Promise.all([
    prisma.product.count(),
    prisma.productColor.count(),
    prisma.saleOption.count(),
    prisma.productComposition.count(),
  ]);

  console.log("\n── Seed terminé ──────────────────────────────");
  console.log(`  Categories     : ${Object.keys(categoryMap).length}`);
  console.log(`  SubCategories  : ${Object.values(subCategoryMap).flat().length}`);
  console.log(`  Colors         : ${colorIds.length}`);
  console.log(`  Compositions   : ${compositionIds.length}`);
  console.log(`  Products       : ${productCount}`);
  console.log(`  Color variants : ${colorVariantCount}`);
  console.log(`  Sale options   : ${saleOptionCount}`);
  console.log(`  Compositions   : ${compositionCount}`);
  console.log("──────────────────────────────────────────────\n");
}

main()
  .then(() => {
    console.log("Done!");
    prisma.$disconnect();
  })
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
