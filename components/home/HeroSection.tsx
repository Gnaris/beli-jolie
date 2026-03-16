import Link from "next/link";

export default function HeroSection({ isLoggedIn }: { isLoggedIn: boolean }) {
  return (
    <section className="bg-bg-dark relative overflow-hidden">
      {/* Subtle grid background */}
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.3) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />

      <div className="container-site py-24 md:py-32 relative">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          {/* Text */}
          <div>
            <div className="inline-flex items-center gap-2 bg-white/10 text-white/70 text-[11px] font-medium uppercase tracking-[0.2em] px-3 py-1.5 rounded-full mb-8 font-[family-name:var(--font-roboto)]">
              <span className="w-1.5 h-1.5 rounded-full bg-accent" />
              Grossiste B2B — Bijoux acier inoxydable
            </div>
            <h1 className="font-[family-name:var(--font-poppins)] text-4xl md:text-5xl font-semibold leading-[1.1] text-text-inverse mb-6">
              Des bijoux tendance
              <br />
              pour votre boutique
            </h1>
            <p className="text-text-muted text-base leading-relaxed font-[family-name:var(--font-roboto)] mb-10 max-w-md">
              +500 references en acier inoxydable. Tarifs professionnels,
              livraison rapide, service apres-vente reactif.
            </p>
            <div className="flex flex-wrap gap-3">
              {isLoggedIn ? (
                <Link
                  href="/produits"
                  className="inline-flex items-center gap-2 bg-bg-primary text-text-primary text-sm font-medium px-6 py-2.5 rounded-lg hover:bg-bg-tertiary transition-colors font-[family-name:var(--font-roboto)]"
                >
                  Voir le catalogue
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </Link>
              ) : (
                <>
                  <Link
                    href="/connexion"
                    className="inline-flex items-center gap-2 bg-bg-primary text-text-primary text-sm font-medium px-6 py-2.5 rounded-lg hover:bg-bg-tertiary transition-colors font-[family-name:var(--font-roboto)]"
                  >
                    Acces espace pro
                  </Link>
                  <Link
                    href="/inscription"
                    className="inline-flex items-center gap-2 border border-white/20 text-text-inverse text-sm px-6 py-2.5 rounded-lg hover:bg-white/10 transition-colors font-[family-name:var(--font-roboto)]"
                  >
                    Creer un compte
                  </Link>
                </>
              )}
            </div>

            {/* Quick stats */}
            <div className="flex flex-wrap gap-6 mt-10 pt-10 border-t border-white/10">
              {[
                { value: "+500", label: "References" },
                { value: "J+1", label: "Livraison France" },
                { value: "B2B", label: "Professionnel" },
              ].map((stat) => (
                <div key={stat.label}>
                  <p className="font-[family-name:var(--font-poppins)] text-xl font-bold text-text-inverse">
                    {stat.value}
                  </p>
                  <p className="text-text-muted text-xs font-[family-name:var(--font-roboto)] mt-0.5">
                    {stat.label}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Right panel */}
          <div className="hidden md:flex flex-col gap-3">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-white/60">
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"
                    />
                  </svg>
                </div>
                <div>
                  <p className="text-text-inverse text-sm font-medium font-[family-name:var(--font-roboto)]">
                    Catalogue exclusif
                  </p>
                  <p className="text-text-muted text-xs font-[family-name:var(--font-roboto)]">
                    Acier inoxydable premium
                  </p>
                </div>
              </div>
              <div className="h-px bg-white/5" />
              {[
                "Colliers & Pendentifs",
                "Bracelets & Joncs",
                "Bagues & Anneaux",
                "Boucles d'oreilles",
              ].map((cat) => (
                <div key={cat} className="flex items-center justify-between">
                  <span className="text-text-muted text-sm font-[family-name:var(--font-roboto)]">
                    {cat}
                  </span>
                  <span className="w-1.5 h-1.5 rounded-full bg-white/20" />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <p className="text-text-inverse text-lg font-bold font-[family-name:var(--font-poppins)]">
                  500+
                </p>
                <p className="text-text-muted text-xs font-[family-name:var(--font-roboto)] mt-0.5">
                  Produits disponibles
                </p>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <p className="text-text-inverse text-lg font-bold font-[family-name:var(--font-poppins)]">
                  100%
                </p>
                <p className="text-text-muted text-xs font-[family-name:var(--font-roboto)] mt-0.5">
                  Acier chirurgical
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
