import Link from "next/link";

/**
 * Section promotionnelle — banniere pleine largeur
 * Design : fond sombre avec texte clair + visuel a droite
 */
export default function PromoSection() {
  return (
    <section className="bg-bg-dark overflow-hidden" aria-label="Offre promotionnelle">
      <div className="container-site">
        <div className="grid grid-cols-1 md:grid-cols-2 items-center gap-8 py-14 md:py-0">
          {/* Text content */}
          <div className="py-0 md:py-16 text-center md:text-left">
            {/* Badge */}
            <span className="inline-block text-xs font-[family-name:var(--font-roboto)] font-semibold tracking-[0.2em] uppercase text-text-inverse bg-white/10 border border-white/20 px-4 py-1.5 mb-6 rounded-full">
              Offre Pro — Jusqu&apos;a -30%
            </span>

            {/* Title */}
            <h2 className="font-[family-name:var(--font-poppins)] text-3xl md:text-4xl lg:text-5xl font-semibold text-text-inverse leading-tight mb-4">
              Des prix tailles
              <br />
              <em className="font-normal text-text-muted">pour les pros</em>
            </h2>

            {/* Subtitle */}
            <p className="font-[family-name:var(--font-roboto)] text-base text-text-muted leading-relaxed max-w-sm mx-auto md:mx-0 mb-8">
              Commandez en volume et beneficiez de tarifs degressifs sur toutes
              nos collections. Plus vous commandez, plus vous economisez.
            </p>

            {/* Price tiers */}
            <div className="flex flex-col sm:flex-row gap-3 mb-8 justify-center md:justify-start">
              {[
                { qty: "10-49 pcs", discount: "-10%" },
                { qty: "50-99 pcs", discount: "-20%" },
                { qty: "100+ pcs", discount: "-30%" },
              ].map((tier) => (
                <div
                  key={tier.qty}
                  className="flex-1 text-center border border-white/15 px-4 py-3 rounded-xl"
                >
                  <p className="font-[family-name:var(--font-poppins)] text-xl font-semibold text-accent">
                    {tier.discount}
                  </p>
                  <p className="text-xs font-[family-name:var(--font-roboto)] text-text-muted mt-0.5">
                    {tier.qty}
                  </p>
                </div>
              ))}
            </div>

            {/* CTA */}
            <Link
              href="/boutique"
              className="inline-flex items-center gap-2 bg-bg-primary text-text-primary text-sm font-medium px-6 py-2.5 rounded-lg hover:bg-bg-tertiary transition-colors font-[family-name:var(--font-roboto)]"
            >
              Profiter des offres
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 8l4 4m0 0l-4 4m4-4H3"
                />
              </svg>
            </Link>
          </div>

          {/* Decorative visual */}
          <div className="relative hidden md:flex items-center justify-center h-80 lg:h-96">
            {/* Decorative blurred circle */}
            <div className="absolute w-64 h-64 rounded-full bg-white/5 blur-3xl" />

            {/* Placeholder */}
            <div className="relative z-10 w-56 h-56 lg:w-72 lg:h-72 bg-white/5 flex flex-col items-center justify-center gap-4 rounded-2xl shadow-2xl border border-white/10">
              <svg
                className="w-20 h-20 text-text-muted opacity-70"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={0.8}
                  d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"
                />
              </svg>
              <p className="font-[family-name:var(--font-poppins)] text-text-muted text-lg font-medium text-center">
                Collection
                <br />
                Printemps 2026
              </p>
              <span className="text-text-muted text-xs font-[family-name:var(--font-roboto)] opacity-60">
                Photo a integrer
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
