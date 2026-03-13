import Link from "next/link";

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-[#1A1A1A] text-white">
      <div className="container-site py-10 md:py-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">

          {/* Colonne 1 — Marque */}
          <div className="sm:col-span-2 lg:col-span-1">
            <Link href="/" className="font-[family-name:var(--font-poppins)] text-xl font-semibold text-white">
              Beli <span className="text-[#999999]">&</span> Jolie
            </Link>
            <p className="mt-3 text-sm leading-relaxed text-[#999999]">
              Grossiste BtoB spécialisé dans les bijoux en acier inoxydable.
              Collections tendance pour revendeurs et boutiques.
            </p>
          </div>

          {/* Colonne 2 — Catalogue */}
          <div>
            <h3 className="font-[family-name:var(--font-poppins)] text-xs font-semibold text-white uppercase tracking-widest mb-3">
              Catalogue
            </h3>
            <ul className="space-y-2 text-sm">
              {["Colliers", "Bracelets", "Bagues", "Boucles d'oreilles"].map((item) => (
                <li key={item}>
                  <Link href="/produits" className="text-[#999999] hover:text-white transition-colors">
                    {item}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Colonne 3 — Espace Pro */}
          <div>
            <h3 className="font-[family-name:var(--font-poppins)] text-xs font-semibold text-white uppercase tracking-widest mb-3">
              Espace Pro
            </h3>
            <ul className="space-y-2 text-sm">
              {[
                { label: "Connexion", href: "/connexion" },
                { label: "Créer un compte", href: "/inscription" },
                { label: "Mes commandes", href: "/commandes" },
              ].map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="text-[#999999] hover:text-white transition-colors">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Colonne 4 — Informations */}
          <div>
            <h3 className="font-[family-name:var(--font-poppins)] text-xs font-semibold text-white uppercase tracking-widest mb-3">
              Informations
            </h3>
            <ul className="space-y-2 text-sm">
              {[
                { label: "Mentions légales", href: "/mentions-legales" },
                { label: "CGV", href: "/cgv" },
                { label: "Confidentialité", href: "/confidentialite" },
              ].map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="text-[#999999] hover:text-white transition-colors">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="border-t border-[#333333]">
        <div className="container-site py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-[#666666]">
          <p>© {currentYear} Beli & Jolie. Tous droits réservés.</p>
          <p>Plateforme réservée aux professionnels</p>
        </div>
      </div>
    </footer>
  );
}
