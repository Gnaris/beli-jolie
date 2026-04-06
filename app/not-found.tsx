import Link from "next/link";

/**
 * Custom 404 page — rendered inside root layout when a route is not found.
 * Server Component.
 */
export default function NotFound() {
  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center px-6">
      <div className="max-w-md w-full text-center">
        {/* 404 number */}
        <div className="mb-6">
          <span className="font-heading text-[7rem] font-bold leading-none tracking-tighter text-white/10">
            404
          </span>
        </div>

        {/* Title */}
        <h1 className="font-heading text-2xl font-semibold text-white mb-3 tracking-tight">
          Page introuvable
        </h1>

        {/* Message */}
        <p className="font-body text-white/40 text-sm leading-relaxed mb-10">
          Cette page n&apos;existe pas ou a été déplacée.
        </p>

        {/* Back to home link */}
        <Link
          href="/"
          className="inline-flex items-center gap-2 px-8 py-2.5 rounded-full bg-white text-black text-sm font-medium hover:bg-white/90 transition-colors font-body"
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
  );
}
