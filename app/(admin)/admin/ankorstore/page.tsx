import { getCachedAnkorstoreEnabled } from "@/lib/cached-data";
import Link from "next/link";
import AnkorstoreSyncClient from "./AnkorstoreSyncClient";

export default async function AnkorstorePage() {
  const enabled = await getCachedAnkorstoreEnabled();

  if (!enabled) {
    return (
      <div className="space-y-6 animate-fadeIn">
        <h1 className="page-title">Ankorstore</h1>
        <div className="bg-bg-primary border border-border rounded-2xl p-8 text-center space-y-4">
          <div className="text-4xl">&#x1F517;</div>
          <h2 className="text-lg font-semibold text-text-primary">Ankorstore non configur&eacute;</h2>
          <p className="text-text-secondary text-sm max-w-md mx-auto">
            Configurez vos identifiants API Ankorstore (Client ID et Client Secret) pour activer la synchronisation.
          </p>
          <Link
            href="/admin/parametres?tab=marketplaces"
            className="inline-flex items-center gap-2 px-4 py-2 bg-brand text-white rounded-lg hover:opacity-90 transition"
          >
            Configurer Ankorstore
          </Link>
        </div>
      </div>
    );
  }

  return <AnkorstoreSyncClient />;
}
