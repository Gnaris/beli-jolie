import { PrismaClient } from "@prisma/client";
import { promises as fs } from "node:fs";
import path from "node:path";
const p = new PrismaClient();
const CWD = process.cwd();

async function main() {
  const legacy = await p.productColorImage.count({
    where: { path: { not: { contains: "/uploads/beli-jolie/" } } },
  });
  const migrated = await p.productColorImage.count({
    where: { path: { contains: "/uploads/beli-jolie/" } },
  });
  console.log(`ProductColorImage : ${migrated} scopés beli-jolie, ${legacy} legacy`);

  const beliJolieDirs = await fs.readdir(path.join(CWD, "public/uploads/beli-jolie"));
  console.log(`public/uploads/beli-jolie contient : ${beliJolieDirs.join(", ")}`);

  const remainingLegacy = await fs.readdir(path.join(CWD, "public/uploads"));
  const notScoped = remainingLegacy.filter((d) => d !== "beli-jolie" && d !== "temp");
  console.log(`Restant à la racine public/uploads (hors beli-jolie/temp) : ${notScoped.join(", ") || "(rien)"}`);

  // Sample images
  const sample = await p.productColorImage.findFirst({ where: { path: { contains: "beli-jolie" } } });
  console.log(`Sample path : ${sample?.path}`);
}
main().finally(() => p.$disconnect());
