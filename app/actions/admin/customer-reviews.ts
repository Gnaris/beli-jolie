"use server";

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatReviewerName } from "@/lib/customer-reviews";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Non autorisé");
  return session.user;
}

/** Approuve un avis → il devient visible sur la homepage. */
export async function approveCustomerReview(
  reviewId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const admin = await requireAdmin();
    await prisma.customerReview.update({
      where: { id: reviewId },
      data: {
        status: "APPROVED",
        moderatedAt: new Date(),
        moderatedById: admin.id,
        moderationNote: null,
      },
    });
    revalidatePath("/admin/avis");
    revalidateTag("customer-reviews-public", "default");
    revalidateTag("customer-reviews-admin", "default");
    revalidatePath("/", "layout"); // homepage
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

/**
 * Rejette un avis → il reste en base mais invisible. `note` = motif interne
 * visible admin uniquement.
 */
export async function rejectCustomerReview(
  reviewId: string,
  note?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const admin = await requireAdmin();
    await prisma.customerReview.update({
      where: { id: reviewId },
      data: {
        status: "REJECTED",
        moderatedAt: new Date(),
        moderatedById: admin.id,
        moderationNote: note?.trim() || null,
      },
    });
    revalidatePath("/admin/avis");
    revalidateTag("customer-reviews-public", "default");
    revalidateTag("customer-reviews-admin", "default");
    revalidatePath("/", "layout");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

/** Supprime définitivement un avis (rare — utilisation SAV). */
export async function deleteCustomerReview(
  reviewId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    await prisma.customerReview.delete({ where: { id: reviewId } });
    revalidatePath("/admin/avis");
    revalidateTag("customer-reviews-public", "default");
    revalidateTag("customer-reviews-admin", "default");
    revalidatePath("/", "layout");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

/** Compteur des avis en attente — alimente le badge du widget flottant admin. */
export async function getPendingReviewsCount(): Promise<number> {
  await requireAdmin();
  return prisma.customerReview.count({ where: { status: "PENDING" } });
}

/**
 * Liste des avis pour la page de modération admin. Trie par créés récents en
 * premier, PENDING avant les autres.
 */
export async function listReviewsForModeration(): Promise<{
  pending: Array<AdminReviewRow>;
  moderated: Array<AdminReviewRow>;
}> {
  await requireAdmin();
  const rows = await prisma.customerReview.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    include: {
      user: {
        select: { id: true, firstName: true, lastName: true, email: true, company: true },
      },
    },
  });
  const pending: AdminReviewRow[] = [];
  const moderated: AdminReviewRow[] = [];
  for (const r of rows) {
    const row: AdminReviewRow = {
      id: r.id,
      status: r.status,
      rating: r.rating,
      text: r.text,
      createdAt: r.createdAt.toISOString(),
      moderatedAt: r.moderatedAt?.toISOString() ?? null,
      moderationNote: r.moderationNote,
      displayName: formatReviewerName(r.user),
      user: {
        id: r.user.id,
        fullName: [r.user.firstName, r.user.lastName].filter(Boolean).join(" "),
        email: r.user.email,
        company: r.user.company ?? null,
      },
    };
    if (r.status === "PENDING") pending.push(row);
    else moderated.push(row);
  }
  return { pending, moderated };
}

export interface AdminReviewRow {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  rating: number;
  text: string;
  createdAt: string;
  moderatedAt: string | null;
  moderationNote: string | null;
  displayName: string; // « Sophie L. »
  user: {
    id: string;
    fullName: string;
    email: string;
    company: string | null;
  };
}
