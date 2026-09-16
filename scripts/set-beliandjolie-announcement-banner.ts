import { prisma } from "@/lib/prisma";
import { setSiteConfig } from "@/lib/site-config-write";

const TENANT_ID = "cmrhsmaim0000vld1q6b030mh";

const payload = {
  messages: [
    "Acier inoxydable 304 hypoallergénique",
    "Livraison partout dans le monde",
    "Commande minimum 100 € HT",
    "Réservé aux professionnels",
  ],
  bgColor: "#000000",
  textColor: "#FFFFFF",
  speed: 8,
  mode: "static" as const,
};

async function main() {
  await setSiteConfig("announcement_banner", JSON.stringify(payload), {
    tenantId: TENANT_ID,
  });
  const row = await prisma.siteConfig.findFirst({
    where: { tenantId: TENANT_ID, key: "announcement_banner" },
    select: { value: true, updatedAt: true },
  });
  console.log("OK — announcement_banner écrit pour", TENANT_ID);
  console.log("Valeur :", row?.value);
  console.log("updatedAt :", row?.updatedAt.toISOString());
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
