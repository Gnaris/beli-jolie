"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCachedShopName } from "@/lib/cached-data";
import { sendMail } from "@/lib/email";

/**
 * Envoie un email de test depuis le wizard d'onboarding pour vérifier
 * que la configuration SMTP fonctionne. Renvoie `{ success, error? }`.
 */
export async function sendOnboardingTestEmail(
  to: string,
): Promise<{ success: boolean; error?: string }> {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return { success: false, error: "Non autorisé" };
  }

  const email = to?.trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { success: false, error: "Adresse email invalide." };
  }

  let shopName = "";
  try {
    shopName = (await getCachedShopName()).trim();
  } catch {
    shopName = "";
  }

  const result = await sendMail({
    to: email,
    subject: `Test d'envoi — ${shopName || "votre boutique"}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
        <h2 style="color:#0369a1;margin:0 0 12px 0;">📬 Votre boutique peut envoyer des emails</h2>
        <p style="color:#334155;line-height:1.5;">
          Si vous recevez ce message, la messagerie de votre site fonctionne :
          les confirmations de commande, les mots de passe oubliés et les
          notifications d'expédition partiront correctement.
        </p>
        <p style="color:#94a3b8;font-size:12px;margin-top:24px;">
          Test envoyé le ${new Date().toLocaleString("fr-FR")} depuis le wizard
          de configuration.
        </p>
      </div>
    `,
  });

  if (result.sent) return { success: true };

  if (result.reason === "no_config") {
    return {
      success: false,
      error: "La configuration SMTP est incomplète côté serveur.",
    };
  }
  if (result.reason === "no_from") {
    return {
      success: false,
      error: "Aucune adresse d'expéditeur (SMTP_FROM_EMAIL) configurée.",
    };
  }
  return {
    success: false,
    error: result.error ?? "Échec de l'envoi. Vérifiez la configuration SMTP.",
  };
}
