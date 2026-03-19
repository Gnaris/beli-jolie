"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

export default function Footer() {
  const t = useTranslations("footer");
  const currentYear = new Date().getFullYear();

  const catalogueItems = [
    { label: t("necklaces"), href: "/produits" },
    { label: t("bracelets"), href: "/produits" },
    { label: t("rings"),     href: "/produits" },
    { label: t("earrings"),  href: "/produits" },
  ];

  const proItems = [
    { label: t("login"),    href: "/connexion" },
    { label: t("register"), href: "/inscription" },
    { label: t("orders"),   href: "/commandes" },
  ];

  const infoItems = [
    { label: t("legal"),   href: "/mentions-legales" },
    { label: t("cgv"),     href: "/cgv" },
    { label: t("privacy"), href: "/confidentialite" },
  ];

  return (
    <footer className="relative bg-gradient-to-b from-bg-dark to-bg-darker text-text-inverse">
      <div className="container-site py-10 md:py-14">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">

          {/* Column 1 - Brand */}
          <div className="sm:col-span-2 lg:col-span-1">
            <Link href="/" className="font-[family-name:var(--font-poppins)] text-xl font-semibold text-white">
              Beli <span className="text-text-muted">&</span> Jolie
            </Link>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-text-secondary font-[family-name:var(--font-roboto)]">
              {t("description")}
            </p>
          </div>

          {/* Column 2 - Catalogue */}
          <div>
            <h3 className="font-[family-name:var(--font-poppins)] text-xs font-semibold text-white/70 uppercase tracking-widest mb-4 after:block after:mt-2 after:w-6 after:h-0.5 after:bg-accent after:rounded-full">
              {t("catalogue")}
            </h3>
            <ul className="space-y-2.5 text-sm">
              {catalogueItems.map((item) => (
                <li key={item.label}>
                  <Link href={item.href} className="inline-block text-text-secondary hover:text-accent hover:pl-1.5 transition-all duration-200 font-[family-name:var(--font-roboto)]">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Column 3 - Espace Pro */}
          <div>
            <h3 className="font-[family-name:var(--font-poppins)] text-xs font-semibold text-white/70 uppercase tracking-widest mb-4 after:block after:mt-2 after:w-6 after:h-0.5 after:bg-accent after:rounded-full">
              {t("proSpace")}
            </h3>
            <ul className="space-y-2.5 text-sm">
              {proItems.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="inline-block text-text-secondary hover:text-accent hover:pl-1.5 transition-all duration-200 font-[family-name:var(--font-roboto)]">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Column 4 - Informations */}
          <div>
            <h3 className="font-[family-name:var(--font-poppins)] text-xs font-semibold text-white/70 uppercase tracking-widest mb-4 after:block after:mt-2 after:w-6 after:h-0.5 after:bg-accent after:rounded-full">
              {t("info")}
            </h3>
            <ul className="space-y-2.5 text-sm">
              {infoItems.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="inline-block text-text-secondary hover:text-accent hover:pl-1.5 transition-all duration-200 font-[family-name:var(--font-roboto)]">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="border-t border-white/[0.06]">
        <div className="container-site py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-text-secondary font-[family-name:var(--font-roboto)]">
          <p>&copy; {currentYear} Beli & Jolie. {t("rights")}</p>
          <p>{t("reserved")}</p>
        </div>
      </div>
    </footer>
  );
}
