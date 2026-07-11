import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
async function main() {
  const imgs = await p.productColorImage.findMany({ take: 3, select: { path: true } });
  console.log("productColorImage.path samples:", imgs);
  const collections = await p.collection.findMany({ take: 3, select: { image: true } });
  console.log("collection.image samples:", collections);
  const totalImgs = await p.productColorImage.count();
  console.log("Total productColorImage rows:", totalImgs);
}
main().finally(() => p.$disconnect());
