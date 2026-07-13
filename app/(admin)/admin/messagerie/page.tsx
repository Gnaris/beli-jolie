import type { Metadata } from "next";
import { getCachedShopName } from "@/lib/cached-data";
import MessagerieFrame from "@/components/admin/MessagerieFrame";

export async function generateMetadata(): Promise<Metadata> {
  const shopName = await getCachedShopName();
  return { title: `Messagerie — ${shopName} Admin` };
}

const WEBMAIL_URL = "https://mail.beliandjolie.com";

export default function MessageriePage() {
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Messagerie</h1>
          <p className="page-subtitle">
            Consultez et répondez aux mails reçus sur votre boîte pro directement depuis votre admin.
          </p>
        </div>
        <a
          href={WEBMAIL_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-sm font-medium text-zinc-600 hover:text-zinc-900 border border-zinc-200 hover:border-zinc-300 rounded-lg px-3 py-1.5 bg-white transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
          </svg>
          Ouvrir dans un nouvel onglet
        </a>
      </div>

      <MessagerieFrame src={WEBMAIL_URL} />
    </div>
  );
}
