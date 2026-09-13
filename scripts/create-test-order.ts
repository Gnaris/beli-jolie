import { prisma } from "@/lib/prisma";

async function main() {
  const userId = "cmtuh288f0005szvkgdx91tkx";
  const tenantId = "cmrhsmaim0000vld1q6b030mh";
  const orderNumber = "TEST" + Math.random().toString(36).slice(2, 6).toUpperCase();

  const created = await prisma.order.create({
    data: {
      tenantId,
      orderNumber,
      userId,
      status: "SHIPPED",
      shipLabel: "Domicile",
      shipFirstName: "Boris",
      shipLastName: "Chen",
      shipCompany: "Aventis",
      shipAddress1: "1 rue de test",
      shipZipCode: "75001",
      shipCity: "Paris",
      shipCountry: "FR",
      clientCompany: "Aventis",
      clientEmail: "borischen91@gmail.com",
      clientPhone: "+33600000000",
      carrierId: "test",
      carrierName: "Test Express",
      carrierPrice: 5.0,
      tvaRate: 0.2,
      subtotalHT: 100.0,
      tvaAmount: 20.0,
      totalTTC: 125.0,
      paymentStatus: "paid",
    },
    select: { id: true, orderNumber: true, status: true, totalTTC: true },
  });
  console.log("OK — commande créée:", created);
}

main()
  .catch((e) => {
    console.error("ERREUR:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
