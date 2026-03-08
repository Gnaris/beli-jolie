import Link from "next/link";

export default function HeroSection({ isLoggedIn }: { isLoggedIn: boolean }) {
  return (
    <section className="bg-[#F7F3EC] overflow-hidden">
      <div className="container-site">
        <div className="grid grid-cols-1 lg:grid-cols-2 min-h-[520px] md:min-h-[600px]">

          {/* Contenu textuel */}
          <div className="flex flex-col justify-center py-16 lg:py-20 text-center lg:text-left order-2 lg:order-1">

            {/* Badge catégorie */}
            <span className="inline-block self-center lg:self-start text-xs font-[family-name:var(--font-roboto)] font-medium tracking-[0.2em] uppercase text-[#8B7355] bg-[#EDE8DF] px-4 py-1.5 mb-6">
              Plateforme BtoB — Acier Inoxydable
            </span>

            {/* Titre principal */}
            <h1 className="font-[family-name:var(--font-poppins)] text-4xl md:text-5xl lg:text-6xl font-semibold text-[#2C2418] leading-[1.1] mb-6">
              L'élégance
              <br />
              <em className="font-normal text-[#8B7355]">sans compromis</em>
              <br />
              pour les pros
            </h1>

            {/* Sous-titre */}
            <p className="font-[family-name:var(--font-roboto)] text-base md:text-lg text-[#6B5B45] leading-relaxed max-w-md mx-auto lg:mx-0 mb-8">
              Collections de bijoux en acier inoxydable, pensées pour les revendeurs, boutiques et créateurs exigeants.
              Tarifs professionnels, livraison mondiale.
            </p>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
              <Link href="/produits" className="btn-primary">
                Découvrir les produits
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </Link>
              {!isLoggedIn && (
                <Link href="/inscription" className="btn-outline">
                  Créer un compte pro
                </Link>
              )}
            </div>

            {/* Chiffres clés */}
            <div className="flex justify-center lg:justify-start gap-8 mt-10 pt-8 border-t border-[#D4CCBE]">
              {[
                { value: "+500", label: "Références" },
                { value: "+1200", label: "Clients Pro" },
                { value: "48h", label: "Livraison" },
              ].map((stat) => (
                <div key={stat.label} className="text-center lg:text-left">
                  <p className="font-[family-name:var(--font-poppins)] text-2xl font-semibold text-[#8B7355]">
                    {stat.value}
                  </p>
                  <p className="text-xs font-[family-name:var(--font-roboto)] text-[#6B5B45] tracking-wide uppercase mt-0.5">
                    {stat.label}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Visuel décoratif */}
          <div className="relative flex items-center justify-center order-1 lg:order-2 pt-10 lg:pt-0">
            {/* Fond arrondi beige */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 h-72 md:w-96 md:h-96 bg-[#EDE8DF] rounded-full" />

            {/* Placeholder image — à remplacer par next/image avec vraies photos */}
            <div className="relative z-10 w-64 h-64 md:w-80 md:h-80 rounded-2xl bg-[#D4CCBE] flex flex-col items-center justify-center gap-3 shadow-lg">
              {/* Icône bijou décorative */}
              <svg className="w-20 h-20 text-[#8B7355] opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                  d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
              </svg>
              <span className="text-[#8B7355] font-[family-name:var(--font-poppins)] text-lg font-medium opacity-70">
                Beli & Jolie
              </span>
              <span className="text-[#6B5B45] text-xs font-[family-name:var(--font-roboto)] opacity-60">
                Photo à intégrer
              </span>
            </div>

            {/* Badge flottant "100% Original" */}
            <div className="absolute bottom-16 left-4 md:left-8 z-20 bg-[#FDFAF6] border border-[#D4CCBE] rounded-full px-4 py-2 shadow-md flex items-center gap-2">
              <svg className="w-4 h-4 text-[#8B7355]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.745 3.745 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.745 3.745 0 013.296-1.043A3.745 3.745 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.745 3.745 0 013.296 1.043 3.745 3.745 0 011.043 3.296A3.745 3.745 0 0121 12z" />
              </svg>
              <span className="text-xs font-[family-name:var(--font-roboto)] font-medium text-[#2C2418]">
                Qualité certifiée
              </span>
            </div>
          </div>

        </div>
      </div>
    </section>
  );
}
