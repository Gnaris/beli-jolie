import { getCachedEfashionEnabled } from "@/lib/cached-data";
import Link from "next/link";
import EfashionSyncPageClient from "./EfashionSyncPageClient";

export default async function EfashionSyncPage() {
  const efashionEnabled = await getCachedEfashionEnabled();

  if (!efashionEnabled) {
    return (
      <div className="space-y-6 animate-fadeIn">
        <div className="flex items-center gap-2 text-sm font-body text-text-muted mb-2">
          <Link href="/admin/produits/importer" className="hover:text-text-primary transition-colors">Importation</Link>
          <span>/</span>
          <span className="text-text-secondary">eFashion Paris</span>
        </div>
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-16 h-16 rounded-2xl bg-bg-secondary flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-text-primary font-heading mb-2">
            eFashion Paris non configuré
          </h1>
          <p className="text-sm text-text-muted font-body text-center max-w-md mb-6">
            Pour utiliser la synchronisation eFashion, configurez vos identifiants eFashion Paris dans les paramètres Marketplaces.
          </p>
          <Link
            href="/admin/parametres?tab=marketplaces"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-bg-dark rounded-lg hover:bg-bg-dark/90 transition-colors font-body"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Configurer dans les paramètres
          </Link>
        </div>
      </div>
    );
  }

  return <EfashionSyncPageClient />;
}
