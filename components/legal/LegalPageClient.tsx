"use client";

import Link from "next/link";

interface LegalPageClientProps {
  title: string;
  content: string;
  updatedAt: string;
  pdfUrl: string;
}

export default function LegalPageClient({ title, content, updatedAt, pdfUrl }: LegalPageClientProps) {
  return (
    <div className="container-site py-8 md:py-12">
      <div className="max-w-3xl mx-auto">
        {/* Back link */}
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary transition-colors mb-6"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Retour
        </Link>

        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-8">
          <div>
            <h1 className="font-[family-name:var(--font-poppins)] text-2xl md:text-3xl font-bold text-text-primary">
              {title}
            </h1>
            <p className="text-sm text-text-muted mt-2 font-[family-name:var(--font-roboto)]">
              Dernière mise à jour : {new Date(updatedAt).toLocaleDateString("fr-FR", {
                day: "2-digit",
                month: "long",
                year: "numeric",
              })}
            </p>
          </div>
          <a
            href={pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2 text-sm border border-border rounded-lg hover:bg-bg-secondary transition-colors text-text-secondary hover:text-text-primary shrink-0"
            title="Télécharger en PDF"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            <span className="hidden sm:inline">PDF</span>
          </a>
        </div>

        {/* Content */}
        <article
          className="prose prose-sm max-w-none font-[family-name:var(--font-roboto)] text-text-primary
            [&_h2]:font-[family-name:var(--font-poppins)] [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:text-text-primary [&_h2]:border-b [&_h2]:border-border [&_h2]:pb-2
            [&_h3]:font-[family-name:var(--font-poppins)] [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-6 [&_h3]:mb-2
            [&_h4]:text-sm [&_h4]:font-semibold [&_h4]:mt-4 [&_h4]:mb-1
            [&_p]:my-2 [&_p]:leading-relaxed
            [&_ul]:my-2 [&_ul]:pl-6 [&_ul]:list-disc
            [&_ol]:my-2 [&_ol]:pl-6 [&_ol]:list-decimal
            [&_li]:my-1 [&_li]:leading-relaxed
            [&_a]:text-accent [&_a]:underline [&_a]:hover:text-accent-dark
            [&_strong]:font-semibold
            [&_code]:bg-bg-secondary [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs"
          dangerouslySetInnerHTML={{ __html: content }}
        />
      </div>
    </div>
  );
}
