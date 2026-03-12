import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { getCart } from "@/app/actions/client/cart";
import CartPageClient from "@/components/panier/CartPageClient";

export const metadata: Metadata = {
  title: "Mon panier",
  robots: { index: false, follow: false },
};

export default async function PanierPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/connexion?callbackUrl=/panier");

  if (session.user.status !== "APPROVED") {
    return (
      <div className="container-site py-14 text-center">
        <div className="max-w-md mx-auto bg-white border border-[#EDD5DC] rounded-2xl p-10 shadow-spring">
          <svg className="w-12 h-12 text-[#D97A8E] mx-auto mb-4 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
          <h1 className="font-[family-name:var(--font-poppins)] text-xl font-semibold text-[#1C1018] mb-2">
            Accès restreint
          </h1>
          <p className="text-sm font-[family-name:var(--font-roboto)] text-[#6B4F5C]">
            Votre compte doit être validé pour accéder au panier.
          </p>
          <Link href="/espace-pro" className="btn-primary mt-6 justify-center">
            Mon espace pro
          </Link>
        </div>
      </div>
    );
  }

  const cart = await getCart();

  return <CartPageClient cart={cart} />;
}
