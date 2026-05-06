import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.siteConfig.deleteMany({
    where: {
      key: {
        in: ["stripe_connect_account_id", "stripe_connect_account_id_backup"],
      },
    },
  });
  console.log(`SiteConfig nettoyés (Stripe Connect) : ${result.count} entrée(s) supprimée(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
