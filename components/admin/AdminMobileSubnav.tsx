"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { resolveAdminSubnav } from "./admin-subnav";

export default function AdminMobileSubnav() {
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  const onglet = searchParams?.get("onglet") ?? null;
  const subnav = resolveAdminSubnav(pathname, onglet);

  if (!subnav) return null;

  return (
    <nav
      aria-label="Sous-navigation"
      className="admin-mobile-subnav-pwa-offset lg:hidden sticky top-14 z-20 bg-white border-b border-zinc-200 overflow-x-auto scrollbar-light"
    >
      <div className="flex items-center gap-1.5 px-3 py-2 w-max">
        {subnav.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            scroll={false}
            className={`inline-flex items-center px-3 py-1.5 rounded-full text-[13px] font-body font-medium transition-colors whitespace-nowrap ${
              item.active
                ? "admin-subnav-active-pill"
                : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
