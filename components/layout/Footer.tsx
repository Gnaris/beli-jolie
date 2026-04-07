"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

interface FooterProps {
  shopName: string;
}

export default function Footer({ shopName }: FooterProps) {
  const t = useTranslations("footer");
  const currentYear = new Date().getFullYear();

  const catalogueItems = [
    { label: t("products"),    href: "/produits" },
    { label: t("collections"), href: "/collections" },
    { label: t("categories"),  href: "/categories" },
  ];

  const proItems = [
    { label: t("orders"),   href: "/commandes" },
    { label: t("favorites"), href: "/favoris" },
    { label: t("cart"),      href: "/panier" },
    { label: t("account"),   href: "/espace-pro" },
  ];

  const infoItems = [
    { label: t("contact"), href: "/nous-contacter" },
    { label: t("legal"),   href: "/mentions-legales" },
    { label: t("cgv"),     href: "/cgv" },
    { label: t("privacy"), href: "/confidentialite" },
    { label: t("cookies"), href: "/cookies" },
    { label: t("cgu"),     href: "/cgu" },
  ];

  return (
    <footer className="relative bg-gradient-to-b from-[#111111] to-[#0A0A0A] text-white">
      <div className="container-site py-10 md:py-14">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">

          {/* Column 1 - Brand */}
          <div className="sm:col-span-2 lg:col-span-1">
            <Link href="/" className="font-heading text-xl font-semibold text-white">
              {shopName}
            </Link>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-white/60 font-body">
              {t("description")}
            </p>
          </div>

          {/* Column 2 - Catalogue */}
          <div>
            <h3 className="font-heading text-xs font-semibold text-white/70 uppercase tracking-widest mb-4 after:block after:mt-2 after:w-6 after:h-0.5 after:bg-accent after:rounded-full">
              {t("catalogue")}
            </h3>
            <ul className="space-y-2.5 text-sm">
              {catalogueItems.map((item) => (
                <li key={item.label}>
                  <Link href={item.href} className="inline-block text-white/50 hover:text-accent hover:pl-1.5 transition-all duration-200 font-body">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Column 3 - Espace Pro */}
          <div>
            <h3 className="font-heading text-xs font-semibold text-white/70 uppercase tracking-widest mb-4 after:block after:mt-2 after:w-6 after:h-0.5 after:bg-accent after:rounded-full">
              {t("proSpace")}
            </h3>
            <ul className="space-y-2.5 text-sm">
              {proItems.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="inline-block text-white/50 hover:text-accent hover:pl-1.5 transition-all duration-200 font-body">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Column 4 - Informations */}
          <div>
            <h3 className="font-heading text-xs font-semibold text-white/70 uppercase tracking-widest mb-4 after:block after:mt-2 after:w-6 after:h-0.5 after:bg-accent after:rounded-full">
              {t("info")}
            </h3>
            <ul className="space-y-2.5 text-sm">
              {infoItems.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="inline-block text-white/50 hover:text-accent hover:pl-1.5 transition-all duration-200 font-body">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="border-t border-white/[0.06]">
        <div className="container-site py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-white/40 font-body">
          <p>&copy; {currentYear} {shopName}. {t("rights")}</p>
          <p>{t("reserved")}</p>
        </div>
      </div>
    </footer>
  );
}
