import type { Metadata } from "next";
import Link from "next/link";
import {
  getCachedHasAnkorstoreConfig,
  getCachedAnkorstoreEnabled,
} from "@/lib/cached-data";
import AnkorstoreMatchingClient from "@/components/admin/ankorstore/AnkorstoreMatchingClient";

export const metadata: Metadata = { title: "Ankorstore — matching" };
export const dynamic = "force-dynamic";

export default async function AnkorstorePage() {
  const [hasConfig, enabled] = await Promise.all([
    getCachedHasAnkorstoreConfig(),
    getCachedAnkorstoreEnabled(),
  ]);

  if (!hasConfig) {
    return (
      <div className="max-w-3xl mx-auto p-6 space-y-4">
        <h1 className="page-title">Ankorstore</h1>
        <p className="text-text-secondary font-body">
          Configurez d&apos;abord vos identifiants Ankorstore dans{" "}
          <Link href="/admin/parametres" className="text-text-primary underline font-semibold">
            Paramètres &gt; Marketplaces
          </Link>
          .
        </p>
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="max-w-3xl mx-auto p-6 space-y-4">
        <h1 className="page-title">Ankorstore</h1>
        <p className="text-text-secondary font-body">
          La synchronisation Ankorstore est actuellement désactivée. Activez-la dans{" "}
          <Link href="/admin/parametres" className="text-text-primary underline font-semibold">
            Paramètres &gt; Marketplaces
          </Link>{" "}
          pour pouvoir associer vos produits locaux à des produits Ankorstore existants.
        </p>
      </div>
    );
  }

  return <AnkorstoreMatchingClient />;
}
