import Link from "next/link";

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-bg-dark text-text-inverse">
      <div className="container-site py-10 md:py-14">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">

          {/* Column 1 - Brand */}
          <div className="sm:col-span-2 lg:col-span-1">
            <Link href="/" className="font-[family-name:var(--font-poppins)] text-xl font-semibold text-white">
              Beli <span className="text-text-muted">&</span> Jolie
            </Link>
            <p className="mt-3 text-sm leading-relaxed text-text-secondary font-[family-name:var(--font-roboto)]">
              Grossiste BtoB spécialisé dans les bijoux en acier inoxydable.
              Collections tendance pour revendeurs et boutiques.
            </p>
          </div>

          {/* Column 2 - Catalogue */}
          <div>
            <h3 className="font-[family-name:var(--font-poppins)] text-xs font-semibold text-white/40 uppercase tracking-widest mb-4">
              Catalogue
            </h3>
            <ul className="space-y-2.5 text-sm">
              {["Colliers", "Bracelets", "Bagues", "Boucles d'oreilles"].map((item) => (
                <li key={item}>
                  <Link href="/produits" className="text-text-secondary hover:text-white transition-colors font-[family-name:var(--font-roboto)]">
                    {item}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Column 3 - Espace Pro */}
          <div>
            <h3 className="font-[family-name:var(--font-poppins)] text-xs font-semibold text-white/40 uppercase tracking-widest mb-4">
              Espace Pro
            </h3>
            <ul className="space-y-2.5 text-sm">
              {[
                { label: "Connexion", href: "/connexion" },
                { label: "Créer un compte", href: "/inscription" },
                { label: "Mes commandes", href: "/commandes" },
              ].map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="text-text-secondary hover:text-white transition-colors font-[family-name:var(--font-roboto)]">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Column 4 - Informations */}
          <div>
            <h3 className="font-[family-name:var(--font-poppins)] text-xs font-semibold text-white/40 uppercase tracking-widest mb-4">
              Informations
            </h3>
            <ul className="space-y-2.5 text-sm">
              {[
                { label: "Mentions légales", href: "/mentions-legales" },
                { label: "CGV", href: "/cgv" },
                { label: "Confidentialité", href: "/confidentialite" },
              ].map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="text-text-secondary hover:text-white transition-colors font-[family-name:var(--font-roboto)]">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="border-t border-white/10">
        <div className="container-site py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-text-secondary font-[family-name:var(--font-roboto)]">
          <p>&copy; {currentYear} Beli & Jolie. Tous droits réservés.</p>
          <p>Plateforme réservée aux professionnels</p>
        </div>
      </div>
    </footer>
  );
}
