"use server";

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { sendMail } from "@/lib/email";
import { getCachedShopName, getCachedSiteConfig } from "@/lib/cached-data";
import {
  findMyReview,
  normalizeReviewInput,
  userHasEligibleOrder,
} from "@/lib/customer-reviews";

async function requireClient() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error("Vous devez être connecté pour laisser un avis.");
  }
  return session.user;
}

/**
 * Poste le 1ᵉʳ avis du client courant.
 * - Auth obligatoire.
 * - Le client doit avoir ≥ 1 commande SHIPPED.
 * - Le client ne doit pas avoir déjà d'avis (contrainte @unique).
 * - L'avis est créé en PENDING.
 * - Un mail pro est envoyé à l'admin pour modération.
 */
export async function submitCustomerReview(input: {
  rating: unknown;
  text: unknown;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await requireClient();
    const normalized = normalizeReviewInput(input);
    if (!normalized.ok) return { success: false, error: normalized.error };

    // Guard commande — seuls les clients qui ont déjà commandé peuvent poster.
    const eligible = await userHasEligibleOrder(user.id);
    if (!eligible) {
      return {
        success: false,
        error:
          "Vous pourrez déposer un avis dès que votre première commande aura été expédiée.",
      };
    }

    // Refuse le 2ᵉ avis — le client doit modifier le sien via updateMyCustomerReview.
    const existing = await findMyReview(user.id);
    if (existing) {
      return {
        success: false,
        error: "Vous avez déjà déposé un avis.",
      };
    }

    const created = await prisma.customerReview.create({
      data: {
        userId: user.id,
        rating: normalized.rating,
        text: normalized.text,
      },
    });

    // Notification admin — fire-and-forget, un échec SMTP ne casse pas le dépôt.
    void notifyAdminNewReview(created.id, user.id).catch((err) => {
      logger.error("[customer-reviews] mail admin échoué", { error: err });
    });

    revalidatePath("/espace-pro");
    revalidateTag("customer-reviews-public", "default");
    revalidateTag("customer-reviews-admin", "default");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

/**
 * Le client peut modifier son avis TANT QU'IL EST PENDING.
 * Une fois APPROVED ou REJECTED, il est figé (contact SAV pour changer).
 */
export async function updateMyCustomerReview(input: {
  rating: unknown;
  text: unknown;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await requireClient();
    const normalized = normalizeReviewInput(input);
    if (!normalized.ok) return { success: false, error: normalized.error };

    const existing = await findMyReview(user.id);
    if (!existing) {
      return { success: false, error: "Aucun avis à modifier." };
    }
    if (existing.status !== "PENDING") {
      return {
        success: false,
        error:
          "Votre avis a déjà été modéré et ne peut plus être modifié. Contactez notre équipe si besoin.",
      };
    }

    await prisma.customerReview.update({
      where: { id: existing.id },
      data: { rating: normalized.rating, text: normalized.text },
    });

    revalidatePath("/espace-pro");
    revalidateTag("customer-reviews-admin", "default");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

/** Le client peut supprimer son avis TANT QU'IL EST PENDING. */
export async function deleteMyCustomerReview(): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await requireClient();
    const existing = await findMyReview(user.id);
    if (!existing) return { success: true };
    if (existing.status !== "PENDING") {
      return {
        success: false,
        error: "Votre avis a déjà été modéré et ne peut plus être supprimé.",
      };
    }

    await prisma.customerReview.delete({ where: { id: existing.id } });

    revalidatePath("/espace-pro");
    revalidateTag("customer-reviews-admin", "default");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

/**
 * Envoie un mail à la boîte pro (smtp_from_email) pour signaler qu'un nouvel
 * avis est en attente de modération. Contenu : nom du client + note + extrait
 * + lien direct vers l'admin.
 */
async function notifyAdminNewReview(reviewId: string, userId: string): Promise<void> {
  const [review, user, shopName, smtpFromRow, baseUrlRow] = await Promise.all([
    prisma.customerReview.findUnique({
      where: { id: reviewId },
      select: { rating: true, text: true },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true, email: true, company: true },
    }),
    getCachedShopName(),
    getCachedSiteConfig("smtp_from_email"),
    getCachedSiteConfig("nextauth_url"),
  ]);
  const toEmail = smtpFromRow?.value?.trim();
  if (!review || !user || !toEmail) return;

  const stars = "★".repeat(review.rating) + "☆".repeat(5 - review.rating);
  const excerpt =
    review.text.length > 300 ? review.text.slice(0, 297).trimEnd() + "…" : review.text;
  const clientLabel = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;
  const baseUrl = baseUrlRow?.value?.trim() || "";
  const adminLink = baseUrl
    ? `${baseUrl.replace(/\/+$/, "")}/admin/avis`
    : "/admin/avis";

  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a">
      <p style="font-size:11px;letter-spacing:.24em;color:#64748b;text-transform:uppercase;margin:0 0 4px">Nouvel avis à modérer</p>
      <h1 style="font-size:22px;font-weight:700;margin:0 0 20px">${escapeHtml(clientLabel)} vient de laisser un avis</h1>
      <div style="border:1px solid #e2e8f0;border-radius:16px;padding:20px;background:#f8fafc">
        <p style="margin:0;font-size:20px;color:#f59e0b;letter-spacing:2px">${stars}</p>
        <p style="margin:12px 0 0;font-size:14px;line-height:1.6;color:#334155">${escapeHtml(excerpt)}</p>
        ${user.company ? `<p style="margin:16px 0 0;font-size:12px;color:#64748b">${escapeHtml(user.company)}</p>` : ""}
      </div>
      <p style="margin:24px 0 8px">
        <a href="${escapeHtml(adminLink)}" style="display:inline-block;padding:12px 22px;background:#0f172a;color:#fff;border-radius:999px;text-decoration:none;font-weight:600;font-size:14px">Modérer cet avis →</a>
      </p>
      <p style="margin:20px 0 0;font-size:12px;color:#94a3b8">Vous recevez ce mail parce qu'un client de <strong>${escapeHtml(shopName)}</strong> a déposé un avis. Il sera invisible sur la page d'accueil tant que vous ne l'aurez pas approuvé.</p>
    </div>
  `;

  await sendMail({
    to: toEmail,
    subject: `[${shopName}] Nouvel avis client à modérer`,
    html,
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
