import "dotenv/config";
import { prisma } from "@/lib/prisma";

async function main() {
  const states = await prisma.siteConfig.findMany({
    where: {
      key: {
        in: [
          "ankorstore_orders_import_state",
          "ankorstore_orders_import_stop",
          "ankorstore_orders_last_synced_at",
        ],
      },
    },
  });
  console.log("État d'import Ankorstore par tenant :");
  for (const s of states) {
    console.log(`\n  tenantId=${s.tenantId} key=${s.key}`);
    if (s.key.includes("state")) {
      try {
        const parsed = JSON.parse(s.value);
        console.log("    ", JSON.stringify(parsed, null, 2).split("\n").join("\n    "));
      } catch {
        console.log("    (impossible à parser)", s.value.slice(0, 200));
      }
    } else {
      console.log("    ", s.value);
    }
  }

  const cnt = await prisma.ankorstoreOrder.count();
  console.log(`\nTotal AnkorstoreOrder en base : ${cnt}`);
}

main().finally(async () => prisma.$disconnect());
