import type { Metadata } from "next";
import { getCachedProductCount, getCachedShopName } from "@/lib/cached-data";
import RegisterForm from "@/components/auth/RegisterForm";

export async function generateMetadata(): Promise<Metadata> {
  const shopName = await getCachedShopName();
  return {
    title: "Inscription — Demande d'accès Pro",
    description:
      `Créez votre compte professionnel ${shopName} pour accéder à nos tarifs grossiste.`,
  };
}

/**
 * Page d'inscription BtoB
 */
export default async function InscriptionPage() {
  const productCount = await getCachedProductCount();

  return <RegisterForm productCount={productCount} />;
}
