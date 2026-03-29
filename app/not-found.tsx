import Link from "next/link";

/**
 * Custom 404 page — rendered inside root layout when a route is not found.
 * Server Component.
 */
export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#0A1628] flex flex-col items-center justify-center px-6 py-12">
      <div className="max-w-lg w-full text-center">
        {/* 404 number */}
        <div className="mb-6">
          <span className="font-heading text-[8rem] font-bold leading-none tracking-tighter text-white">
            404
          </span>
        </div>

        {/* Icon */}
        <div className="mx-auto mb-8 w-20 h-20 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="w-9 h-9 text-white/70"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.182 16.318A4.486 4.486 0 0 0 12.016 15a4.486 4.486 0 0 0-3.198 1.318M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75Zm-.375 0h.008v.015h-.008V9.75Zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75Zm-.375 0h.008v.015h-.008V9.75Z"
            />
          </svg>
        </div>

        {/* Title */}
        <h1 className="font-heading text-3xl font-bold text-white mb-4 leading-tight">
          Page non trouvée
        </h1>

        {/* Divider */}
        <div className="mx-auto mb-6 w-12 h-px bg-white/20" />

        {/* Message */}
        <p className="font-body text-white/60 text-base leading-relaxed mb-10">
          La page que vous recherchez n&apos;existe pas ou a été déplacée.
          Vérifiez l&apos;adresse ou retournez à l&apos;accueil.
        </p>

        {/* Back to home link */}
        <div>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-white/10 border border-white/20 text-white text-sm font-medium hover:bg-white/15 transition-colors font-body"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
            Retour à l&apos;accueil
          </Link>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-12 text-center">
        <p className="font-body text-white/20 text-xs">
          Plateforme réservée aux professionnels revendeurs
        </p>
      </div>
    </div>
  );
}
