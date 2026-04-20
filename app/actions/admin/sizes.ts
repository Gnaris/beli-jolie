"use server";

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
}

function normalizePfsRef(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const t = ref.trim();
  return t.length > 0 ? t : null;
}

/** Create a new size. PFS ref is mandatory. */
export async function createSize(name: string, pfsSizeRef: string) {
  await requireAdmin();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Le nom est requis.");

  const normalizedRef = normalizePfsRef(pfsSizeRef);
  if (!normalizedRef) {
    throw new Error("La référence Paris Fashion Shop est obligatoire.");
  }

  const existing = await prisma.size.findUnique({
    where: { name: trimmed },
    select: { id: true, name: true, pfsSizeRef: true },
  });
  if (existing) return existing;

  const maxPos = await prisma.size.aggregate({ _max: { position: true } });
  const position = (maxPos._max.position ?? -1) + 1;

  const created = await prisma.size.create({
    data: {
      name: trimmed,
      position,
      pfsSizeRef: normalizedRef,
    },
    select: { id: true, name: true, pfsSizeRef: true },
  });

  revalidatePath("/admin/produits");
  revalidatePath("/admin/tailles");
  revalidateTag("sizes", "default");

  return created;
}

/** Update name, and optionally pfsSizeRef. */
export async function updateSize(id: string, name: string, pfsSizeRef?: string | null) {
  await requireAdmin();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Le nom est requis.");

  const conflict = await prisma.size.findFirst({
    where: { name: trimmed, id: { not: id } },
  });
  if (conflict) throw new Error(`La taille « ${trimmed} » existe déjà.`);

  const updateData: { name: string; pfsSizeRef?: string | null } = { name: trimmed };
  if (pfsSizeRef !== undefined) {
    updateData.pfsSizeRef = normalizePfsRef(pfsSizeRef);
  }

  await prisma.size.update({ where: { id }, data: updateData });

  revalidatePath("/admin/produits");
  revalidatePath("/admin/tailles");
  revalidateTag("sizes", "default");
}

/** Delete a size (fails if used in variants) */
export async function deleteSize(id: string) {
  await requireAdmin();

  const usageCount = await prisma.variantSize.count({ where: { sizeId: id } });
  if (usageCount > 0) {
    throw new Error(
      `Impossible de supprimer : cette taille est utilisée par ${usageCount} variante(s).`
    );
  }

  await prisma.size.delete({ where: { id } });
  revalidatePath("/admin/produits");
  revalidatePath("/admin/tailles");
  revalidateTag("sizes", "default");
}

/** Set or clear the single PFS size reference for a BJ size (1:1 relation). */
export async function setSizePfsMapping(
  sizeId: string,
  pfsSizeRef: string | null
): Promise<{ pfsSizeRef: string | null }> {
  await requireAdmin();

  const normalized = normalizePfsRef(pfsSizeRef);

  const updated = await prisma.size.update({
    where: { id: sizeId },
    data: { pfsSizeRef: normalized },
    select: { pfsSizeRef: true },
  });

  revalidatePath("/admin/produits");
  revalidatePath("/admin/tailles");
  revalidateTag("sizes", "default");

  return { pfsSizeRef: updated.pfsSizeRef };
}

/** Reorder sizes by providing an ordered array of ids */
export async function reorderSizes(orderedIds: string[]) {
  await requireAdmin();

  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.size.update({ where: { id }, data: { position: index } })
    )
  );

  revalidatePath("/admin/produits");
  revalidatePath("/admin/tailles");
  revalidateTag("sizes", "default");
}
