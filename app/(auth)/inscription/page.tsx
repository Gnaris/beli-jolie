import type { Metadata } from "next";
import { getCachedProductCount } from "@/lib/cached-data";
import RegisterForm from "@/components/auth/RegisterForm";

export const metadata: Metadata = {
  title: "Inscription — Demande d'accès Pro",
  description:
    "Créez votre compte professionnel Beli & Jolie pour accéder à nos tarifs grossiste en bijoux acier inoxydable.",
};

/**
 * Page d'inscription BtoB
 */
export default async function InscriptionPage() {
  const productCount = await getCachedProductCount();

  return <RegisterForm productCount={productCount} />;
}
