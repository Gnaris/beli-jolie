import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { slug: "beliandjolie" } });
  if (!tenant) throw new Error("Tenant beliandjolie not found");

  const password = await bcrypt.hash("motdepasse123", 10);

  const clients = [
    {
      email: "borischen91@gmail.com",
      firstName: "Boris",
      lastName: "Chen",
      phone: "07 82 75 81 58",
      company: "Boris Chen",
    },
    {
      email: "luxebyam97@gmail.com",
      firstName: "LuxeByAm",
      lastName: "Client",
      phone: "+33691253878",
      company: "LuxeByAm",
    },
  ];

  for (const c of clients) {
    const existing = await prisma.user.findFirst({ where: { email: c.email, tenantId: tenant.id } });
    if (existing) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { ...c, password, role: "CLIENT", status: "APPROVED" },
      });
      console.log(`updated ${c.email}`);
    } else {
      await prisma.user.create({
        data: { ...c, password, role: "CLIENT", status: "APPROVED", tenantId: tenant.id },
      });
      console.log(`created ${c.email}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
