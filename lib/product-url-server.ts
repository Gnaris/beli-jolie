import "server-only";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { buildProductHandle } from "@/lib/product-url";

export async function revalidateProductPublicPage(productId: string): Promise<void> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { name: true, reference: true },
  });
  if (!product) return;
  const handle = buildProductHandle(product.name, product.reference);
  revalidatePath(`/produits/${handle}`);
}
