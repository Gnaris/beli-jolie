import { redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";

/**
 * L'ancien URL /panier/commande a été fusionné dans /panier (wizard 3 étapes).
 * On garde une redirection pour les vieux bookmarks / mails / liens externes.
 */
export default async function LegacyCommandeRedirect() {
  const locale = await getLocale();
  redirect({ href: "/panier", locale });
}
