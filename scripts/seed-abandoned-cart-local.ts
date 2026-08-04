import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const TENANT = "cmrgfr0380000ikm3d0a94n6z";
const USER_ID = "cms68eleb0001m02pe6o3xzji"; // Marie Lambert

async function main() {
  const variants = await p.productColor.findMany({
    where: { product: { status: "ONLINE", tenantId: TENANT }, tenantId: TENANT },
    select: {
      id: true,
      unitPrice: true,
      product: { select: { name: true, reference: true } },
    },
    take: 3,
  });
  if (variants.length < 2) {
    console.log("Pas assez de variantes ONLINE en local (trouvé " + variants.length + ").");
    return;
  }

  const existing = await p.cart.findUnique({
    where: { userId: USER_ID },
    select: { id: true },
  });
  if (existing) {
    await p.cart.delete({ where: { id: existing.id } });
    console.log("Ancien panier supprimé.");
  }

  const backdated = new Date(Date.now() - 25 * 60 * 60 * 1000);

  const cart = await p.cart.create({
    data: {
      userId: USER_ID,
      tenantId: TENANT,
      updatedAt: backdated,
      items: {
        create: variants.slice(0, 2).map((v, i) => ({
          variantId: v.id,
          quantity: i === 0 ? 6 : 12,
          tenantId: TENANT,
        })),
      },
    },
    select: {
      id: true,
      updatedAt: true,
      items: {
        select: {
          quantity: true,
          variant: { select: { product: { select: { name: true } } } },
        },
      },
    },
  });

  // Prisma updatedAt @updatedAt override
  await p.$executeRaw`UPDATE Cart SET updatedAt = ${backdated} WHERE id = ${cart.id}`;

  console.log("OK — panier créé pour Marie Lambert");
  console.log("  Cart id : " + cart.id);
  console.log("  Ancienneté : 25h (immédiatement éligible)");
  console.log("  Articles :");
  for (const it of cart.items) {
    console.log("    - " + it.quantity + "× " + it.variant.product.name);
  }
}

main()
  .catch((e) => {
    console.error("ERREUR :", e);
    process.exit(1);
  })
  .finally(async () => {
    await p.$disconnect();
  });
