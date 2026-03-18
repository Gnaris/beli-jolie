"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";

/**
 * Bannière discrète affichée aux visiteurs naviguant avec un code d'accès invité.
 * Les invite à s'inscrire pour pouvoir commander.
 */
export default function GuestBanner() {
  const { data: session } = useSession();
  const [hasAccessCode, setHasAccessCode] = useState(false);

  useEffect(() => {
    const cookie = document.cookie
      .split("; ")
      .find((c) => c.startsWith("bj_access_code="));
    setHasAccessCode(!!cookie);
  }, []);

  // Ne pas afficher si connecté ou pas de code d'accès
  if (session?.user || !hasAccessCode) return null;

  return (
    <div className="bg-[#1A1A1A] text-white px-4 py-2.5 text-center sticky top-0 z-50">
      <p className="text-xs sm:text-sm font-[family-name:var(--font-roboto)]">
        Vous naviguez en mode invité.{" "}
        <Link
          href="/inscription"
          className="underline font-medium hover:text-gray-300 transition-colors"
        >
          Créez votre compte
        </Link>{" "}
        pour accéder aux commandes et au panier.
      </p>
    </div>
  );
}
