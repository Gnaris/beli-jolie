import Link from "next/link";

/**
 * Footer du site Beli & Jolie
 * Structure : 4 colonnes sur desktop, empilées sur mobile
 */
export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-[#0F172A] text-[#E2E8F0]">
      {/* Section principale */}
      <div className="container-site py-12 md:py-16">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-12">

          {/* Colonne 1 — Marque */}
          <div className="sm:col-span-2 lg:col-span-1">
            <Link
              href="/"
              className="font-[family-name:var(--font-poppins)] text-2xl font-semibold text-[#FFFFFF] tracking-wide"
            >
              Beli <span className="text-[#94A3B8]">&</span> Jolie
            </Link>
            <p className="mt-4 text-sm leading-relaxed text-[#94A3B8]">
              Grossiste BtoB spécialisé dans les bijoux en acier inoxydable.
              Collections tendance pour revendeurs, boutiques et créateurs.
            </p>
            {/* Réseaux sociaux */}
            <div className="flex gap-4 mt-6">
              <a href="#" aria-label="Instagram" className="hover:text-[#94A3B8] transition-colors">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
                </svg>
              </a>
              <a href="#" aria-label="Pinterest" className="hover:text-[#94A3B8] transition-colors">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 0c-6.627 0-12 5.372-12 12 0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 01.083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.632-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12 0-6.628-5.373-12-12-12z" />
                </svg>
              </a>
              <a href="#" aria-label="LinkedIn" className="hover:text-[#94A3B8] transition-colors">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                </svg>
              </a>
            </div>
          </div>

          {/* Colonne 2 — Collections */}
          <div>
            <h3 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-[#FFFFFF] uppercase tracking-widest mb-4">
              Collections
            </h3>
            <ul className="space-y-2.5 text-sm">
              {["Colliers", "Bracelets", "Bagues", "Boucles d'oreilles", "Pendentifs", "Nouveautés"].map((item) => (
                <li key={item}>
                  <Link href={`/collections/${item.toLowerCase().replace(/ /g, "-")}`}
                    className="hover:text-[#94A3B8] transition-colors">
                    {item}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Colonne 3 — Espace Pro */}
          <div>
            <h3 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-[#FFFFFF] uppercase tracking-widest mb-4">
              Espace Professionnel
            </h3>
            <ul className="space-y-2.5 text-sm">
              {[
                { label: "Connexion Pro", href: "/connexion" },
                { label: "Créer un compte", href: "/inscription" },
                { label: "Tarifs & Paliers", href: "/tarifs" },
                { label: "Catalogue PDF", href: "/catalogue" },
                { label: "Suivi commandes", href: "/commandes" },
              ].map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="hover:text-[#94A3B8] transition-colors">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Colonne 4 — Informations */}
          <div>
            <h3 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-[#FFFFFF] uppercase tracking-widest mb-4">
              Informations
            </h3>
            <ul className="space-y-2.5 text-sm">
              {[
                { label: "À propos", href: "/a-propos" },
                { label: "Livraison", href: "/livraison" },
                { label: "Retours & SAV", href: "/retours" },
                { label: "Mentions légales", href: "/mentions-legales" },
                { label: "Politique de confidentialité", href: "/confidentialite" },
                { label: "CGV", href: "/cgv" },
              ].map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="hover:text-[#94A3B8] transition-colors">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Barre de bas — copyright */}
      <div className="border-t border-[#475569]/40">
        <div className="container-site py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-[#475569]">
          <p>© {currentYear} Beli & Jolie. Tous droits réservés.</p>
          <p>Plateforme réservée aux professionnels</p>
        </div>
      </div>
    </footer>
  );
}
