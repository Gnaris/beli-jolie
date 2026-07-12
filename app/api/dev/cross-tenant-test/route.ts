import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentTenant } from "@/lib/tenant";

/**
 * Endpoint de test cross-tenant, uniquement disponible en NODE_ENV=development.
 * Accepte { op, targetProductId?, targetOrderId? } pour tenter des opérations
 * dangereuses sur des rows appartenant à un autre tenant.
 * Utilisé par scripts/dev/test-cross-tenant-fix.ts pour valider l'isolation.
 */
export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not Found" }, { status: 404 });
  }
  const tenant = await getCurrentTenant();
  const body = (await request.json()) as {
    op:
      | "deleteProductCrossTenant"
      | "updateProductCrossTenant"
      | "shipOrderCrossTenant"
      | "cancelOrderCrossTenant"
      | "upsertProductCrossTenant";
    targetProductId?: string;
    targetOrderId?: string;
    targetProductReference?: string;
  };

  const result: Record<string, unknown> = {
    tenant,
    op: body.op,
  };

  try {
    switch (body.op) {
      case "deleteProductCrossTenant": {
        if (!body.targetProductId) throw new Error("targetProductId required");
        const deleted = await prisma.product.delete({ where: { id: body.targetProductId } });
        result.deleted = deleted;
        break;
      }
      case "updateProductCrossTenant": {
        if (!body.targetProductId) throw new Error("targetProductId required");
        const updated = await prisma.product.update({
          where: { id: body.targetProductId },
          data: { name: `HACKED-BY-${tenant?.slug ?? "UNKNOWN"}` },
        });
        result.updated = updated;
        break;
      }
      case "shipOrderCrossTenant": {
        if (!body.targetOrderId) throw new Error("targetOrderId required");
        const updated = await prisma.order.update({
          where: { id: body.targetOrderId },
          data: { status: "SHIPPED" },
        });
        result.updated = updated;
        break;
      }
      case "cancelOrderCrossTenant": {
        if (!body.targetOrderId) throw new Error("targetOrderId required");
        const updated = await prisma.order.update({
          where: { id: body.targetOrderId },
          data: { status: "CANCELLED" },
        });
        result.updated = updated;
        break;
      }
      case "upsertProductCrossTenant": {
        if (!body.targetProductReference) throw new Error("targetProductReference required");
        const cat = await prisma.category.findFirst();
        // NOTE: `reference` n'est plus `@unique` seul (remplacé par `@@unique([tenantId, reference])`),
        // donc `upsert({where:{reference}})` ne compile plus. On simule un upsert manuel — l'objectif
        // du test est de vérifier que l'extension tenant-scope bloque une écriture cross-tenant, peu
        // importe la primitive utilisée.
        const existing = await prisma.product.findFirst({
          where: { reference: body.targetProductReference },
          select: { id: true },
        });
        let upserted: unknown;
        if (existing) {
          upserted = await prisma.product.update({
            where: { id: existing.id },
            data: { name: `UPSERT-HACK-BY-${tenant?.slug ?? "UNKNOWN"}` },
          });
        } else {
          upserted = await prisma.product.create({
            data: {
              reference: body.targetProductReference,
              name: `New-from-${tenant?.slug ?? "UNKNOWN"}`,
              description: "Test upsert cross-tenant",
              categoryId: cat!.id,
            },
          });
        }
        result.upserted = upserted;
        break;
      }
    }
    result.ok = true;
  } catch (err) {
    result.ok = false;
    result.error = (err as Error).message;
  }

  // Post-check : lit la row cible via un client bypass (MULTI_TENANT_SCOPE=off n'aide pas
  // ici car on est en runtime — on utilise directement getPreCheckModelDelegate équivalent)
  // Pour simplicité : on renvoie juste ce qu'on a. La cliente vérifiera via un autre call.
  return NextResponse.json(result);
}
