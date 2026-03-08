import Link from "next/link";

/**
 * Section promotionnelle — bannière pleine largeur
 * Inspiré du bloc "Unleash Your Cravings" du site de référence
 * Design : fond sombre brun avec texte clair + visuel à droite
 */
export default function PromoSection() {
  return (
    <section className="bg-[#2C2418] overflow-hidden" aria-label="Offre promotionnelle">
      <div className="container-site">
        <div className="grid grid-cols-1 md:grid-cols-2 items-center gap-8 py-14 md:py-0">

          {/* Contenu textuel */}
          <div className="py-0 md:py-16 text-center md:text-left">

            {/* Badge */}
            <span className="inline-block text-xs font-[family-name:var(--font-roboto)] font-semibold tracking-[0.2em] uppercase text-[#8B7355] bg-[#8B7355]/10 border border-[#8B7355]/30 px-4 py-1.5 mb-6">
              Offre Pro — Jusqu'à -30%
            </span>

            {/* Titre */}
            <h2 className="font-[family-name:var(--font-poppins)] text-3xl md:text-4xl lg:text-5xl font-semibold text-[#FDFAF6] leading-tight mb-4">
              Des prix taillés
              <br />
              <em className="font-normal text-[#B8A48A]">pour les pros</em>
            </h2>

            {/* Sous-titre */}
            <p className="font-[family-name:var(--font-roboto)] text-base text-[#D4CCBE] leading-relaxed max-w-sm mx-auto md:mx-0 mb-8">
              Commandez en volume et bénéficiez de tarifs dégressifs sur toutes nos collections.
              Plus vous commandez, plus vous économisez.
            </p>

            {/* Paliers de prix */}
            <div className="flex flex-col sm:flex-row gap-3 mb-8 justify-center md:justify-start">
              {[
                { qty: "10–49 pcs", discount: "-10%" },
                { qty: "50–99 pcs", discount: "-20%" },
                { qty: "100+ pcs", discount: "-30%" },
              ].map((tier) => (
                <div key={tier.qty} className="flex-1 text-center border border-[#6B5B45]/60 px-4 py-3">
                  <p className="font-[family-name:var(--font-poppins)] text-xl font-semibold text-[#B8A48A]">
                    {tier.discount}
                  </p>
                  <p className="text-xs font-[family-name:var(--font-roboto)] text-[#D4CCBE] mt-0.5">
                    {tier.qty}
                  </p>
                </div>
              ))}
            </div>

            {/* CTA */}
            <Link href="/boutique" className="btn-primary">
              Profiter des offres
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </Link>
          </div>

          {/* Visuel décoratif */}
          <div className="relative hidden md:flex items-center justify-center h-80 lg:h-96">
            {/* Cercle décoratif flou */}
            <div className="absolute w-64 h-64 rounded-full bg-[#8B7355]/10 blur-3xl" />

            {/* Placeholder image bijoux */}
            <div className="relative z-10 w-56 h-56 lg:w-72 lg:h-72 bg-[#3D3020] flex flex-col items-center justify-center gap-4 rounded-sm shadow-2xl border border-[#6B5B45]/40">
              <svg className="w-20 h-20 text-[#8B7355] opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={0.8}
                  d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
              </svg>
              <p className="font-[family-name:var(--font-poppins)] text-[#B8A48A] text-lg font-medium text-center">
                Collection<br />Automne 2025
              </p>
              <span className="text-[#6B5B45] text-xs font-[family-name:var(--font-roboto)]">
                Photo à intégrer
              </span>
            </div>
          </div>

        </div>
      </div>
    </section>
  );
}
